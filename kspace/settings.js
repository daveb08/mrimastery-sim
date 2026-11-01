// DOM-free settings for the k-space explorer: reading and writing them in the page address, and translating the
// contrast simulator's parameters into explorer settings (used by its "Open in k-space explorer" button).

export const SEQS = ["SE", "GRE", "FSE", "EPI"];
export const MATRICES = [32, 64, 128, 256];
export const INVERSIONS = ["none", "IR", "DIR"];
export const INVERSION_SEQS = ["SE", "FSE"]; // spin-echo readouts, as in FLAIR, STIR and DIR
export const RANGES = {
  TE: [1, 200], TR: [10, 12000], flip: [5, 90], ETL: [2, 32], fov: [120, 400], bw: [50, 3000], sliceMm: [1, 10],
  TI: [20, 4000], TI1: [300, 5000], TI2: [20, 2500],
};
const KEYS = {
  seq: "seq", TE: "te", TR: "tr", flip: "flip", ETL: "etl", inversion: "inv", TI: "ti", TI1: "ti1", TI2: "ti2",
  ny: "matrix", fov: "fov", bw: "bw", sliceMm: "slice", gMax: "gmax", slew: "slew", from: "from",
};
const NUMERIC = ["TE", "TR", "flip", "ETL", "TI", "TI1", "TI2", "fov", "bw", "sliceMm"];

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
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
  if (q.has(KEYS.ny)) { const n = nearestMatrix(Number(q.get(KEYS.ny)) || 128); out.nx = out.ny = n; }
  if (["20", "40", "80"].includes(q.get(KEYS.gMax))) out.gMax = Number(q.get(KEYS.gMax));
  if (["70", "150", "200"].includes(q.get(KEYS.slew))) out.slew = Number(q.get(KEYS.slew));
  if (q.has(KEYS.from)) out.from = q.get(KEYS.from).slice(0, 40);
  return out;
}

// Whether a setting applies to the chosen sequence (and inversion).
export function applies(key, s) {
  const inv = INVERSION_SEQS.includes(s.seq) ? s.inversion ?? "none" : "none";
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

// p: the contrast simulator's parameters ({ seq, TR, TE, TI, TI1, TI2, FA, ETL, phaseMatrix, fovRead, BW, sliceMm }).
export function fromContrast(p) {
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
  if (seq === "EPI") out.bw = Math.max(out.bw, 1500); // EPI reads each line in well under a millisecond
  if (map.inversion === "IR") Object.assign(out, { inversion: "IR", TI: clamp(p.TI, RANGES.TI) });
  if (map.inversion === "DIR") Object.assign(out, { inversion: "DIR", TI1: clamp(p.TI1, RANGES.TI1), TI2: clamp(p.TI2, RANGES.TI2) });
  return out;
}

export const explorerUrl = (base, p) => `${base}?${toQuery(fromContrast(p))}`;
