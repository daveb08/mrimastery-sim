import test from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "./bloch.js";
import { LAB_DEG_PER_FRAME, labAngle, toLab, rfAt } from "./labframe.js";

const near = (a, b, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test("labAngle is zero at frame 0 and clockwise", () => {
  assert.equal(LAB_DEG_PER_FRAME, 8);
  near(labAngle(0), 0);
  near(labAngle(45), -(45 * 8 * Math.PI) / 180);
});

test("toLab preserves length and z, and rotates +x clockwise", () => {
  const v = toLab([1, 0, 0.3], labAngle(1));
  near(Math.hypot(v[0], v[1]), 1);
  near(v[2], 0.3);
  assert.ok(v[1] < 0);
});

test("lab sense matches the engine's positive off-resonance sense", () => {
  // +y after a 90x pulse; a short delay at +100 Hz moves it the same way as a lab step does.
  const r = runProgram([{ type: "rf", flipDeg: 90, durMs: 0.1 }, { type: "delay", durMs: 0.5 }],
                       { T1: Infinity, T2: Infinity, offResHz: [100] });
  const m = r.frames[r.frames.length - 1];
  const lab = toLab([0, 1, 0], labAngle(1));
  assert.ok(Math.abs(m[0]) > 0.1);
  assert.equal(Math.sign(m[0]), Math.sign(lab[0]));
});

test("rfAt: null at frame 0 and in delays; phase and amplitude in pulses", () => {
  const events = [{ type: "rf", flipDeg: 90, phaseDeg: 90, durMs: 1, dtMs: 0.1, shape: "rect" },
                  { type: "delay", durMs: 1, dtMs: 0.1 }];
  const ends = [10, 20];
  assert.equal(rfAt(events, ends, 0), null);
  assert.equal(rfAt(events, ends, 15), null);
  const b = rfAt(events, ends, 5);
  near(b.bx, 0);
  near(b.by, 1);
});

test("rfAt: sinc peaks at 1 mid-pulse and is smaller near the ends", () => {
  const events = [{ type: "rf", flipDeg: 90, durMs: 1, dtMs: 0.0125, shape: "sinc", tbw: 4 }];
  const ends = [80];
  near(Math.max(...Array.from({ length: 80 }, (_, i) => rfAt(events, ends, i + 1).bx)), 1);
  assert.ok(Math.abs(rfAt(events, ends, 1).bx) < 0.2);
});

test("rfAt: arrow length compares pulses: a 180 of the same duration is twice a 90", () => {
  const events = [{ type: "rf", flipDeg: 90, durMs: 1, dtMs: 0.1, shape: "rect" },
                  { type: "delay", durMs: 1, dtMs: 0.1 },
                  { type: "rf", flipDeg: 180, phaseDeg: 90, durMs: 1, dtMs: 0.1, shape: "rect" }];
  const ends = [10, 20, 30];
  near(rfAt(events, ends, 5).bx, 0.5);
  near(rfAt(events, ends, 25).by, 1);
});

test("rfAt: a negative flip reverses the field", () => {
  const events = [{ type: "rf", flipDeg: -90, durMs: 1, dtMs: 0.1, shape: "rect" }];
  near(rfAt(events, [10], 5).bx, -1);
});
