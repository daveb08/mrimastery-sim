import test from "node:test";
import assert from "node:assert/strict";
import { sweep, sweepSpec, cnrSweep, CNR_PAIRS } from "./curves.js";
import { defaultParams, computeModel, tissuesAt, tissueSignal, SEQUENCES } from "./physics.js";

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

// ---- CNR curves ----

test("a CNR sweep passes through the model's three CNR numbers at the current setting", () => {
  const p = { ...defaultParams("FSE", "3.0T"), TE: 100 }, m = computeModel(p);
  const { x, y } = cnrSweep(p, m, "TE", 200, 120); // step 200 / 120, so TE 100 is a grid point
  const i = x.findIndex((v) => Math.abs(v - 100) < 1e-9);
  assert.ok(i >= 0);
  const tol = 0.02 / m.noiseFloor; // the model rounds each signal to two decimals before dividing by the noise
  for (const { key } of CNR_PAIRS) assert.ok(Math.abs(y[key][i] - m.cnr[key]) <= tol, `${key}: ${y[key][i]} vs ${m.cnr[key]}`);
  assert.deepEqual(CNR_PAIRS.map((c) => c.key), ["wmGm", "wmCsf", "gmCsf"]);
});

test("grey/white CNR on a long-TR spin echo at 3 T peaks at a TE near 60 ms", () => {
  const p = defaultParams("FSE", "3.0T"), m = computeModel(p); // TR 4000
  const { peak, x } = cnrSweep(p, m, "TE", 200, 120);
  assert.ok(Math.abs(peak.x - 59.5) <= x[1] - x[0], `peak at TE ${peak.x}`);
  assert.equal(peak.y, Math.max(...cnrSweep(p, m, "TE", 200, 120).y.wmGm));
});

test("no peak is reported when grey/white CNR is still rising or falling at the end of the sweep", () => {
  const p = { ...defaultParams("FSE", "3.0T"), TE: 15, TR: 600 }, m = computeModel(p);
  assert.equal(cnrSweep(p, m, "TE", 12, 60).peak, null); // far below the peak TE: still rising at the right-hand edge
});

test("CNR scales with the model: four averages double it, and cross-talk factors are applied per tissue", () => {
  const p = defaultParams("FSE", "3.0T");
  const a = cnrSweep(p, computeModel(p), "TE", 200, 40);
  const p4 = { ...p, NEX: 4 }, b = cnrSweep(p4, computeModel(p4), "TE", 200, 40);
  for (let i = 0; i < 40; i++) assert.ok(Math.abs(b.y.wmGm[i] - 2 * a.y.wmGm[i]) < 1e-9);
  const crossTalk = { WM: 0.5, GM: 0.5, CSF: 0.5, Fat: 0.5 };
  const c = cnrSweep(p, computeModel(p, { crossTalk }), "TE", 200, 40);
  for (let i = 0; i < 40; i++) assert.ok(Math.abs(c.y.gmCsf[i] - 0.5 * a.y.gmCsf[i]) < 1e-9);
});

test("every sequence yields finite, non-negative CNR sweeps for both axes", () => {
  for (const seq of SEQUENCES) {
    const p = defaultParams(seq, "3.0T"), m = computeModel(p);
    const { first, second } = sweepSpec(seq, p);
    for (const s of [first, second]) {
      const { y } = cnrSweep(p, m, s.key, s.max, 40);
      for (const arr of Object.values(y)) for (const v of arr) assert.ok(Number.isFinite(v) && v >= 0, `${seq} ${s.key}`);
    }
  }
});
