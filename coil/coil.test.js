import test from "node:test";
import assert from "node:assert/strict";
import { MU0, axialField, coilField, fieldMap, rotationY } from "./coilfields.js";
import { b1plusLinear, hardPulseResponse, larmorHz, durationFor90Ms } from "./rfexcitation.js";

const rel = (a, b, rtol, atol = 0, msg = "") =>
  assert.ok(Math.abs(a - b) <= atol + rtol * Math.abs(b), `${msg} ${a} != ${b} (rtol ${rtol})`);
const allRel = (a, b, rtol, atol = 0) => a.forEach((v, i) => rel(v, b[i], rtol, atol, `[${i}]`));
const F = (...v) => Float64Array.from(v.flat());
const rotateRows = (flat, R) => { // rows @ R.T, i.e. R applied to each vector
  const out = new Float64Array(flat.length);
  for (let i = 0; i < flat.length / 3; i++) for (let k = 0; k < 3; k++) {
    out[3 * i + k] = R[k][0] * flat[3 * i] + R[k][1] * flat[3 * i + 1] + R[k][2] * flat[3 * i + 2];
  }
  return out;
};

// ---- ported from test_coil_fields.py ----

test("axis matches the closed form for single loop and pairs", () => {
  for (const sep of [null, 0.1, 0.2]) {
    const zs = Array.from({ length: 17 }, (_, i) => -0.3 + (0.6 * i) / 16);
    const field = coilField(F(...zs.map((z) => [0, 0, z])), 0.1, 2, 3, sep);
    zs.forEach((z, i) => {
      rel(field[3 * i + 2], axialField(z, 0.1, 2, 3, sep), 1e-10);
      assert.ok(Math.abs(field[3 * i]) < 1e-18 && Math.abs(field[3 * i + 1]) < 1e-18);
    });
  }
});

test("Helmholtz centre value and flatness", () => {
  const r = 0.1;
  const value = coilField(F(0, 0, 0), r, 1, 1, r)[2];
  rel(value, 0.8 ** 1.5 * MU0 / r, 1e-6);
  const z = 0.01 * r;
  const helmholtz = Math.abs(axialField(z, r, 1, 1, r) / value - 1);
  const loop = Math.abs(axialField(z, r, 1) / axialField(0, r, 1) - 1);
  assert.ok(helmholtz < loop / 100);
});

test("superposition and current/turn scaling", () => {
  const p = F([0.02, 0.03, 0.04], [-0.03, 0.01, -0.02]);
  const pair = coilField(p, 0.1, 1, 1, 0.1);
  const lo = coilField(F([0.02, 0.03, -0.01], [-0.03, 0.01, -0.07]), 0.1, 1);
  const hi = coilField(F([0.02, 0.03, 0.09], [-0.03, 0.01, 0.03]), 0.1, 1);
  allRel(pair, lo.map((v, i) => v + hi[i]), 1e-12);
  allRel(coilField(p, 0.1, -2, 3, 0.1), pair.map((v) => -6 * v), 1e-12);
});

test("rotation covariance", () => {
  const p = F([0.02, 0.03, 0.04], [-0.03, 0.01, -0.02]);
  const R = rotationY(55);
  const expected = rotateRows(coilField(p, 0.1, 1, 1, 0.1), R);
  // points @ rot.T  ==  R applied to each point
  const actual = coilField(rotateRows(p, R), 0.1, 1, 1, 0.1, 55);
  allRel(actual, expected, 1e-12, 1e-18);
});

test("zero current and the wire mask", () => {
  const field = coilField(F([0, 0, 0], [0.1, 0, 0]), 0.1, 0);
  assert.deepEqual(Array.from(field.slice(0, 3)), [0, 0, 0]);
  assert.ok(field.slice(3).every(Number.isNaN));
});

test("off-axis quadrature converges", () => {
  const p = F([0.07, 0.02, 0.03], [0.2, 0.01, -0.1]);
  allRel(coilField(p, 0.1, 1, 1, null, 0, 256), coilField(p, 0.1, 1, 1, null, 0, 1024), 1e-8, 1e-15);
});

test("geometric scale and far field", () => {
  const a = coilField(F(0.04, 0.06, 0.08), 0.2, 1), b = coilField(F(0.02, 0.03, 0.04), 0.1, 1);
  allRel(a, b.map((v) => v / 2), 1e-12);
  rel(axialField(10, 0.1, 1) / axialField(20, 0.1, 1), 8, 1e-3);
});

test("invalid input is rejected", () => {
  assert.throws(() => coilField(F(0, 0, NaN), 0.1, 1));
  assert.throws(() => coilField(F(0, 0, 0), -0.1, 1));
  assert.throws(() => coilField(F(0, 0, 0), 0.1, 1, 1, -0.2));
});

// ---- ported from test_rf_excitation.py ----

test("linear polarization: half the peak, parallel rejected", () => {
  allRel(b1plusLinear(F([2e-6, 0, 0], [0, 2e-6, 0], [0, 0, 2e-6]), [0, 0, 1]), [1e-6, 1e-6, 0], 1e-7, 1e-18);
  rel(b1plusLinear(F(3e-6, 4e-6, 100e-6), [0, 0, 5])[0], 2.5e-6, 1e-12);
});

test("orientation covariance and current phase", () => {
  const field = F(1e-6, 2e-6, 3e-6), b0 = [0, 0, 1], R = rotationY(35);
  const expected = b1plusLinear(field, b0)[0];
  const rotatedB0 = rotateRows(F(b0), R);
  rel(b1plusLinear(rotateRows(field, R), rotatedB0)[0], expected, 1e-12);
  rel(b1plusLinear(field.map((v) => -v), b0)[0], expected, 1e-12);
});

test("loop centre to excitation (48.154 degrees at 1 A, 1 ms, B0 along x)", () => {
  const radius = 0.1;
  const b1 = b1plusLinear(coilField(F(0, 0, 0), radius, 1), [1, 0, 0])[0];
  rel(b1, MU0 / (4 * radius), 1e-6);
  rel(hardPulseResponse(b1, 1).flipDeg, 48.15399367, 1e-6);
});

test("known rotations and unwrapped angles", () => {
  for (const [angle, mz, mxy] of [[0, 1, 0], [90, 0, 1], [180, -1, 0], [270, 0, 1], [360, 1, 0], [450, 0, 1]]) {
    const r = hardPulseResponse(1e-6, (durationFor90Ms(1e-6) * angle) / 90);
    rel(r.flipDeg, angle, 1e-9, 1e-9);
    assert.ok(Math.abs(r.mz - mz) < 1e-9 && Math.abs(r.mxy - mxy) < 1e-9, `angle ${angle}`);
  }
});

test("units and current/duration scaling", () => {
  const a = hardPulseResponse(1e-6, 1).flipDeg;
  rel(a, 15.32789224596, 1e-9);
  rel(hardPulseResponse(2e-6, 1).flipDeg, 2 * a, 1e-12);
  rel(hardPulseResponse(1e-6, 2).flipDeg, 2 * a, 1e-12);
  rel(durationFor90Ms(2e-6), durationFor90Ms(1e-6) / 2, 1e-12);
});

test("zero current and NaN masks propagate", () => {
  const b1 = b1plusLinear(F([0, 0, 0], [NaN, NaN, NaN]), [0, 0, 1]);
  const r = hardPulseResponse(b1, 1);
  assert.equal(r.flipDeg[0], 0); assert.equal(r.mz[0], 1); assert.equal(r.mxy[0], 0);
  assert.ok(Number.isNaN(r.flipDeg[1]) && Number.isNaN(r.mz[1]) && Number.isNaN(r.mxy[1]));
  assert.equal(durationFor90Ms(0), null);
});

test("low-field frequency", () => {
  rel(larmorHz(0.064) / 1e6, 2.724958621504, 1e-9);
  rel(larmorHz(3) / larmorHz(0.064), 3 / 0.064, 1e-12);
});

test("invalid orientation and duration are rejected", () => {
  for (const d of [[0, 0, 0], [1, 0], [NaN, 0, 1]]) assert.throws(() => b1plusLinear(F(0, 0, 1e-6), d));
  for (const d of [-1, Infinity, NaN]) assert.throws(() => hardPulseResponse(1e-6, d));
  assert.throws(() => b1plusLinear(F(Infinity, 0, 0), [0, 0, 1]));
});

// ---- reference values computed with the Python implementation ----

test("off-axis fields match Python", () => {
  allRel(coilField(F([0.07, 0.02, 0.03], [0.2, 0.01, -0.1]), 0.1, 1),
    [3.447878887354108e-06, 9.851082535297457e-07, 6.092200730373183e-06,
     -4.0225522408153025e-07, -2.011276120407666e-08, -6.351096612621113e-08], 1e-9, 1e-18);
  allRel(coilField(F([0.02, 0.03, 0.04], [-0.03, 0.01, -0.02]), 0.1, 2, 3, 0.1, 55),
    [4.4998580229719474e-05, 1.1725366026876105e-06, 3.2524381243815016e-05,
     4.3608670852908164e-05, -4.5232379297880767e-07, 3.0489606059803853e-05], 1e-9, 1e-18);
});

test("field map matches Python (single loop and tilted pair)", () => {
  const m = fieldMap(0.1, null, 0);
  assert.equal(m.field.length, 101 * 101 * 3);
  const at = (map, i, j) => Array.from(map.field.slice(3 * (i * 101 + j), 3 * (i * 101 + j) + 3));
  allRel(at(m, 50, 70), [-4.0262873701693205e-20, 3.599177880070867e-36, 2.119569108255127e-05], 1e-9, 1e-18);
  allRel(at(m, 30, 45), [4.3432919991482973e-07, -2.4528989950312056e-22, 2.592495659565705e-06], 1e-9, 1e-18);
  allRel(at(m, 80, 20), [-6.121030838996237e-07, -3.851628217754755e-24, 3.762013849345724e-07], 1e-9, 1e-18);
  const nan = (map) => { let c = 0; for (let k = 0; k < map.field.length; k += 3) if (Number.isNaN(map.field[k])) c++; return c; };
  assert.equal(nan(m), 2);
  const pair = fieldMap(0.15, 0.15, 35);
  allRel(at(pair, 60, 40), [3.5431341632040002e-06, 4.4574261816310305e-23, 4.4227640640490435e-06], 1e-9, 1e-18);
  assert.equal(nan(pair), 6);
});

test("B1+ of the default map with B0 along x matches Python", () => {
  const m = fieldMap(0.1, null, 0);
  const b1 = b1plusLinear(m.field, [1, 0, 0]);
  rel(b1[50 * 101 + 70], 1.0597845541275634e-05, 1e-9);
  rel(b1[30 * 101 + 45], 1.2962478297828526e-06, 1e-9);
  rel(b1[80 * 101 + 20], 1.881006924672862e-07, 1e-9);
});
