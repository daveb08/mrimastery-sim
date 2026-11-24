import { test } from "node:test";
import assert from "node:assert/strict";
import { magnetization, windowMs, clampBench, niceStep } from "./bench.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("right after a 90° pulse Mz is 0 and Mxy is 1", () => {
  const m = magnetization(0, { flip: 90, t1: 780, t2: 90 });
  close(m.z, 0, 1e-12);
  close(m.xy, 1);
});

test("a 30° pulse gives Mxy = sin 30° = 0.5 and leaves Mz = cos 30°", () => {
  const m = magnetization(0, { flip: 30, t1: 780, t2: 90 });
  close(m.xy, 0.5);
  close(m.z, Math.cos(Math.PI / 6));
});

test("a 180° pulse inverts Mz, which crosses zero at T1 ln 2", () => {
  const p = { flip: 180, t1: 1000, t2: 100 };
  close(magnetization(0, p).z, -1);
  close(magnetization(1000 * Math.LN2, p).z, 0, 1e-12);
  close(magnetization(0, p).xy, 0, 1e-12);
});

test("Mxy decays to 1/e at T2 and Mz recovers to 1 - 1/e at T1 after a 90° pulse", () => {
  const p = { flip: 90, t1: 780, t2: 90 };
  close(magnetization(90, p).xy, Math.exp(-1));
  close(magnetization(780, p).z, 1 - Math.exp(-1));
});

test("the time window covers the slower of T1 recovery and T2 decay, within limits", () => {
  assert.equal(windowMs(780, 90), 2340);
  assert.equal(windowMs(100, 20), 600);
  assert.equal(windowMs(4000, 2000), 10000);
  assert.ok(windowMs(4500, 2500) <= 12500);
});

test("clampBench keeps values in range and T2 at or below T1", () => {
  assert.deepEqual(clampBench({ flip: 400, t1: 50, t2: 9000 }), { flip: 180, t1: 200, t2: 200 });
  assert.deepEqual(clampBench({ flip: "45", t1: "1100", t2: "100" }), { flip: 45, t1: 1100, t2: 100 });
  assert.deepEqual(clampBench({}, { flip: 90, t1: 780, t2: 90 }), { flip: 90, t1: 780, t2: 90 });
});

test("niceStep gives about four to five round ticks", () => {
  assert.equal(niceStep(2340), 500);
  assert.equal(niceStep(600), 200);
  assert.equal(niceStep(10000), 2000);
});
