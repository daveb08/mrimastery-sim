// DOM-free signal-versus-parameter sweeps for the curves tab. They call the same tissueSignal() as the model,
// so a curve always passes through the value shown in the bars. Signals are physics values (before voxel scaling).
import { tissuesAt, tissueSignal, TISSUE_NAMES } from "./physics.js";

// Which parameter each curve sweeps, per sequence.
export function sweepSpec(seq, p) {
  const first = ["FLAIR", "STIR", "MPRAGE"].includes(seq)
    ? { key: "TI", label: "TI (ms)", max: Math.max(2 * p.TI, 600) }
    : { key: "TR", label: "TR (ms)", max: seq === "bSSFP" ? 20 : Math.max(2 * p.TR, 1000) };
  const second = seq === "bSSFP"
    ? { key: "FA", label: "Flip angle (°)", max: 90 }
    : { key: "TE", label: "TE (ms)", max: Math.max(2.5 * p.TE, 40) };
  return { first, second };
}

export function sweep(seq, p, key, max, n = 120) {
  const tissues = tissuesAt(p.field);
  const x = Array.from({ length: n }, (_, i) => (max * (i + 1)) / n);
  const y = {};
  for (const name of TISSUE_NAMES) {
    y[name] = x.map((v) => tissueSignal(seq, { ...p, [key]: v, ...(seq === "bSSFP" && key === "TR" ? { TE: v / 2 } : {}) },
      tissues[name], name === "Fat"));
  }
  return { x, y };
}

// ---- CNR curves: the difference in SNR between two tissues, swept over the same parameter as the signal curves ----
export const CNR_PAIRS = [
  { key: "wmGm", a: "WM", b: "GM", label: "WM–GM" },
  { key: "wmCsf", a: "WM", b: "CSF", label: "WM–CSF" },
  { key: "gmCsf", a: "GM", b: "CSF", label: "GM–CSF" },
];

// CNR against one parameter, in the model's own CNR units: signal difference x voxel-volume scale / noise. TR, TE, TI and
// flip angle do not change the noise, so one scale serves the whole sweep. Cross-talk factors are held at their current
// values. The model rounds each signal to two decimals before dividing by the noise; this does not, so the curve can sit
// a little off the number on the page (by at most 0.02 / noise).
// peak is the highest point of the WM-GM curve, or null when that is at either end of the sweep (still rising or falling).
export function cnrSweep(p, model, key, max, n = 120) {
  const { x, y: s } = sweep(p.seq, p, key, max, n);
  const scale = (model.volScale * Math.sqrt(p.pfFraction ?? 1)) / model.noiseFloor;
  const ct = model.crossTalk ?? {};
  const y = {};
  for (const { key: k, a, b } of CNR_PAIRS) y[k] = x.map((_, i) => Math.abs(s[a][i] * (ct[a] ?? 1) - s[b][i] * (ct[b] ?? 1)) * scale);
  let top = 0;
  for (let i = 1; i < n; i++) if (y.wmGm[i] > y.wmGm[top]) top = i;
  return { x, y, peak: top > 0 && top < n - 1 ? { x: x[top], y: y.wmGm[top] } : null };
}
