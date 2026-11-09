import test from "node:test";
import assert from "node:assert/strict";
import { runProgram, meanTransverse } from "./bloch.js";
import { minTrMs, buildProgram } from "./program.js";

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);
const base = { flip: 90, phase: 0, pdur: 0.5, shape: "rect", delay: 20, tr: 500, reps: 1 };

test("minTrMs per experiment", () => {
  near(minTrMs({ program: "se", delay: 20, pdur: 0.5 }), 41);
  near(minTrMs({ program: "ir", delay: 300, pdur: 0.5 }), 301);
  near(minTrMs({ program: "pulse", delay: 20, pdur: 0.5 }), 0.5);
});

test("buildProgram raises a too-short TR", () => {
  let b = buildProgram({ ...base, program: "se", tr: 30 });
  assert.equal(b.trMs, 41); assert.equal(b.raised, true);
  b = buildProgram({ ...base, program: "se", tr: 500 });
  assert.equal(b.trMs, 500); assert.equal(b.raised, false);
});

test("spin echo repeats with spoils between, not after", () => {
  const { events, trMs } = buildProgram({ ...base, program: "se", reps: 2 });
  const kinds = events.map((e) => (e.type === "rf" ? e.role : e.type));
  assert.deepEqual(kinds, ["excite", "delay", "refocus", "delay", "delay", "spoil",
    "excite", "delay", "refocus", "delay", "delay"]);
  assert.deepEqual(events.map((e) => e.rep), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  near(events.filter((e) => e.rep === 0).reduce((s, e) => s + (e.durMs ?? 0), 0), trMs);
});

test("one repetition has no spoil", () => {
  for (const program of ["pulse", "se", "ir"]) {
    assert.ok(!buildProgram({ ...base, program, reps: 1 }).events.some((e) => e.type === "spoil"));
  }
});

// Mz just before the k-th excitation (k >= 1): the frame at the end of the spoil before it.
const mzBeforeExcitation = (events, run, k) => {
  const spoils = events.map((e, i) => (e.type === "spoil" ? i : -1)).filter((i) => i >= 0);
  return meanTransverse(run.frames[run.eventEnds[spoils[k - 1]]]).mz;
};

test("spoiled repeat of a 90° recovers to 1 − e^(−TR/T1)", () => {
  const { events } = buildProgram({ ...base, program: "pulse", pdur: 0.1, tr: 500, reps: 2 });
  const run = runProgram(events, { T1: 1000, T2: 50 });
  near(mzBeforeExcitation(events, run, 1), 1 - Math.exp(-0.5), 0.005);
});

test("repetitions approach the spoiled steady state", () => {
  const { events } = buildProgram({ ...base, program: "pulse", flip: 60, pdur: 0.1, tr: 500, reps: 5 });
  const run = runProgram(events, { T1: 1000, T2: 50 });
  const E1 = Math.exp(-0.5), ss = (1 - E1) / (1 - Math.cos(Math.PI / 3) * E1);
  near(mzBeforeExcitation(events, run, 4), ss, 0.01);
});
