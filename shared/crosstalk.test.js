import test from "node:test";
import assert from "node:assert/strict";
import { pulseProfile } from "./crosstalk.js";
import { GAMMA_BAR } from "./sequence.js";

const grid = (a, b, d) => {
  const n = Math.round((b - a) / d) + 1;
  return Float64Array.from({ length: n }, (_, i) => a + i * d);
};
const abs = (re, im) => re.map((v, i) => Math.hypot(v, im[i]));
const centre = (u) => {
  let best = 0;
  for (let i = 1; i < u.length; i++) if (Math.abs(u[i]) < Math.abs(u[best])) best = i;
  return best;
};
// Full width at half maximum, crossings linearly interpolated.
function fwhm(u, y) {
  const c = centre(u), half = y[c] / 2;
  let i = c, j = c;
  while (i > 0 && y[i - 1] >= half) i--;
  while (j < y.length - 1 && y[j + 1] >= half) j++;
  const lo = u[i - 1] + ((half - y[i - 1]) / (y[i] - y[i - 1])) * (u[i] - u[i - 1]);
  const hi = u[j] + ((y[j] - half) / (y[j] - y[j + 1])) * (u[j + 1] - u[j]);
  return hi - lo;
}
// Range of the transverse phase (radians) within |u| <= halfMm, relative to the centre phase.
function phaseSpread(p, u, halfMm) {
  const c = centre(u), p0 = Math.atan2(p.mxyIm[c], p.mxyRe[c]);
  let lo = 0, hi = 0;
  for (let i = 0; i < u.length; i++) {
    if (Math.abs(u[i]) > halfMm) continue;
    let d = Math.atan2(p.mxyIm[i], p.mxyRe[i]) - p0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return hi - lo;
}

const gss = 4 / 2 / (GAMMA_BAR * 5); // TBW 4, 2 ms, 5 mm — as sequence.js computes it

test("excite profile: FWHM matches the slice thickness and phase is flat after the rephaser", () => {
  const u = grid(-15, 15, 0.05), p = pulseProfile({ role: "excite", flipDeg: 90, durMs: 2, gss, u });
  assert.ok(Math.abs(fwhm(u, abs(p.mxyRe, p.mxyIm)) - 5) < 0.25);
  assert.ok(Math.abs(abs(p.mxyRe, p.mxyIm)[centre(u)] - 1) < 0.01);
  // A half-area rephaser leaves exactly flat phase only in the small-tip limit; at 90° the Bloch nonlinearity leaves
  // a residual that grows toward the slice edges (≈ 0.05 rad over ±0.5 mm, ≈ 0.76 rad over ±1.5 mm). That is physics,
  // so the 90° check is over the central ±0.5 mm and the ±1.5 mm check is at 30° (≈ 0.06 rad), below.
  assert.ok(phaseSpread(p, u, 0.5) < 0.1);
  assert.ok(phaseSpread(p, u, 1.5) < 1); // without the rephaser, or with it reversed, this is ≈ 6 rad
  assert.ok(Math.abs(p.zz[centre(u)]) < 0.01); // 90°: Mz → 0 at the centre
  assert.ok(p.b2Re.every((v) => v === 0) && p.b2Im.every((v) => v === 0));
});

test("small-tip excite: phase is flat across the central ±1.5 mm after the rephaser", () => {
  const u = grid(-15, 15, 0.05), p = pulseProfile({ role: "excite", flipDeg: 30, durMs: 2, gss, u });
  assert.ok(phaseSpread(p, u, 1.5) < 0.1); // radians
  assert.ok(Math.abs(abs(p.mxyRe, p.mxyIm)[centre(u)] - Math.sin(Math.PI / 6)) < 0.01);
});

test("refocus profile: zz ≈ −1 and |b2| ≈ 1 at the centre, zz → 1 and b2 → 0 far away", () => {
  const u = grid(-15, 15, 0.05);
  const p = pulseProfile({ role: "refocus", flipDeg: 180, durMs: 2, gss, phaseDeg: 90, u });
  const c = centre(u), b2 = abs(p.b2Re, p.b2Im);
  assert.ok(Math.abs(p.zz[c] + 1) < 0.01);
  assert.ok(Math.abs(b2[c] - 1) < 0.01);
  for (const i of [0, u.length - 1]) {
    assert.ok(Math.abs(p.zz[i] - 1) < 0.01);
    assert.ok(b2[i] < 0.01);
  }
  assert.ok(p.mxyRe.every((v) => v === 0) && p.mxyIm.every((v) => v === 0));
});

test("an ideal hard 180 about x gives b2 = 1, about y gives b2 = −1", () => {
  const u = Float64Array.from([-1, 0, 1]);
  for (const [phaseDeg, want] of [[0, 1], [90, -1]]) {
    const p = pulseProfile({ role: "refocus", flipDeg: 180, durMs: 1, gss: 0, shape: "rect", phaseDeg, u });
    for (let i = 0; i < u.length; i++) {
      assert.ok(Math.abs(p.b2Re[i] - want) < 1e-9, `phase ${phaseDeg}: b2Re ${p.b2Re[i]}`);
      assert.ok(Math.abs(p.b2Im[i]) < 1e-9);
      assert.ok(Math.abs(p.zz[i] + 1) < 1e-9);
    }
  }
});

test("profiles are cached by their inputs", () => {
  const u = grid(-5, 5, 0.5);
  const a = pulseProfile({ role: "excite", flipDeg: 30, durMs: 2, gss, u });
  assert.equal(pulseProfile({ role: "excite", flipDeg: 30, durMs: 2, gss, u: grid(-5, 5, 0.5) }), a);
  assert.notEqual(pulseProfile({ role: "excite", flipDeg: 40, durMs: 2, gss, u }), a);
});
