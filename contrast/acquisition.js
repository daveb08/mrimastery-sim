// DOM-free k-space acquisition orders for the fill animation. A plan is a list of steps; each step is a list of
// segments { row, c0, c1 } (k-space row, columns c0 <= c < c1) filled at that step. Rows are in shifted k-space order
// (row 0 = most negative ky). Only rows acquired under partial Fourier appear.
import { partialFourierRows } from "./kspace.js";

const FSE_FAMILY = ["FSE", "FLAIR", "STIR", "DIR"];
const SINGLE_SHOT = ["EPI (single-shot)", "DWI"];
const EPI_CHUNKS = 4; // each EPI line is drawn in four pieces so the zigzag direction is visible

export function acquiredRows(ny, pf) {
  const { first } = partialFourierRows(ny, pf);
  return Array.from({ length: ny - first }, (_, i) => first + i);
}

// Echo-train order: k-space is cut into ETL segments; each shot (TR) takes one line from every segment, echo e going to
// segment (e - effIdx + centre) mod ETL, so the effective echo always lands in the centre segment (the one holding ky = 0).
export function echoTrainSteps(rows, etl, effIdx, nx) {
  const L = Math.max(1, Math.min(etl, rows.length));
  const segLen = Math.ceil(rows.length / L);
  const segments = Array.from({ length: L }, (_, s) => rows.slice(s * segLen, (s + 1) * segLen)).filter((s) => s.length);
  const n = segments.length; // can be < L when the lines do not divide evenly
  const centreSeg = centreSegment(segments, rows);
  const e0 = Math.max(0, Math.min(n - 1, effIdx));
  const steps = [];
  for (let shot = 0; shot < segLen; shot++) {
    const step = [];
    for (let e = 0; e < n; e++) {
      const seg = segments[(((e - e0 + centreSeg) % n) + n) % n];
      if (shot < seg.length) step.push({ row: seg[shot], c0: 0, c1: nx, echo: e });
    }
    if (step.length) steps.push(step);
  }
  return steps;
}

// Index of the segment that contains ky = 0 (row ny/2 of the full k-space), found from the rows' own numbering.
function centreSegment(segments, rows) {
  const ny0 = Math.floor((rows[rows.length - 1] + 1) / 2); // rows always end at ny - 1, so ky = 0 is row floor(ny / 2)
  const idx = segments.findIndex((s) => s.includes(ny0));
  return idx >= 0 ? idx : Math.floor(segments.length / 2);
}

export function linearSteps(rows, nx) {
  return rows.map((row) => [{ row, c0: 0, c1: nx }]);
}

// Single-shot EPI: every line in one TR, read left-to-right then right-to-left alternately.
export function zigzagSteps(rows, nx) {
  const steps = [];
  const w = Math.ceil(nx / EPI_CHUNKS);
  rows.forEach((row, k) => {
    for (let q = 0; q < EPI_CHUNKS; q++) {
      const a = Math.min(nx, q * w), b = Math.min(nx, (q + 1) * w);
      if (a >= b) continue;
      steps.push([k % 2 === 0 ? { row, c0: a, c1: b } : { row, c0: nx - b, c1: nx - a }]);
    }
  });
  return steps;
}

// The plan for the current parameters. effIdx is the model's effective-echo index; scanSec the model's scan time.
export function acquisitionPlan(p, nx, ny, { effIdx = 0, scanSec = 0 } = {}) {
  const rows = acquiredRows(ny, p.pfFraction ?? 1);
  let steps, label;
  if (FSE_FAMILY.includes(p.seq)) {
    steps = echoTrainSteps(rows, p.ETL, effIdx, nx);
    label = `Segmented echo train: each TR fills ${Math.min(p.ETL, rows.length)} lines, one per segment; echo ${effIdx + 1} (TEeff) fills the centre segment`;
  } else if (SINGLE_SHOT.includes(p.seq)) {
    steps = zigzagSteps(rows, nx);
    label = "Single shot: every line in one TR, read in alternating directions (EPI zigzag)";
  } else {
    steps = linearSteps(rows, nx);
    label = p.seq === "MPRAGE"
      ? "Linear: one ky line per inversion block (each block also steps through the partitions, not shown in this 2D view)"
      : "Linear: one ky line per TR, top to bottom";
  }
  const nex = Math.max(1, p.NEX ?? 1);
  return { steps, label, rows, passSec: scanSec / nex, nex };
}

// Fill state after `n` steps: 1 = acquired, 2 = acquired in the most recent step (highlighted).
export function maskAfter(plan, n, nx, ny) {
  const mask = new Uint8Array(nx * ny);
  const k = Math.max(0, Math.min(plan.steps.length, Math.floor(n)));
  for (let s = 0; s < k; s++) {
    const v = s === k - 1 ? 2 : 1;
    for (const { row, c0, c1 } of plan.steps[s]) mask.fill(v, row * nx + c0, row * nx + c1);
  }
  return mask;
}
