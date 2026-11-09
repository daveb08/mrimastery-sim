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

test("free precession after an excitation is sampled finely even at long TR", () => {
  const p = { ...base, program: "pulse", pdur: 0.5, tr: 5000, reps: 1, t2: 100, off: 0, spread: 0 };
  const { events, trMs } = buildProgram(p);
  const waits = events.filter((e) => e.type === "delay");
  assert.equal(waits[0].label, "free precession");
  near(waits[0].durMs, 500, 1e-6); // 5 x T2 of finely sampled decay first ...
  assert.ok(waits[0].durMs / waits[0].dtMs >= 300);
  assert.ok(waits[0].dtMs <= 500 / 300 + 1e-9);
  assert.equal(waits[1].label, "recovery"); // ... then the coarse recovery to TR
  near(events.reduce((s, e) => s + (e.durMs ?? 0), 0), trMs, 1e-6);
});

test("fast off-resonance gets finer steps, up to a frame cap", () => {
  const p = { ...base, program: "pulse", pdur: 0.5, tr: 5000, reps: 1, t2: 100, off: 300, spread: 200 };
  const fp = buildProgram(p).events.find((e) => e.label === "free precession");
  // 8 samples per turn at 500 Hz would be 0.25 ms; capped at 1500 frames over the 500 ms segment -> 1/3 ms
  near(fp.dtMs, 500 / 1500, 1e-9);
  const slow = buildProgram({ ...p, off: 20, spread: 0 }).events.find((e) => e.label === "free precession");
  near(slow.dtMs, 500 / 300, 1e-9); // 20 Hz needs no more than the usual 300 frames
});

test("spin echo: the decay after the echo is finely sampled too", () => {
  const { events } = buildProgram({ ...base, program: "se", tr: 3000, reps: 1, t2: 100, off: 0, spread: 0 });
  const after = events.slice(events.findIndex((e) => e.label === "to the echo") + 1);
  assert.deepEqual(after.map((e) => e.label), ["free precession", "recovery"]);
});
