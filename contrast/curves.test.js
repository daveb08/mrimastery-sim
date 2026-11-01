import test from "node:test";
import assert from "node:assert/strict";
import { sweep, sweepSpec } from "./curves.js";
import { defaultParams, tissuesAt, tissueSignal, SEQUENCES } from "./physics.js";

test("a TR sweep passes through the model's value at the current TR", () => {
  const p = defaultParams("FSE", "3.0T"); // TR 4000
  const { x, y } = sweep("FSE", p, "TR", 2 * p.TR, 120);
  const i = x.findIndex((v) => Math.abs(v - p.TR) < 1e-9);
  assert.ok(i >= 0);
  assert.equal(y.WM[i], tissueSignal("FSE", p, tissuesAt("3.0T").WM, false));
});

test("every sequence yields finite, non-negative sweeps for both axes", () => {
  for (const seq of SEQUENCES) {
    const p = defaultParams(seq, "3.0T");
    const { first, second } = sweepSpec(seq, p);
    for (const s of [first, second]) {
      const { y } = sweep(seq, p, s.key, s.max, 40);
      for (const arr of Object.values(y)) for (const v of arr) assert.ok(Number.isFinite(v) && v >= 0, `${seq} ${s.key}`);
    }
  }
});

test("T1 recovery rises with TR for spin echo", () => {
  const p = defaultParams("FSE", "3.0T");
  const { y } = sweep("FSE", p, "TR", 6000, 60);
  assert.ok(y.GM[59] > y.GM[0]);
});
