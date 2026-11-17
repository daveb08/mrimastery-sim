// DOM-free echo-train (fast spin echo) weighting. Each echo of the train is read at a different echo time, so each k-space
// line carries a different amount of T2 decay. The echo at the effective TE fills the centre of k-space and sets the
// contrast of large structures; the other echoes fill the outer lines, which changes fine detail: later, weaker echoes
// blur it, most for short-T2 tissue. Weights are relative to the effective echo, so bulk signal is unchanged.
// Not modelled: magnetisation transfer from the refocusing pulses, imperfect refocusing, and J-coupling in fat.
import { acquiredRows, echoTrainReadouts } from "./acquisition.js";

export const ECHO_TRAIN_SEQUENCES = ["FSE", "FLAIR", "STIR", "DIR"];

// Weight of each echo (index 0 = first echo) relative to the effective echo: exp(-(e - effIdx) x spacing / T2).
export function echoWeights(etl, effIdx, espMs, T2) {
  const n = Math.max(1, etl), e0 = Math.max(0, Math.min(n - 1, effIdx));
  return Array.from({ length: n }, (_, e) => (e === e0 ? 1 : Math.exp((-(e - e0) * espMs) / T2)));
}

// Weight of each k-space row (shifted order, row ny/2 is ky = 0), using the same segment order as the fill animation.
// Rows that partial Fourier never acquires keep weight 1; the zero filling deals with them.
export function rowWeights(ny, pfFraction, etl, effIdx, espMs, T2) {
  const w = new Float64Array(ny).fill(1);
  if (!(etl > 1)) return w;
  const readouts = echoTrainReadouts(acquiredRows(ny, pfFraction ?? 1), etl, effIdx);
  const nEchoes = readouts.reduce((m, r) => Math.max(m, r.echo + 1), 1);
  const ew = echoWeights(nEchoes, effIdx, espMs, T2);
  for (const r of readouts) w[r.row] = ew[r.echo];
  return w;
}

// Mean weight over the acquired rows: the peak signal of a structure one pixel wide in the phase direction, relative to
// the same scan with a single echo. It can exceed 1 when the early, stronger echoes fill the outer lines.
export function detailFactor(ny, pfFraction, etl, effIdx, espMs, T2) {
  const w = rowWeights(ny, pfFraction, etl, effIdx, espMs, T2), rows = acquiredRows(ny, pfFraction ?? 1);
  return rows.reduce((s, r) => s + w[r], 0) / rows.length;
}

// Blur along the phase direction in pixels: the energy width of the point-spread function, N x sum(w^2) / sum(w)^2 over the
// acquired rows. It is 1 for equal weights (whatever their size) and grows as fewer lines carry most of the signal. Unlike
// the mean weight it does not read as "sharper" when the early, stronger echoes fill the outer lines.
export function blurFactor(weights, ny, pfFraction) {
  let s = 0, s2 = 0, n = 0;
  for (const r of acquiredRows(ny, pfFraction ?? 1)) { s += weights[r]; s2 += weights[r] * weights[r]; n++; }
  return s > 0 ? Math.max(1, (n * s2) / (s * s)) : 1;
}

// Echo spacing, train duration and, per tissue, the mean line weight (the peak of a one-pixel structure relative to a
// single-echo scan) and the blur in pixels. null for sequences without an echo train.
export function echoTrainSummary(p, model) {
  if (!ECHO_TRAIN_SEQUENCES.includes(p.seq)) return null;
  const espMs = model.timing.espMs, effIdx = model.timing.effIdx ?? 0;
  const detail = {}, blur = {};
  for (const [name, t] of Object.entries(model.tissues)) {
    detail[name] = detailFactor(p.phaseMatrix, p.pfFraction, p.ETL, effIdx, espMs, t.T2);
    blur[name] = blurFactor(rowWeights(p.phaseMatrix, p.pfFraction, p.ETL, effIdx, espMs, t.T2), p.phaseMatrix, p.pfFraction);
  }
  return { espMs, effIdx, trainMs: p.ETL * espMs, detail, blur };
}
