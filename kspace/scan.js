// DOM-free scan model for the k-space explorer: one sequence per TR ("shot"), with its k-space samples.
//
// With several slices, every slice block in a TR plays the same phase-encode rows as the single-slice sequence, so
// each block samples exactly the single-slice k positions, offset in time by its place in the acquisition order
// (tested in shared/sequence.test.js and scan.test.js). The scan therefore keeps only the single-slice shots, which
// cost the same at any slice count, and builds the full N-block sequence of a TR only when it is displayed
// (diagram, cursor, playback), keeping a few of those. With one slice the two are the same objects.
import { BUILDERS, gradEnd } from "../shared/sequence.js";
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

// name: "SE" | "GRE" | "FSE" | "EPI"; P: builder parameters (as the explorer's params()).
// Returns { first, eff, N, shots, offset(j), full(i) }:
//   first      the full sequence of the first TR (for timing, errors, info and the cross-talk)
//   shots[i]   TR i as one slice: { seq, prep, samples [{ t, col, row, slice: 0 }], activeEnd, path }
//   offset(j)  ms from a single-slice time to the same moment in slice j's block
//   full(i)    TR i with every slice block: { seq, prep, samples (time order, with slice), activeEnd, path }
export function buildShots(name, P) {
  const { rowsPerShot, eff } = shotRows(name, P);
  const first = buildOne(name, P, rowsPerShot[0]);
  const slices = first.info.slices, N = slices?.length ?? 1;
  if (N <= 1) {
    const shots = rowsPerShot.map((rows, i) => shotOf(i === 0 ? first : buildOne(name, P, rows)));
    return { first, eff, N, shots, offset: () => 0, full: (i) => shots[i] };
  }
  const single = { ...P, slices: 1, inversion: "none", TR: first.tr };
  const shots = rowsPerShot.map((rows) => shotOf(buildOne(name, single, rows)));
  const block = first.info.block;
  const byAcq = [...slices].sort((a, b) => a.acq - b.acq).map((s) => s.index); // slice played at each block
  const offset = (j) => slices[j].acq * block;
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
  return { first, eff, N, shots, offset, full };
}
