// MRI contrast physics: tissue tables, signal equations, the Signal -> Noise -> SNR chain, timing
// constraints, and slider ranges. DOM-free. Port of the physics in the original Streamlit app.py;
// numbers are checked against golden values generated from that Python code (golden.json).
//
// Units: ms for times, degrees for flip angles, s/mm^2 for b, mm for lengths.

import { TISSUES_BASE, FIELD_STRENGTH_TISSUES, FIELD_SNR_SCALE, TR_MAX_BY_FIELD, PROTOCOL_PRESETS } from "./tables.js";

export { TISSUES_BASE, FIELD_STRENGTH_TISSUES, FIELD_SNR_SCALE, TR_MAX_BY_FIELD, PROTOCOL_PRESETS };

export const FIELDS = Object.keys(FIELD_STRENGTH_TISSUES);
export const SEQUENCES = ["FSE", "GRE", "FLAIR", "STIR", "bSSFP", "DIR", "DWI", "MPRAGE", "EPI (single-shot)"];
export const TISSUE_NAMES = ["WM", "GM", "CSF", "Fat"];

// ---- reference constants for the three-step Signal / Noise / SNR architecture ----
export const SNR_SCALE = 200.0;
export const BW_REF = 200.0;
export const NEX_REF = 1.0;
const REF_PX = 240.0 / 256.0;
export const REF_VOXEL_VOL = REF_PX ** 2 * 5.0; // 2-D reference voxel, about 4.394 mm^3
export const NOISE_REF = Math.sqrt(BW_REF) / (REF_VOXEL_VOL * SNR_SCALE);
export const MPRAGE_SLAB_MM = 176.0;
export const MPRAGE_NPART_DEFAULT = 176;
export const MPRAGE_TR_READOUT = 7; // ms, gradient-echo spacing within the partition train
export const FAT_SAT_FACTOR = 0.05;

// Nominal echo spacings (ms) that map a TE slider to an effective echo index, and display limits.
const FSE_NOMINAL_ESP_MS = 20.0;
const FLAIR_NOMINAL_ESP_MS = 25.0; // also used for STIR
const DIR_NOMINAL_ESP_MS = 25.0;
const EPI_NOMINAL_ESP_MS = 0.8;
const FSE_MAX_ECHOES_TO_SHOW = 6;
const MIN_REALISTIC_ESP_MS = 10.0;
// Minimum GRE TE follows from the schematic gradient geometry of the original pulse diagram:
// ceil((rep_end + 2*dep_rise + dep_flat + rise + read_flat/2 - TE_min) * TE_max_ms / TE_range)
export const GRE_MIN_TE_MS = (() => {
  const gssEnd = 0.44 + 0.04 + 0.24 + 0.04;
  const repRise = (Math.abs(-1.0) / 1.0) * 0.04;
  const repEnd = gssEnd + repRise + 0.06 + repRise;
  const depRise = (Math.abs(-0.6) / 1.0) * 0.1;
  return Math.ceil(((repEnd + 2 * depRise + 0.38 + 0.1 + 1.15 / 2 - 1.8) * 100.0) / 4.0);
})();

const deg = (a) => (a * Math.PI) / 180;

// Python's round(): half to even.
export function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
// Python's round(x, 2).
export const round2 = (x) => Number(x.toFixed(2));

// ---- signal equations (0-1 scale; TR, TE, TI in ms) ----
export function fseSignal(TR, TE, T1, T2, PD, fatSat = false, isFat = false) {
  let S = PD * (1 - Math.exp(-TR / T1)) * Math.exp(-TE / T2);
  if (fatSat && isFat) S *= FAT_SAT_FACTOR;
  return S;
}
export function greSignal(TR, TE, FA, T1, T2s, PD, fatSat = false, isFat = false) {
  const a = deg(FA), E1 = Math.exp(-TR / T1);
  let S = (PD * Math.sin(a) * (1 - E1)) / (1 - Math.cos(a) * E1) * Math.exp(-TE / T2s);
  if (fatSat && isFat) S *= FAT_SAT_FACTOR;
  return S;
}
export function flairSignal(TR, TI, TE, T1, T2, PD, fatSat = false, isFat = false) {
  let S = PD * Math.abs(1 - 2 * Math.exp(-TI / T1) + Math.exp(-TR / T1)) * Math.exp(-TE / T2);
  if (fatSat && isFat) S *= FAT_SAT_FACTOR;
  return S;
}
export function bssfpSignal(TR, FA, T1, T2, PD) {
  const a = deg(FA), E1 = Math.exp(-TR / T1), E2 = Math.exp(-TR / T2);
  return (PD * Math.sin(a) * (1 - E1)) / (1 - (E1 - E2) * Math.cos(a) - E1 * E2) * Math.sqrt(E2);
}
export function bssfpOptimalFa(TR, T1, T2) {
  const E1 = Math.exp(-TR / T1), E2 = Math.exp(-TR / T2);
  return (Math.acos((E1 - E2) / (1 - E1 * E2)) * 180) / Math.PI;
}
export function dirSignal(TR, TI1, TI2, TE, T1, T2, PD) {
  return PD * Math.abs(1 - 2 * Math.exp(-TI2 / T1) + 2 * Math.exp(-TI1 / T1) - Math.exp(-TR / T1)) * Math.exp(-TE / T2);
}
// TI2 that nulls a tissue in DIR, searched on a 5000-point grid like the original; null if none.
export function dirNullTi2(TR, TI1, T1) {
  const n = 5000, lo = 10, hi = TI1 - 10;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const ti2 = lo + ((hi - lo) * i) / (n - 1);
    const s = 1 - 2 * Math.exp(-ti2 / T1) + 2 * Math.exp(-TI1 / T1) - Math.exp(-TR / T1);
    const sign = Math.sign(s);
    if (prev !== null && sign !== prev) return lo + ((hi - lo) * (i - 1)) / (n - 1); // left element, like numpy's where(diff(sign))
    prev = sign;
  }
  return null;
}
export function dwiSignal(TR, TE, b, T1, T2, PD, ADC) {
  const S0 = PD * (1 - Math.exp(-TR / T1)) * Math.exp(-TE / T2);
  return S0 * Math.exp(-b * ADC);
}
export function mprageSignal(TR, TI, TE, FA, T1, T2s, PD) {
  return PD * Math.abs(1 - 2 * Math.exp(-TI / T1) + Math.exp(-TR / T1)) * Math.sin(deg(FA)) * Math.exp(-TE / T2s);
}
export function epiSignal(TR, TE, T1, T2s, PD) {
  return PD * (1 - Math.exp(-TR / T1)) * Math.exp(-TE / T2s);
}
// TI that nulls a tissue with this T1 in an inversion-recovery sequence.
export function csfNullTi(TR, T1) {
  return T1 * Math.log(2.0 / (1.0 + Math.exp(-TR / T1)));
}
export function ernstAngle(TR, T1) {
  return (Math.acos(Math.exp(-TR / T1)) * 180) / Math.PI;
}

// Scan time in seconds (before any partial-Fourier factor).
export function calcScanTime(TR, phaseMatrix, ETL, NEX, seq, nPartitions = 1) {
  if (seq === "GRE") return (TR * phaseMatrix * NEX) / 1000.0;
  if (seq === "MPRAGE") return (TR * phaseMatrix * NEX) / 1000.0; // partitions do not enter the formula
  return (TR * (phaseMatrix / ETL) * nPartitions * NEX) / 1000.0;
}

// ---- tissues at a given field strength: PD/ADC/colour from the base table, T1/T2/T2* from the field table ----
export function tissuesAt(field) {
  const byField = FIELD_STRENGTH_TISSUES[field];
  if (!byField) throw new Error(`Unknown field strength: ${field}`);
  return Object.fromEntries(TISSUE_NAMES.map((n) => [n, { ...TISSUES_BASE[n], ...byField[n] }]));
}

// Signal of one tissue for the selected sequence (0-1 scale, before voxel-volume scaling).
export function tissueSignal(seq, p, tissue, isFat) {
  const { TR, TE, TI, TI1, TI2, FA, b, fatSat } = p;
  const fs = !!fatSat;
  switch (seq) {
    case "FSE": return fseSignal(TR, TE, tissue.T1, tissue.T2, tissue.PD, fs, isFat);
    case "GRE": return greSignal(TR, TE, FA, tissue.T1, tissue.T2s, tissue.PD, fs, isFat);
    case "FLAIR":
    case "STIR": return flairSignal(TR, TI, TE, tissue.T1, tissue.T2, tissue.PD, fs, isFat);
    case "bSSFP": { const S = bssfpSignal(TR, FA, tissue.T1, tissue.T2, tissue.PD); return fs && isFat ? S * FAT_SAT_FACTOR : S; }
    case "DIR": { const S = dirSignal(TR, TI1, TI2, TE, tissue.T1, tissue.T2, tissue.PD); return fs && isFat ? S * FAT_SAT_FACTOR : S; }
    case "DWI": { const S = dwiSignal(TR, TE, b, tissue.T1, tissue.T2, tissue.PD, tissue.ADC); return fs && isFat ? S * FAT_SAT_FACTOR : S; }
    case "MPRAGE": { const S = mprageSignal(TR, TI, TE, FA, tissue.T1, tissue.T2s, tissue.PD); return fs && isFat ? S * FAT_SAT_FACTOR : S; }
    case "EPI (single-shot)": return epiSignal(TR, TE, tissue.T1, tissue.T2s, tissue.PD);
    default: throw new Error(`Unknown sequence: ${seq}`);
  }
}

// ---- timing constraints: derived echo spacing / minimum TR / TE, and the messages the app showed ----
export function derivedTiming(seq, p) {
  const out = { messages: [], blocking: false };
  const err = (text) => out.messages.push({ level: "error", text });
  const warn = (text) => out.messages.push({ level: "warning", text });
  const echo = (nominal) => {
    const idx = Math.max(0, Math.min(Math.min(p.ETL, FSE_MAX_ECHOES_TO_SHOW) - 1, roundHalfEven(p.TE / nominal) - 1));
    return { effIdx: idx, espMs: p.TE / (idx + 1) };
  };
  if (seq === "FSE" || seq === "FLAIR" || seq === "STIR" || seq === "DIR") {
    const nominal = seq === "FSE" ? FSE_NOMINAL_ESP_MS : seq === "DIR" ? DIR_NOMINAL_ESP_MS : FLAIR_NOMINAL_ESP_MS;
    const { effIdx, espMs } = echo(nominal);
    const lead = seq === "FSE" ? 0 : seq === "DIR" ? p.TI1 + p.TI2 : p.TI;
    out.effIdx = effIdx; out.espMs = espMs; out.minTR = lead + p.ETL * espMs;
    if (p.TR < out.minTR) {
      err(seq === "FSE" ? `TR too short: minimum TR for current ETL and TEeff is ${Math.trunc(out.minTR)} ms`
        : seq === "DIR" ? `TR too short: minimum TR for current TI1, TI2, ETL and TEeff is ${Math.trunc(out.minTR)} ms`
          : `TR too short: minimum TR for current TI, ETL and TEeff is ${Math.trunc(out.minTR)} ms`);
    }
    if (espMs < MIN_REALISTIC_ESP_MS) err("Echo spacing too short to be physically realistic — minimum ESP is approximately 10 ms");
  } else if (seq === "GRE") {
    out.minTE = GRE_MIN_TE_MS;
    if (p.TE < GRE_MIN_TE_MS) err(`TE too short: minimum achievable TE is ${GRE_MIN_TE_MS.toFixed(0)} ms`);
  } else if (seq === "bSSFP") {
    out.fixedTE = p.TR / 2; // TE = TR/2 by sequence design
  } else if (seq === "MPRAGE") {
    out.readoutTrainMs = MPRAGE_TR_READOUT * p.nPartitions;
    out.minTR = p.TI + out.readoutTrainMs;
    if (p.TR < out.minTR) {
      warn(`Timing violation: TR (${p.TR} ms) < TI (${p.TI} ms) + readout train (${out.readoutTrainMs} ms) = ${out.minTR} ms. `
        + "Increase TR or decrease TI / Partitions.");
    }
  } else if (seq === "EPI (single-shot)") {
    out.espMs = EPI_NOMINAL_ESP_MS;
    out.effIdx = Math.max(0, Math.min(p.phaseMatrix - 1, roundHalfEven(p.TE / EPI_NOMINAL_ESP_MS) - 1));
    out.maxTE = p.phaseMatrix * EPI_NOMINAL_ESP_MS;
    if (p.TE > out.maxTE) {
      err(`TEeff too long: maximum is ${out.maxTE.toFixed(0)} ms for ${p.phaseMatrix} phase encodes at ESP ${EPI_NOMINAL_ESP_MS.toFixed(1)} ms`);
      out.blocking = true; // the original stopped rendering here
    }
  }
  return out;
}

// ---- the full model: Signal -> Noise -> SNR, plus scan time and contrast metrics ----
// p: {seq, field, TR, TE, TI, TI1, TI2, FA, b, ETL, NEX, BW, fovRead, fovPhase, freqMatrix, phaseMatrix,
//     sliceMm, nPartitions, fatSat, pfFraction}
export function computeModel(p, { scanFactor = 1, crossTalk = null } = {}) {
  const seq = p.seq;
  const tissues = tissuesAt(p.field);
  const is3d = seq === "MPRAGE";

  // Step 1: pure physics signals, then the voxel-volume scale (and sqrt of partial-Fourier fraction).
  const baseSignals = {};
  for (const name of TISSUE_NAMES) baseSignals[name] = tissueSignal(seq, p, tissues[name], name === "Fat");
  if (crossTalk) for (const name of TISSUE_NAMES) baseSignals[name] *= crossTalk[name];
  const sliceForVol = is3d ? MPRAGE_SLAB_MM / p.nPartitions : p.sliceMm;
  const refSlice = is3d ? MPRAGE_SLAB_MM / MPRAGE_NPART_DEFAULT : 5.0;
  const refVox = (240.0 / 256.0) ** 2 * refSlice;
  const voxelVol = (p.fovRead / p.freqMatrix) * (p.fovPhase / p.phaseMatrix) * sliceForVol;
  const volScale = voxelVol / refVox;
  const signals = {};
  for (const name of TISSUE_NAMES) signals[name] = round2(baseSignals[name] * volScale * Math.sqrt(p.pfFraction));

  // Step 2: noise depends only on bandwidth, NEX and field strength.
  const noiseFloor = (NOISE_REF / FIELD_SNR_SCALE[p.field]) * Math.sqrt(p.BW / BW_REF) / Math.sqrt(p.NEX / NEX_REF);

  // Step 3: SNR = Signal / Noise, no other dependencies.
  const snrs = {};
  for (const name of TISSUE_NAMES) snrs[name] = noiseFloor > 0 ? signals[name] / noiseFloor : 0.0;

  const scanSec = calcScanTime(p.TR, p.phaseMatrix, p.ETL, p.NEX, seq, p.nPartitions) * p.pfFraction * scanFactor;
  return {
    scanFactor, crossTalk, seq, tissues, is3d, baseSignals, signals, noiseFloor, snrs, voxelVol, volScale, scanSec,
    scanMinutes: Math.trunc(scanSec / 60), scanSeconds: Math.trunc(scanSec % 60),
    cnr: {
      wmGm: Math.abs(snrs.WM - snrs.GM), wmCsf: Math.abs(snrs.WM - snrs.CSF), gmCsf: Math.abs(snrs.GM - snrs.CSF),
    },
    pixelMm: [p.fovRead / p.freqMatrix, p.fovPhase / p.phaseMatrix],
    timing: derivedTiming(seq, p),
    keyMetric: keyMetric(seq, p, tissues),
  };
}

// The sequence-specific seventh metric shown beside CNR, scan time and voxel size.
export function keyMetric(seq, p, tissues) {
  switch (seq) {
    case "GRE": return { label: "Ernst ∠ WM", value: `${ernstAngle(p.TR, tissues.WM.T1).toFixed(1)}°` };
    case "FLAIR": return { label: "CSF null TI", value: `${csfNullTi(p.TR, tissues.CSF.T1).toFixed(0)} ms` };
    case "STIR": return { label: "Fat null TI", value: `${csfNullTi(p.TR, tissues.Fat.T1).toFixed(0)} ms` };
    case "bSSFP": return { label: "Opt FA WM", value: `${bssfpOptimalFa(p.TR, tissues.WM.T1, tissues.WM.T2).toFixed(1)}°` };
    case "DIR": { const v = dirNullTi2(p.TR, p.TI1, tissues.WM.T1); return { label: "WM null TI2", value: v ? `${v.toFixed(0)} ms` : "n/a" }; }
    case "DWI": return { label: "WM ADC", value: `${(tissues.WM.ADC * 1000).toFixed(2)} ×10⁻³ mm²/s` };
    case "MPRAGE": return { label: "CSF null TI", value: `${csfNullTi(p.TR, tissues.CSF.T1).toFixed(0)} ms` };
    case "EPI (single-shot)": return { label: "Opt TEeff (GM)", value: `${tissues.GM.T2s} ms  (T2*)` };
    default: return { label: "Sequence", value: "FSE" };
  }
}

// Optimal window/level from the pure physics signals of WM, GM and CSF (no scaling or noise).
export function optimalWindowLevel(p) {
  const tissues = tissuesAt(p.field);
  const s = ["WM", "GM", "CSF"].map((n) => tissueSignal(p.seq, p, tissues[n], false));
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length); // population std, like numpy
  return { window: Math.min(2.0, Math.max(0.01, 2.0 * sd)), level: Math.min(1.0, Math.max(0.0, mean)) };
}

// ---- parameter defaults and slider ranges (the sidebar rules of the original) ----
const COMMON_DEFAULTS = {
  freqMatrix: 256, phaseMatrix: 256, fovRead: 400, fovPhase: 400, sliceMm: 5, nPartitions: 176,
  NEX: 1, BW: 200, fatSat: false, pfFraction: 1.0, ghostPct: 15, b: 0, TI: 0, TI1: 0, TI2: 0, FA: 90, ETL: 1,
};
const SEQ_DEFAULTS = {
  FSE: { TR: 4000, TE: 80, ETL: 16 },
  GRE: { TR: 4000, TE: 5, FA: 30 }, // the original's default TE (5) is below the 7 ms minimum
  FLAIR: { TR: 9000, TI: 2500, TE: 90, ETL: 16 },
  STIR: { TR: 3000, TI: 210, TE: 60, ETL: 8 },
  bSSFP: { TR: 5, FA: 50 },
  DIR: { TR: 8000, TI1: 3400, TI2: 800, TE: 25, ETL: 8 },
  DWI: { TR: 5000, TE: 80, b: 1000 },
  MPRAGE: { TR: 2300, TI: 900, TE: 3, FA: 9 },
  "EPI (single-shot)": { TR: 2000, TE: 30 },
};
export const PARTIAL_FOURIER = { "8/8 (Full)": 1.0, "7/8": 7 / 8, "6/8": 6 / 8, "5/8": 5 / 8 };
export const PARTIAL_FOURIER_SEQUENCES = ["FSE", "GRE", "EPI (single-shot)"];

// TR slider range for a sequence at a field strength.
export function trRange(seq, field) {
  const trMax = TR_MAX_BY_FIELD[field];
  switch (seq) {
    case "FLAIR": return { min: 3000, max: 10000, step: 100 };
    case "STIR": return { min: 1000, max: Math.max(1050, trMax), step: 50 };
    case "bSSFP": return { min: 3, max: 20, step: 1 };
    case "DIR": return { min: 5000, max: Math.max(5100, trMax), step: 100 };
    case "DWI": return { min: 3000, max: Math.max(3100, trMax), step: 100 };
    case "MPRAGE": return { min: 2000, max: Math.max(2100, trMax), step: 100 };
    case "EPI (single-shot)": return { min: 500, max: Math.max(600, Math.min(3000, trMax)), step: 100 };
    default: return { min: 500, max: trMax, step: 50 }; // FSE, GRE: tied to the T1 recovery curve
  }
}

// Ordered sequence-specific controls (after TR).
export function sequenceControls(seq) {
  const c = (key, label, min, max, step) => ({ key, label, min, max, step });
  switch (seq) {
    case "FSE": return [c("TE", "TE eff. (ms)", 10, 300, 5), c("ETL", "ETL", 1, 32, 1)];
    case "GRE": return [c("TE", "TE (ms)", 2, 100, 1), c("FA", "Flip angle (°)", 1, 90, 1)];
    case "FLAIR": return [c("TI", "TI (ms)", 500, 4000, 50), c("TE", "TE eff. (ms)", 25, 250, 5), c("ETL", "ETL", 1, 32, 1)];
    case "STIR": return [c("TI", "TI (ms)", 50, 400, 10), c("TE", "TE eff. (ms)", 25, 250, 5), c("ETL", "ETL", 1, 32, 1)];
    case "bSSFP": return [c("FA", "Flip angle (°)", 10, 90, 1)];
    case "DIR": return [c("TI1", "TI1 (ms)", 500, 5000, 50), c("TI2", "TI2 (ms)", 100, 2500, 50),
      c("TE", "TE eff. (ms)", 10, 100, 5), c("ETL", "ETL", 1, 32, 1)];
    case "DWI": return [c("b", "b-value (s/mm²)", 0, 3000, 100), c("TE", "TE (ms)", 50, 150, 5)];
    case "MPRAGE": return [c("TI", "TI (ms)", 200, 2500, 10), c("TE", "TE (ms)", 2, 18, 1), c("FA", "Flip angle (°)", 5, 15, 1)];
    default: return [c("TE", "TEeff (ms)", 1, 200, 1)]; // EPI
  }
}

// Fully-populated parameters for a sequence, with optional preset overrides (a key of PROTOCOL_PRESETS or a dict).
export function defaultParams(seq = "FSE", field = "3.0T", preset = null) {
  const src = preset ? (typeof preset === "string" ? PROTOCOL_PRESETS[preset] : preset) : null;
  if (src && src.seq) seq = src.seq; // a preset picks its own sequence, so start from that sequence's defaults
  const base = { seq, field, ...COMMON_DEFAULTS, ...SEQ_DEFAULTS[seq] };
  const range = trRange(seq, field);
  base.TR = Math.min(base.TR, range.max);
  if (src) {
    const { seq: _s, field_strength, pf_label, n2_ghost_pct, ...rest } = src;
    Object.assign(base, rest);
    const keyMap = { FOV_read: "fovRead", FOV_phase: "fovPhase", freq_matrix: "freqMatrix", phase_matrix: "phaseMatrix",
      slice_mm: "sliceMm", Npartitions: "nPartitions", fat_sat: "fatSat" };
    for (const [k, v] of Object.entries(keyMap)) if (k in base) { base[v] = base[k]; delete base[k]; }
    if (pf_label) base.pfFraction = PARTIAL_FOURIER[pf_label];
    if (n2_ghost_pct !== undefined) base.ghostPct = n2_ghost_pct;
  }
  if (base.seq === "EPI (single-shot)") base.ETL = base.phaseMatrix;
  if (base.seq === "bSSFP") base.TE = base.TR / 2;
  if (base.seq === "MPRAGE") base.sliceMm = 1.0;
  else base.nPartitions = 1;
  if (base.seq === "DIR") base.TI = base.TI1;
  return base;
}
