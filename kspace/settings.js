// DOM-free settings for the k-space explorer: reading and writing them in the page address, and translating the
// contrast simulator's parameters into explorer settings (used by its "Open in k-space explorer" button), and the
// explorer's settings into builder parameters.
import { DEFAULTS, DEFAULT_LIMITS } from "../shared/sequence.js";

export const EPI_MIN_TIMING_BW = 1500; // Hz/px: EPI reads each line in well under a millisecond
export const SEQS = ["SE", "GRE", "FSE", "EPI"];
export const MATRICES = [32, 64, 128, 256];
export const INVERSIONS = ["none", "IR", "DIR"];
export const INVERSION_SEQS = ["SE", "FSE"]; // spin-echo readouts, as in FLAIR, STIR and DIR
export const ORDERS = ["sequential", "interleaved"];
export const RANGES = {
  TE: [1, 200], TR: [10, 12000], flip: [5, 90], ETL: [2, 32], fov: [120, 400], bw: [50, 3000], sliceMm: [1, 10],
  TI: [20, 4000], TI1: [300, 5000], TI2: [20, 2500], slices: [1, 32], gapPct: [0, 100],
};
const KEYS = {
  seq: "seq", TE: "te", TR: "tr", flip: "flip", ETL: "etl", inversion: "inv", TI: "ti", TI1: "ti1", TI2: "ti2",
  ny: "matrix", fov: "fov", bw: "bw", sliceMm: "slice", gMax: "gmax", slew: "slew", from: "from",
  slices: "slices", gapPct: "gap", sliceOrder: "order", conc: "conc", sel: "sel",
};
const NUMERIC = ["TE", "TR", "flip", "ETL", "TI", "TI1", "TI2", "fov", "bw", "sliceMm", "slices", "gapPct"];

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
// The selected slice (an index into the stack of n): an integer in 0..n-1, else the middle one.
export const clampSel = (sel, n) => (Number.isInteger(sel) && sel >= 0 && sel < n ? sel : Math.floor((n - 1) / 2));
export const nearestMatrix = (n) => MATRICES.reduce((best, m) => (Math.abs(Math.log(m / n)) < Math.abs(Math.log(best / n)) ? m : best), 128);

// Settings found in a query string (unknown or out-of-range values are ignored or clamped).
export function fromQuery(search) {
  const q = new URLSearchParams(search), out = {};
  const seq = q.get(KEYS.seq);
  if (SEQS.includes(seq)) out.seq = seq;
  if (INVERSIONS.includes(q.get(KEYS.inversion))) out.inversion = q.get(KEYS.inversion);
  for (const key of NUMERIC) {
    const v = Number(q.get(KEYS[key]));
    if (q.has(KEYS[key]) && Number.isFinite(v)) out[key] = clamp(v, RANGES[key]);
  }
  if (ORDERS.includes(q.get(KEYS.sliceOrder))) out.sliceOrder = q.get(KEYS.sliceOrder);
  // concatenations: "auto", or any whole number of passes from 1 (a linked protocol may need more than the control's 4)
  const conc = q.get(KEYS.conc);
  if (conc === "auto") out.conc = "auto";
  else if (conc !== null && /^\d+$/.test(conc) && Number(conc) >= 1) out.conc = Math.min(Number(conc), RANGES.slices[1]);
  if (q.has(KEYS.sel) && Number.isFinite(Number(q.get(KEYS.sel)))) out.sel = clamp(Math.round(Number(q.get(KEYS.sel))), [0, 31]);
  if (q.has(KEYS.ny)) { const n = nearestMatrix(Number(q.get(KEYS.ny)) || 128); out.nx = out.ny = n; }
  if (["20", "40", "80"].includes(q.get(KEYS.gMax))) out.gMax = Number(q.get(KEYS.gMax));
  if (["70", "150", "200"].includes(q.get(KEYS.slew))) out.slew = Number(q.get(KEYS.slew));
  if (q.has(KEYS.from)) out.from = q.get(KEYS.from).slice(0, 40);
  return out;
}

// Whether a setting applies to the chosen sequence (and inversion).
export function applies(key, s) {
  const inv = INVERSION_SEQS.includes(s.seq) ? s.inversion ?? "none" : "none";
  const multi = (s.slices ?? 1) > 1;
  if (key === "slices") return multi;
  if (key === "gapPct" || key === "sliceOrder" || key === "sel" || key === "conc") return multi;
  if (multi && (key === "inversion" || key === "TI" || key === "TI1" || key === "TI2")) return false;
  if (key === "flip") return s.seq === "GRE";
  if (key === "ETL") return s.seq === "FSE";
  if (key === "inversion") return inv !== "none";
  if (key === "TI") return inv === "IR";
  if (key === "TI1" || key === "TI2") return inv === "DIR";
  return true;
}

export function toQuery(s) {
  const q = new URLSearchParams();
  for (const [key, name] of Object.entries(KEYS)) {
    if (s[key] === undefined || s[key] === null || !applies(key, s)) continue;
    q.set(name, String(s[key]));
  }
  return q.toString();
}

// The contrast simulator's sequences mapped to what the explorer can build, with a note when it is an approximation.
const FROM_CONTRAST = {
  FSE: { seq: "FSE" },
  GRE: { seq: "GRE" },
  "EPI (single-shot)": { seq: "EPI" },
  FLAIR: { seq: "FSE", inversion: "IR" },
  STIR: { seq: "FSE", inversion: "IR" },
  DIR: { seq: "FSE", inversion: "DIR" },
  bSSFP: { seq: "GRE", note: "Balanced SSFP is not modelled here yet; this is a spoiled gradient echo with the same timing." },
  MPRAGE: { seq: "GRE", note: "The MPRAGE inversion and 3D encoding are not modelled here yet; this is one gradient-echo readout." },
  DWI: { seq: "EPI", note: "The diffusion gradients are not modelled here yet; this is the EPI readout." },
};
export const contrastNote = (from) => FROM_CONTRAST[from]?.note ?? "";

// p: the contrast simulator's parameters ({ seq, TR, TE, TI, TI1, TI2, FA, ETL, phaseMatrix, fovRead, BW, sliceMm,
// slices, gapPct, sliceOrder }); timing: its protocolTiming(p). A packed stack of more than one slice carries over with
// the resolved number of concatenations (not "auto") and the middle slice selected; anything else opens one slice.
export function fromContrast(p, timing) {
  const map = FROM_CONTRAST[p.seq] ?? { seq: "GRE" };
  let seq = map.seq;
  if (seq === "FSE" && p.seq === "FSE" && (p.ETL ?? 1) <= 1) seq = "SE"; // a one-echo train is a spin echo
  const out = {
    seq, TE: clamp(p.TE, RANGES.TE), TR: clamp(p.TR, RANGES.TR), ny: nearestMatrix(p.phaseMatrix ?? 128),
    fov: clamp(Math.round((p.fovRead ?? 240) / 10) * 10, RANGES.fov), bw: clamp(p.BW ?? 260, RANGES.bw),
    sliceMm: clamp(p.sliceMm ?? 5, RANGES.sliceMm), from: p.seq,
  };
  out.nx = out.ny;
  if (seq === "GRE") out.flip = clamp(p.FA ?? 30, RANGES.flip);
  if (seq === "FSE") out.ETL = clamp(p.ETL ?? 8, RANGES.ETL);
  if (seq === "EPI") out.bw = Math.max(out.bw, EPI_MIN_TIMING_BW);
  if (map.inversion === "IR") Object.assign(out, { inversion: "IR", TI: clamp(p.TI, RANGES.TI) });
  if (map.inversion === "DIR") Object.assign(out, { inversion: "DIR", TI1: clamp(p.TI1, RANGES.TI1), TI2: clamp(p.TI2, RANGES.TI2) });
  if (timing?.mode === "packed" && timing.N > 1) {
    const N = clamp(timing.N, RANGES.slices);
    Object.assign(out, { slices: N, gapPct: clamp(Math.round((p.gapPct ?? 20) / 10) * 10, RANGES.gapPct),
      sliceOrder: ORDERS.includes(p.sliceOrder) ? p.sliceOrder : "interleaved", conc: timing.concatenations, sel: Math.floor((N - 1) / 2) });
  }
  return out;
}

export const explorerUrl = (base, p, timing) => `${base}?${toQuery(fromContrast(p, timing))}`;

// ---- the explorer's state and its builder parameters ----
export const SEQ_DEFAULTS = {
  SE: { TE: 20, TR: 500, nx: 128, ny: 128 },
  GRE: { TE: 5, TR: 50, flip: 30, nx: 128, ny: 128 },
  FSE: { TE: 80, TR: 3000, ETL: 8, nx: 128, ny: 128 },
  EPI: { TE: 40, TR: 3000, bw: 1500, nx: 64, ny: 64 },
};

// The explorer's settings on opening, from its address (search: location.search).
export function initialState(search) {
  let state = { seq: "SE", ...DEFAULTS, ...SEQ_DEFAULTS.SE, fov: 240, gMax: DEFAULT_LIMITS.gMax, slew: DEFAULT_LIMITS.slew };
  const q = fromQuery(search);
  if (q.seq) state = { ...state, ...SEQ_DEFAULTS[q.seq], seq: q.seq };
  state = { ...state, ...q };
  if (state.slices !== undefined) state.slices = Math.round(state.slices);
  if (state.gapPct !== undefined) state.gapPct = Math.round(state.gapPct / 10) * 10;
  return state;
}

const inversionOf = (s) => ((s.slices ?? 1) <= 1 && INVERSION_SEQS.includes(s.seq) ? s.inversion ?? "none" : "none");
// Builder parameters for the explorer's settings s (no pass: kspace/scan.js buildShots picks the selected slice's).
// Concatenations 1 keeps one pass and raises TR to fit; Auto or 2 and more make more passes when the slices do not fit.
export function explorerParams(s) {
  const conc = s.conc ?? "auto";
  return { ...s, slices: s.slices ?? 1, gapPct: s.gapPct ?? 20, sliceOrder: s.sliceOrder ?? "interleaved",
    concatenations: conc, overflow: conc === 1 ? "tr" : "passes",
    inversion: inversionOf(s), nx: s.ny, fovRead: s.fov, fovPhase: s.fov, limits: { gMax: +s.gMax, slew: +s.slew } };
}
