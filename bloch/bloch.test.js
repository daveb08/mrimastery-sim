import test from "node:test";
import assert from "node:assert/strict";
import { runProgram, meanTransverse, blochStep, equilibrium, flipFromB1, b1ForFlip, shapeFraction, envelope } from "./bloch.js";

const near = (a, b, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);
const last = (r) => r.frames[r.frames.length - 1];
const INF = { T1: Infinity, T2: Infinity };

test("90 and 180 degree hard pulses on resonance", () => {
  let r = runProgram([{ type: "rf", flipDeg: 90, durMs: 0.1 }], INF);
  let m = meanTransverse(last(r));
  near(m.mz, 0); near(m.mxy, 1); near(m.my, 1); // +x pulse tips toward +y
  r = runProgram([{ type: "rf", flipDeg: 180, durMs: 0.1 }], INF);
  near(meanTransverse(last(r)).mz, -1);
});

test("rf phase selects the rotation axis", () => {
  const r = runProgram([{ type: "rf", flipDeg: 90, phaseDeg: 90, durMs: 0.1 }], INF);
  near(meanTransverse(last(r)).mx, -1); // dM/dt = gamma M x B: +y pulse tips toward -x
});

test("free decay and recovery follow T2 and T1", () => {
  const T1 = 800, T2 = 80;
  let r = runProgram([{ type: "rf", flipDeg: 90, durMs: 0.1 }, { type: "delay", durMs: 100 }],
    { T1, T2, dtMs: 0.1 });
  const afterPulse = r.eventEnds[0];
  const m = meanTransverse(r.frames[afterPulse]);
  const d = meanTransverse(last(r));
  near(d.mxy / m.mxy, Math.exp(-100 / T2), 2e-3);
  near(d.mz, 1 - (1 - m.mz) * Math.exp(-100 / T1), 2e-3);
});

test("off-resonance precession angle is 360 * df * t", () => {
  const df = 50, t = 4; // 72 degrees
  const r = runProgram([{ type: "rf", flipDeg: 90, durMs: 0.05 }, { type: "delay", durMs: t }],
    { ...INF, offResHz: [df], dtMs: 0.05 });
  const f0 = r.frames[r.eventEnds[0]], f1 = last(r);
  const a0 = Math.atan2(f0[1], f0[0]), a1 = Math.atan2(f1[1], f1[0]);
  let d = ((a1 - a0) * 180) / Math.PI;
  d = ((d + 540) % 360) - 180;
  near(d, -72, 0.5); // positive offset precesses clockwise
});

test("magnitude is preserved without relaxation", () => {
  const r = runProgram(
    [{ type: "rf", flipDeg: 137, phaseDeg: 33, durMs: 1, shape: "sinc", tbw: 4 },
     { type: "delay", durMs: 5 }],
    { ...INF, offResHz: [-120, 0, 75, 300], dtMs: 0.02 });
  const f = last(r);
  for (let i = 0; i < 4; i++) near(Math.hypot(f[3 * i], f[3 * i + 1], f[3 * i + 2]), 1, 1e-9);
});

test("spin echo refocuses off-resonance spread, amplitude exp(-2tau/T2)", () => {
  const tau = 20, T2 = 100;
  const offRes = Array.from({ length: 41 }, (_, i) => -100 + 5 * i);
  const r = runProgram(
    [{ type: "rf", flipDeg: 90, durMs: 0.05 },
     { type: "delay", durMs: tau },
     { type: "rf", flipDeg: 180, phaseDeg: 90, durMs: 0.05 },
     { type: "delay", durMs: tau }],
    { T1: Infinity, T2, offResHz: offRes, dtMs: 0.05 });
  // Just before the 180 the spread has dephased; at the echo it has recovered.
  const before = meanTransverse(r.frames[r.eventEnds[1]]).mxy;
  const echo = meanTransverse(last(r)).mxy;
  assert.ok(before < 0.2, `dephased ${before}`);
  near(echo, Math.exp(-2 * tau / T2), 0.02);
});

test("spoiled steady state matches the gre_signal closed form", () => {
  // Reference: gre_signal(TR=10, TE=0, FA=30, T1=1000, T2s=50, PD=1) from app.py,
  // evaluated with the ast extraction used by test_simulator.py.
  const expected = 0.03489041347442676;
  const TR = 10, T1 = 1000, T2 = 50, FA = 30;
  let M0 = equilibrium(1);
  let signal = 0;
  for (let n = 0; n < 400; n++) {
    const r = runProgram([{ type: "rf", flipDeg: FA, durMs: 0.01 }],
      { T1, T2, M0, dtMs: 0.01 });
    signal = meanTransverse(last(r)).mxy;
    const f = Float64Array.from(last(r));
    f[0] = 0; f[1] = 0; // perfect spoiling
    blochStep(f, 0, 0, 0, TR - 0.01, T1, T2, 1); // remainder of TR
    M0 = f;
  }
  near(signal, expected, 5e-4); // small bias from relaxation during the 10 us pulse
});

test("flip angle = 360 deg x gamma-bar x B1 x tau: 11.74 uT for 0.5 ms is a 90-degree rectangle", () => {
  assert.ok(Math.abs(flipFromB1(11.74, 0.5) - 90) < 0.1);
  // fixed B1: the flip angle is proportional to the duration; fixed duration: proportional to B1
  assert.ok(Math.abs(flipFromB1(11.74, 1.0) - 180) < 0.2);
  assert.ok(Math.abs(flipFromB1(5.87, 0.5) - 45) < 0.1);
  for (const shape of ["rect", "sinc", "gaussian"]) {
    assert.ok(Math.abs(flipFromB1(b1ForFlip(70, 1.2, shape), 1.2, shape) - 70) < 1e-9, shape);
  }
  // a shaped pulse needs a higher peak B1 than a rectangle for the same flip
  assert.equal(shapeFraction("rect"), 1);
  assert.ok(shapeFraction("sinc") < 0.5 && shapeFraction("gaussian") < 1);
});

test("a pulse built from B1 and duration tips the spin by the predicted angle", () => {
  const flip = flipFromB1(8, 0.75); // about 92 degrees
  const run = runProgram([{ type: "rf", flipDeg: flip, durMs: 0.75, dtMs: 0.005 }], { T1: 1e9, T2: 1e9, offResHz: [0] });
  const M = run.frames[run.frames.length - 1];
  assert.ok(Math.abs(Math.acos(M[2]) * (180 / Math.PI) - flip) < 0.2);
});
test("hannSinc: the TBW-4 sinc under a Hann window is symmetric, peaks at 1 in the centre and falls to ~0 at the edges", () => {
  const n = 401, env = envelope("hannSinc", n, 4);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(env[i] - env[n - 1 - i]) < 1e-12, `symmetric at ${i}`);
  assert.ok(Math.abs(env[(n - 1) / 2] - 1) < 1e-12);
  for (const v of env) assert.ok(v <= 1 + 1e-12);
  assert.ok(Math.abs(env[0]) < 0.01 && Math.abs(env[n - 1]) < 0.01);
  // The window mostly removes the sinc's negative side lobes, so the net area per unit peak goes UP (measured 0.2532 vs
  // 0.2257 for the plain sinc): a windowed pulse needs a slightly lower peak B1 for the same flip. Its rectified area
  // (mean |envelope|) goes down (0.279 vs 0.364). (The task brief expected the net fraction to fall; it cannot.)
  assert.ok(shapeFraction("hannSinc") > shapeFraction("sinc") && shapeFraction("hannSinc") < 0.3);
  const absMean = (e) => e.reduce((s, v) => s + Math.abs(v), 0) / e.length;
  assert.ok(absMean(envelope("hannSinc", 2000, 4)) < absMean(envelope("sinc", 2000, 4)));
});

test("spoil zeroes the transverse magnetization and keeps Mz", () => {
  const r = runProgram([{ type: "rf", flipDeg: 45, durMs: 0.1 }, { type: "spoil" }], INF);
  const n = r.frames.length, before = r.frames[n - 2], after = r.frames[n - 1];
  assert.equal(r.eventEnds[1], r.eventEnds[0] + 1); // exactly one frame
  assert.equal(r.t[n - 1], r.t[n - 2]); // no time passes
  near(meanTransverse(before).mxy, Math.SQRT1_2);
  near(after[0], 0, 1e-12); near(after[1], 0, 1e-12); near(after[2], before[2], 1e-12);
});
