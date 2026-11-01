import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionPlan, acquiredRows, echoTrainSteps, maskAfter } from "./acquisition.js";
import { defaultParams, SEQUENCES } from "./physics.js";

// Every acquired k-space point is filled exactly once, and nothing outside the acquired rows.
function coverage(plan, nx, ny) {
  const count = new Uint16Array(nx * ny);
  for (const step of plan.steps) for (const { row, c0, c1 } of step) for (let c = c0; c < c1; c++) count[row * nx + c]++;
  return count;
}

test("every sequence fills each acquired point exactly once (with and without partial Fourier)", () => {
  for (const seq of [...SEQUENCES, "DWI"]) {
    for (const pf of [1, 5 / 8]) {
      for (const [nx, ny] of [[256, 256], [320, 224], [64, 96]]) {
        const p = { ...defaultParams(seq, "3.0T"), pfFraction: pf };
        const plan = acquisitionPlan(p, nx, ny, { effIdx: 3, scanSec: 60 });
        const count = coverage(plan, nx, ny);
        const rows = new Set(acquiredRows(ny, pf));
        for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
          assert.equal(count[r * nx + c], rows.has(r) ? 1 : 0, `${seq} pf ${pf} ${nx}x${ny} row ${r}`);
        }
      }
    }
  }
});

test("linear orders (GRE, bSSFP, MPRAGE) take one line per step, top to bottom", () => {
  for (const seq of ["GRE", "bSSFP", "MPRAGE"]) {
    const plan = acquisitionPlan(defaultParams(seq, "3.0T"), 64, 64, {});
    assert.equal(plan.steps.length, 64);
    plan.steps.forEach((step, i) => { assert.equal(step.length, 1); assert.equal(step[0].row, i); });
  }
});

test("echo trains fill ETL lines per TR, and the effective echo lands on the centre of k-space", () => {
  const ny = 256, nx = 8, rows = acquiredRows(ny, 1);
  for (const [etl, effIdx] of [[16, 3], [8, 0], [4, 3], [32, 10], [1, 0]]) {
    const steps = echoTrainSteps(rows, etl, effIdx, nx);
    assert.equal(steps.length, Math.ceil(ny / etl));
    assert.equal(steps[0].length, etl);
    // the line ky = 0 (row ny/2) is acquired by the effective echo
    const hit = steps.flat().find((s) => s.row === ny / 2);
    assert.equal(hit.echo, effIdx, `ETL ${etl}`);
  }
});

test("echo trains that do not divide evenly still cover every line once and keep ky = 0 on the effective echo", () => {
  const rows = acquiredRows(224, 5 / 8); // 140 rows, from 84 to 223
  const steps = echoTrainSteps(rows, 16, 5, 4);
  const seen = steps.flat().map((s) => s.row).sort((a, b) => a - b);
  assert.deepEqual(seen, rows);
  assert.equal(steps.flat().find((s) => s.row === 112).echo, 5);
});

test("EPI reads every line in one shot, alternating direction line by line", () => {
  const nx = 64, plan = acquisitionPlan(defaultParams("EPI (single-shot)", "3.0T"), nx, 32, {});
  const byRow = new Map();
  for (const [seg] of plan.steps) { if (!byRow.has(seg.row)) byRow.set(seg.row, []); byRow.get(seg.row).push(seg.c0); }
  const rows = [...byRow.keys()];
  assert.deepEqual(rows, Array.from({ length: 32 }, (_, i) => i));
  assert.ok(byRow.get(0)[0] < byRow.get(0)[1]); // left to right
  assert.ok(byRow.get(1)[0] > byRow.get(1)[1]); // right to left
});

test("the mask marks filled points and highlights the latest step; the pass time divides out NEX", () => {
  const plan = acquisitionPlan({ ...defaultParams("GRE", "3.0T"), NEX: 2 }, 4, 4, { scanSec: 80 });
  const m = maskAfter(plan, 2, 4, 4);
  assert.deepEqual(Array.from(m.slice(0, 8)), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(m[8], 0);
  assert.equal(maskAfter(plan, 0, 4, 4).every((v) => v === 0), true);
  assert.equal(plan.passSec, 40);
  assert.equal(plan.nex, 2);
});
