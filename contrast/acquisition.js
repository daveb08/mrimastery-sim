// DOM-free k-space acquisition orders for the fill animation. A plan is an ordered list of readouts, each one k-space
// row read left-to-right (dir +1) or right-to-left (dir -1), grouped into TRs. Progress is a real number t: readouts
// before floor(t) are complete and readout floor(t) is a fraction t - floor(t) of the way along. Rows are in shifted
// k-space order (row 0 = most negative ky); only rows acquired under partial Fourier appear.
import { partialFourierRows } from "./kspace.js";

const FSE_FAMILY = ["FSE", "FLAIR", "STIR", "DIR"];
const SINGLE_SHOT = ["EPI (single-shot)", "DWI"];
export const SIMPLE_ROWS = 16; // rows in the simplified trajectory
const SIMPLE_MAX_ETL = 4; // echo-train length in the simplified trajectory, so its segments stay visible

export function acquiredRows(ny, pf) {
  const { first } = partialFourierRows(ny, pf);
  return Array.from({ length: ny - first }, (_, i) => first + i);
}

// Echo-train order: k-space is cut into ETL segments; each shot (TR) takes one line from every segment, echo e going to
// segment (e - effIdx + centre) mod ETL, so the effective echo always lands in the centre segment (the one holding ky = 0).
export function echoTrainReadouts(rows, etl, effIdx) {
  const L = Math.max(1, Math.min(etl, rows.length));
  const segLen = Math.ceil(rows.length / L);
  const segments = Array.from({ length: L }, (_, s) => rows.slice(s * segLen, (s + 1) * segLen)).filter((s) => s.length);
  const n = segments.length; // can be < L when the lines do not divide evenly
  const ky0 = Math.floor((rows[rows.length - 1] + 1) / 2); // rows always end at ny - 1, so ky = 0 is row floor(ny / 2)
  const found = segments.findIndex((s) => s.includes(ky0));
  const centreSeg = found >= 0 ? found : Math.floor(n / 2);
  const e0 = Math.max(0, Math.min(n - 1, effIdx));
  const out = [];
  for (let shot = 0; shot < segLen; shot++) {
    for (let e = 0; e < n; e++) {
      const seg = segments[(((e - e0 + centreSeg) % n) + n) % n];
      if (shot < seg.length) out.push({ row: seg[shot], dir: 1, echo: e, group: shot });
    }
  }
  return out;
}

export const linearReadouts = (rows) => rows.map((row, i) => ({ row, dir: 1, group: i }));

// Single-shot EPI: every line in one TR, read left-to-right then right-to-left alternately.
export const zigzagReadouts = (rows) => rows.map((row, i) => ({ row, dir: i % 2 === 0 ? 1 : -1, group: 0 }));

// The plan for the current parameters. effIdx is the model's effective-echo index; scanSec the model's scan time.
// With simple = true the same order is laid out on a coarse SIMPLE_ROWS x SIMPLE_ROWS grid, for display only.
export function acquisitionPlan(p, nx, ny, { effIdx = 0, scanSec = 0, simple = false } = {}) {
  if (simple) { nx = SIMPLE_ROWS; ny = SIMPLE_ROWS; }
  const rows = acquiredRows(ny, p.pfFraction ?? 1);
  let readouts, label;
  if (FSE_FAMILY.includes(p.seq)) {
    const etl = simple ? Math.min(p.ETL, SIMPLE_MAX_ETL) : p.ETL;
    // keep the effective echo at the same relative position along the (shorter) simplified train
    const e0 = simple ? Math.round((effIdx * (Math.min(etl, rows.length) - 1)) / Math.max(1, p.ETL - 1)) : effIdx;
    readouts = echoTrainReadouts(rows, etl, e0);
    label = `Segmented echo train: each TR fills ${Math.min(etl, rows.length)} lines, one per segment; the TEeff echo fills the centre segment`;
  } else if (SINGLE_SHOT.includes(p.seq)) {
    readouts = zigzagReadouts(rows);
    label = "Single shot: every line in one TR, read in alternating directions (EPI zigzag), stepping down one line per blip";
  } else {
    readouts = linearReadouts(rows);
    label = p.seq === "MPRAGE"
      ? "Linear: one ky line per inversion block, always read left to right (each block also steps through the partitions, not shown)"
      : "Linear: one ky line per TR, always read left to right, then a jump to the next line";
  }
  const groupStarts = [];
  readouts.forEach((r, i) => { if (i === 0 || r.group !== readouts[i - 1].group) groupStarts.push(i); });
  const nex = Math.max(1, p.NEX ?? 1);
  const unit = SINGLE_SHOT.includes(p.seq) ? "line" : p.seq === "MPRAGE" ? "inversion block" : "TR";
  return { readouts, groupStarts, label, rows, nx, ny, passSec: scanSec / nex, nex, unit, zigzag: SINGLE_SHOT.includes(p.seq) };
}

const clampT = (plan, t) => Math.max(0, Math.min(plan.readouts.length, t));

// Fill state at progress t: 1 = acquired, 2 = the readout in progress (highlighted). Nothing is highlighted once complete.
export function maskAt(plan, t) {
  const { nx, ny, readouts } = plan;
  const mask = new Uint8Array(nx * ny);
  t = clampT(plan, t);
  const i = Math.floor(t);
  for (let k = 0; k < i; k++) mask.fill(1, readouts[k].row * nx, (readouts[k].row + 1) * nx);
  if (i < readouts.length) {
    const { row, dir } = readouts[i], n = Math.round((t - i) * nx);
    if (dir > 0) mask.fill(2, row * nx, row * nx + n);
    else mask.fill(2, row * nx + nx - n, (row + 1) * nx);
  }
  return mask;
}

// "TR 5 of 32", "line 114 of 256", ... at progress t (the unit being worked on; 0 before the start).
export function progressLabel(plan, t) {
  t = clampT(plan, t);
  if (plan.unit === "line") return `line ${Math.ceil(t)} of ${plan.readouts.length}`;
  const r = Math.ceil(t) - 1;
  const g = r < 0 ? 0 : plan.groupStarts.filter((s) => s <= r).length;
  return `${plan.unit} ${g} of ${plan.groupStarts.length}`;
}

// Progress at the start of the next (+1) or previous (-1) unit: one line for EPI, one TR (group) otherwise.
export function stepProgress(plan, t, direction) {
  t = clampT(plan, t);
  const marks = plan.unit === "line" ? plan.readouts.map((_, i) => i) : [...plan.groupStarts];
  marks.push(plan.readouts.length);
  if (direction > 0) return marks.find((m) => m > t + 1e-9) ?? plan.readouts.length;
  return [...marks].reverse().find((m) => m < t - 1e-9) ?? 0;
}

// The path traced up to progress t, in fractions of the k-space width and height (x across kx, y down ky):
// readouts, the phase-encode blips that join EPI lines, and the jumps between separately read lines.
export function trajectory(plan, t) {
  const { ny, readouts } = plan;
  t = clampT(plan, t);
  const y = (row) => (row + 0.5) / ny;
  const xStart = (r) => (r.dir > 0 ? 0 : 1), xEnd = (r) => (r.dir > 0 ? 1 : 0);
  const segments = [];
  const i = Math.min(Math.floor(t), readouts.length - 1);
  const f = t >= readouts.length ? 1 : t - Math.floor(t);
  let dot = null;
  for (let k = 0; k <= i; k++) {
    const r = readouts[k];
    if (k > 0) {
      const prev = readouts[k - 1];
      segments.push({ x0: xEnd(prev), y0: y(prev.row), x1: xStart(r), y1: y(r.row), kind: plan.zigzag ? "blip" : "jump" });
    }
    const x1 = xStart(r) + (xEnd(r) - xStart(r)) * (k < i ? 1 : f);
    segments.push({ x0: xStart(r), y0: y(r.row), x1, y1: y(r.row), kind: k === i && t < readouts.length ? "current" : "readout" });
    if (k === i) dot = { x: x1, y: y(r.row), dir: r.dir };
  }
  return { segments, dot: t > 0 && t < readouts.length ? dot : null };
}
