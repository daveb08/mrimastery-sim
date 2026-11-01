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
