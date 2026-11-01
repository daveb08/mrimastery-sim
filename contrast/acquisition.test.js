import test from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionPlan, acquiredRows, echoTrainReadouts, maskAt, progressLabel, stepProgress, trajectory, SIMPLE_ROWS,
} from "./acquisition.js";
import { defaultParams, SEQUENCES } from "./physics.js";

test("every sequence reads each acquired row exactly once (with and without partial Fourier, full and simplified)", () => {
  for (const seq of [...SEQUENCES, "DWI"]) {
    for (const pf of [1, 5 / 8]) {
      for (const [nx, ny, simple] of [[256, 256, false], [320, 224, false], [64, 96, false], [256, 256, true]]) {
        const plan = acquisitionPlan({ ...defaultParams(seq, "3.0T"), pfFraction: pf }, nx, ny, { effIdx: 3, scanSec: 60, simple });
        const rows = plan.readouts.map((r) => r.row).sort((a, b) => a - b);
        assert.deepEqual(rows, acquiredRows(simple ? SIMPLE_ROWS : ny, pf), `${seq} pf ${pf} ${nx}x${ny} simple ${simple}`);
        const done = maskAt(plan, plan.readouts.length);
        const want = new Set(rows);
        for (let r = 0; r < plan.ny; r++) assert.equal(done[r * plan.nx], want.has(r) ? 1 : 0);
      }
    }
  }
});

test("linear orders (GRE, bSSFP, MPRAGE) read one line per TR, top to bottom, always left to right", () => {
  for (const seq of ["GRE", "bSSFP", "MPRAGE"]) {
    const plan = acquisitionPlan(defaultParams(seq, "3.0T"), 64, 64, {});
    assert.equal(plan.groupStarts.length, 64);
    plan.readouts.forEach((r, i) => { assert.equal(r.row, i); assert.equal(r.dir, 1); });
  }
});

test("echo trains read ETL lines per TR, and the effective echo lands on the centre of k-space", () => {
  const ny = 256, rows = acquiredRows(ny, 1);
  for (const [etl, effIdx] of [[16, 3], [8, 0], [4, 3], [32, 10], [1, 0]]) {
    const ro = echoTrainReadouts(rows, etl, effIdx);
    assert.equal(new Set(ro.map((r) => r.group)).size, Math.ceil(ny / etl));
    assert.equal(ro.filter((r) => r.group === 0).length, etl);
    assert.equal(ro.find((r) => r.row === ny / 2).echo, effIdx, `ETL ${etl}`);
  }
  const uneven = echoTrainReadouts(acquiredRows(224, 5 / 8), 16, 5); // 140 rows, from 84 to 223
  assert.deepEqual(uneven.map((r) => r.row).sort((a, b) => a - b), acquiredRows(224, 5 / 8));
  assert.equal(uneven.find((r) => r.row === 112).echo, 5);
});

test("EPI reads every line in one TR, alternating direction, joined by blips", () => {
  const plan = acquisitionPlan(defaultParams("EPI (single-shot)", "3.0T"), 64, 32, {});
  assert.equal(plan.groupStarts.length, 1);
  plan.readouts.forEach((r, i) => { assert.equal(r.row, i); assert.equal(r.dir, i % 2 === 0 ? 1 : -1); });
  const { segments } = trajectory(plan, 3);
  const blips = segments.filter((s) => s.kind === "blip");
  assert.equal(blips.length, 3);
  for (const b of blips) assert.equal(b.x0, b.x1); // a blip only moves in ky
  assert.ok(segments.every((s) => s.kind !== "jump"));
});

test("Cartesian non-EPI trajectories jump back to the left between lines", () => {
  const plan = acquisitionPlan(defaultParams("GRE", "3.0T"), 8, 8, {});
  const jumps = trajectory(plan, 4).segments.filter((s) => s.kind === "jump");
  assert.equal(jumps.length, 4);
  for (const j of jumps) { assert.equal(j.x0, 1); assert.equal(j.x1, 0); }
});

test("the moving cursor travels along the current line in its read direction", () => {
  const plan = acquisitionPlan(defaultParams("EPI (single-shot)", "3.0T"), 64, 32, {});
  assert.deepEqual(trajectory(plan, 0.25).dot, { x: 0.25, y: 0.5 / 32, dir: 1 });
  const d = trajectory(plan, 1.25).dot; // second line, read right to left
  assert.ok(Math.abs(d.x - 0.75) < 1e-12 && d.dir === -1);
  assert.equal(trajectory(plan, 0).dot, null);
  assert.equal(trajectory(plan, plan.readouts.length).dot, null);
});

test("the mask fills part of the current line from its starting side, and drops the highlight when complete", () => {
  const plan = acquisitionPlan(defaultParams("EPI (single-shot)", "3.0T"), 4, 4, {});
  const m = maskAt(plan, 1.5); // line 0 done, line 1 half read from the right
  assert.deepEqual(Array.from(m.slice(0, 8)), [1, 1, 1, 1, 0, 0, 2, 2]);
  assert.ok(maskAt(plan, plan.readouts.length).every((v) => v === 1));
});

test("progress labels and step buttons work in the sequence's own units", () => {
  const epi = acquisitionPlan(defaultParams("EPI (single-shot)", "3.0T"), 64, 256, {});
  assert.equal(progressLabel(epi, 256), "line 256 of 256");
  assert.equal(progressLabel(epi, 85.3), "line 86 of 256");
  assert.equal(stepProgress(epi, 85.3, 1), 86);
  assert.equal(stepProgress(epi, 85.3, -1), 85);
  const fse = acquisitionPlan({ ...defaultParams("FSE", "3.0T"), ETL: 16 }, 8, 256, { effIdx: 3 });
  assert.equal(progressLabel(fse, 0), "TR 0 of 16");
  assert.equal(progressLabel(fse, 16 * 4 + 0.5), "TR 5 of 16");
  assert.equal(stepProgress(fse, 16 * 4 + 0.5, 1), 16 * 5);
  assert.equal(stepProgress(fse, 16 * 4 + 0.5, -1), 16 * 4);
  assert.equal(stepProgress(fse, 0, -1), 0);
  assert.equal(progressLabel(acquisitionPlan(defaultParams("MPRAGE", "3.0T"), 8, 256, {}), 83.5), "inversion block 84 of 256");
});

test("the simplified trajectory keeps the order's character on a 16-line grid", () => {
  const fse = acquisitionPlan({ ...defaultParams("FSE", "3.0T"), ETL: 16 }, 256, 256, { effIdx: 3, simple: true });
  assert.equal(fse.ny, SIMPLE_ROWS);
  assert.equal(fse.groupStarts.length, 4); // echo train shortened to 4: four TRs of four lines
  assert.ok(fse.label.includes("4 lines"));
  const epi = acquisitionPlan(defaultParams("EPI (single-shot)", "3.0T"), 256, 256, { simple: true });
  assert.equal(epi.readouts.length, SIMPLE_ROWS);
  assert.equal(epi.readouts[1].dir, -1);
});

test("the pass time divides out NEX", () => {
  const plan = acquisitionPlan({ ...defaultParams("GRE", "3.0T"), NEX: 2 }, 4, 4, { scanSec: 80 });
  assert.equal(plan.passSec, 40);
  assert.equal(plan.nex, 2);
});
