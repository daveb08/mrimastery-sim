// DOM-free scan model for the k-space explorer: one sequence per TR ("shot"), with its k-space samples.
//
// With several slices, every slice block in a TR plays the same phase-encode rows as the single-slice sequence, so
// each block samples exactly the single-slice k positions, offset in time by its place in the acquisition order
// (tested in shared/sequence.test.js and scan.test.js). The scan therefore keeps only the single-slice shots, which
// cost the same at any slice count, and builds the full N-block sequence of a TR only when it is displayed
// (diagram, cursor, playback), keeping a few of those. With one slice the two are the same objects.
//
// With several concatenations (passes), a scan shows one pass: the one that holds the selected slice. Its sequence
// plays only that pass's slices (info.slices lists them, each with its full-stack `index`).
import { BUILDERS, gradEnd, sliceTiming } from "../shared/sequence.js";
import { crossTalk } from "../shared/crosstalk.js";
import { prepare, adcSamples } from "../shared/ktraj.js";
import { echoTrainReadouts, acquiredRows } from "../contrast/acquisition.js";

const FULL_KEEP = 4; // full N-block shots kept besides the first

function fseShots(P) {
  const probe = BUILDERS.FSE(P, Array.from({ length: P.ETL }, (_, i) => i));
  const eff = Math.max(0, Math.min(P.ETL - 1, Math.round(P.TE / probe.info.esp) - 1));
  const ro = echoTrainReadouts(acquiredRows(P.ny, 1), P.ETL, eff);
  return { rows: [...new Set(ro.map((r) => r.group))].map((g) => ro.filter((r) => r.group === g).map((r) => r.row)), eff };
}

// k-space rows of each TR, and (FSE) the effective echo index
export function shotRows(name, P) {
  if (name === "SE" || name === "GRE") return { rowsPerShot: acquiredRows(P.ny, 1).map((r) => [r]) };
  if (name === "EPI") return { rowsPerShot: [acquiredRows(P.ny, 1)] };
  const { rows, eff } = fseShots(P);
  return { rowsPerShot: rows, eff };
}

const buildOne = (name, P, rows) => (name === "SE" ? BUILDERS.SE(P, rows[0]) : name === "GRE" ? BUILDERS.GRE(P, rows[0])
  : name === "EPI" ? BUILDERS.EPI(P, rows) : BUILDERS.FSE(P, rows));

const activeEndOf = (seq) => Math.max(...seq.events.filter((e) => e.kind === "grad").map(gradEnd));

function shotOf(seq) {
  const prep = prepare(seq);
  const samples = adcSamples(seq, prep).map((s) => ({ t: s.t, col: Math.round(s.colExact), row: Math.round(s.rowExact), slice: s.slice ?? 0 }));
  return { seq, prep, samples, activeEnd: activeEndOf(seq), path: null };
}

const rowsArg = (name, rows) => (name === "SE" || name === "GRE" ? rows[0] : rows);
const stackSize = (P) => Math.max(1, Math.floor(P.slices ?? 1));
// The pass (concatenation) that holds full-stack slice sel: concatenation k holds slices k, k + C, ...
const passOf = (sel, C) => (Number.isInteger(sel) && sel >= 0 ? sel % C : 0);
const concatenationsOf = (name, P, rows) => (stackSize(P) > 1 ? sliceTiming({ ...P, seq: name }, rowsArg(name, rows)).concatenations : 1);

// name: "SE" | "GRE" | "FSE" | "EPI"; P: builder parameters (kspace/settings.js explorerParams); sel: the selected
// slice (full-stack index), whose pass is played (without sel, P.pass).
// Returns { first, eff, N, C, pass, shots, offset(j), full(i), scanMs }:
//   first      the full sequence of the first TR (for timing, errors, info and the cross-talk)
//   N, C, pass slices in the whole stack, concatenations, and the pass shown
//   shots[i]   TR i as one slice: { seq, prep, samples [{ t, col, row, slice: 0 }], activeEnd, path }
//   offset(j)  ms from a single-slice time to the same moment in full-stack slice j's block (null: not in this pass)
//   full(i)    TR i with every slice block: { seq, prep, samples (time order, with slice), activeEnd, path }
//   scanMs     TR x TRs to fill k-space x concatenations
export function buildShots(name, P0, sel) {
  const { rowsPerShot, eff } = shotRows(name, P0);
  const C = concatenationsOf(name, P0, rowsPerShot[0]);
  const P = sel === undefined ? P0 : { ...P0, pass: passOf(sel, C) };
  const first = buildOne(name, P, rowsPerShot[0]);
  const slices = first.info.slices, N = stackSize(P), pass = first.info.pass ?? 0;
  const scanMs = first.tr * rowsPerShot.length * C;
  if (N <= 1) {
    const shots = rowsPerShot.map((rows, i) => shotOf(i === 0 ? first : buildOne(name, P, rows)));
    return { first, eff, N, C, pass, shots, offset: () => 0, full: (i) => shots[i], scanMs };
  }
  const single = { ...P, slices: 1, inversion: "none", TR: first.tr };
  const shots = rowsPerShot.map((rows) => shotOf(buildOne(name, single, rows)));
  const block = first.info.block;
  const byAcq = [...slices].sort((a, b) => a.acq - b.acq).map((s) => s.index); // slice played at each block
  const byIndex = new Map(slices.map((s) => [s.index, s]));
  const offset = (j) => (byIndex.has(j) ? byIndex.get(j).acq * block : null);
  const kept = new Map();
  const full = (i) => {
    let shot = kept.get(i);
    if (shot) return shot;
    const seq = i === 0 ? first : buildOne(name, P, rowsPerShot[i]);
    const samples = [];
    byAcq.forEach((j, a) => {
      const dt = a * block;
      for (const p of shots[i].samples) samples.push({ t: p.t + dt, col: p.col, row: p.row, slice: j });
    });
    shot = { seq, prep: prepare(seq), samples, activeEnd: activeEndOf(seq), path: null };
    if (i !== 0 && kept.size > FULL_KEEP) for (const k of kept.keys()) if (k !== 0) { kept.delete(k); break; }
    kept.set(i, shot);
    return shot;
  };
  return { first, eff, N, C, pass, shots, offset, full, scanMs };
}

// Cross-talk of the whole stack: one crossTalk per pass, each on its own pass's first sequence (slices in other passes
// are seconds away and count as recovered). Returns null for one slice, else
//   { slices: [N, by full-stack index: { index, zMm, acq (within its pass), pass, freqHz, factor, mzBefore }],
//     passes: [C crossTalk results, each with its own z grid, slices and profiles] }
export function stackCrossTalk(name, P, tissues) {
  if (stackSize(P) <= 1) return null;
  const rows = shotRows(name, P).rowsPerShot[0];
  const C = concatenationsOf(name, P, rows);
  const passes = Array.from({ length: C }, (_, k) => crossTalk(buildOne(name, { ...P, pass: k }, rows), tissues));
  const slices = [];
  passes.forEach((xt, k) => { for (const s of xt.slices) slices[s.index] = { ...s, pass: k }; });
  return { slices, passes };
}
