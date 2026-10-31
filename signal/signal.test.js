import test from "node:test";
import assert from "node:assert/strict";
import { transforms, aliasFrequency, magnitude, phase, twoDimensional, signalValues } from "./fourier.js";
import { simulateRfSlice } from "./rfslice.js";
import { fft } from "../shared/fft.js";

const near = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (tol ${tol})`);
const at = (r, f) => r.bins.findIndex((b) => Math.abs(b - f) < 1e-9);

// Reference values below were computed with signal_processing.py / rf_slice.py.

test("FFT matches a direct DFT", () => {
  const n = 64;
  const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 5));
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  for (const k of [0, 3, 17, 40]) {
    let sr = 0, si = 0;
    for (let j = 0; j < n; j++) { sr += x[j] * Math.cos((-2 * Math.PI * k * j) / n); si += x[j] * Math.sin((-2 * Math.PI * k * j) / n); }
    near(re[k], sr, 1e-9); near(im[k], si, 1e-9);
  }
});

test("sinc spectrum matches Python (width .12, fs 256, N 256)", () => {
  const r = transforms("Sinc", 0.12, 0, 256, 256);
  const m = magnitude(r.discrete);
  near(m[at(r, 0)], 0.11478955915052519, 1e-9);
  near(m[at(r, 10)], 0.000990864457666434, 1e-9);
  near(m[at(r, 40)], 5.734598515328515e-05, 1e-9);
  const k = 400; // continuous FT grid index
  near(Math.hypot(r.continuous.re[k], r.continuous.im[k]), 0.11479166669228268, 1e-6);
  near(Math.hypot(r.continuous.re[420], r.continuous.im[420]), 0.004583524755657177, 1e-6);
  near(Math.hypot(r.continuous.re[520], r.continuous.im[520]), 0.00032302472370655604, 1e-6);
});

test("sinc continuous FT is ~ width inside the band (rect spectrum)", () => {
  const r = transforms("Sinc", 0.12, 0, 256, 256);
  near(magnitude(r.discrete)[at(r, 0)], 0.12, 0.12 * 0.07);
});

test("modulated gaussian peaks at the carrier (Python reference)", () => {
  const r = transforms("Gaussian", 0.12, 10, 128, 512);
  const m = magnitude(r.discrete);
  near(m[at(r, 10)], 0.15039769647786005, 1e-9);
  near(m[at(r, 5)], 0.00012333734033247168, 1e-9);
  near(m[at(r, -10)], 0.15039769647786005, 1e-9); // Hermitian symmetry
  near(r.frequencies[0], -64, 1e-12);
});

test("gaussian transform follows the analytic form", () => {
  const sigma = 0.12, r = transforms("Gaussian", sigma, 0, 256, 512);
  for (const f of [0, 1, 2, 3]) {
    const expected = sigma * Math.sqrt(2 * Math.PI) * Math.exp(-2 * (Math.PI * sigma * f) ** 2);
    near(magnitude(r.discrete)[at(r, f)], expected, expected * 1e-3 + 1e-9, `f=${f}`);
  }
});

test("rectangular pulse: DC value is width and 85 samples are nonzero", () => {
  const r = transforms("Rectangular", 0.33, 0, 256, 256);
  assert.equal(r.values.reduce((a, b) => a + b, 0), 85);
  near(Math.hypot(r.continuous.re[400], r.continuous.im[400]), 0.3299560546875, 1e-6);
});

test("phase hides spectral zeros and is zero for a centred even signal", () => {
  const r = transforms("Gaussian", 0.12, 0, 256, 256);
  const p = phase(r.discrete);
  assert.ok(p.some(Number.isNaN));
  near(p[at(r, 0)], 0, 1e-12);
});

test("aliased carrier folds as expected", () => {
  assert.equal(aliasFrequency(100, 256), 100);
  assert.equal(aliasFrequency(100, 128), 28);
  assert.equal(aliasFrequency(0, 64), 0);
  near(aliasFrequency(10, 8), 2, 1e-12);
});

test("2D spectrum is normalised to 0 dB at the peak and floored at -80 dB", () => {
  const r = transforms("Gaussian", 0.12, 0, 256, 256);
  const d = twoDimensional(r.values, r.discrete);
  const flat = d.spectrumDb.flat();
  near(Math.max(...flat), 0, 1e-9);
  assert.ok(Math.min(...flat) >= -80 - 1e-9);
  const big = transforms("Gaussian", 0.12, 0, 1024, 2048);
  assert.ok(twoDimensional(big.values, big.discrete).image.length <= 512);
});

test("signalValues applies the carrier", () => {
  const v = signalValues(Float64Array.of(0, 0.05), "Rectangular", 1, 5);
  near(v[0], 1, 1e-12); near(v[1], Math.cos(2 * Math.PI * 5 * 0.05), 1e-12);
});

test("RF slice matches Python (5 mm, 10 mT/m, TBW 4)", () => {
  const ref = {
    Sinc: [5.059480496727917, [0.8042371552528241, 0.05680984997440483, 0.00012292155836511135]],
    Rectangular: [1.5079920603209405, [1.0, 0.038979963625780704, 0.02546635140759239]],
    Gaussian: [4.999999687463246, [1.0, 0.18410419748969808, 4.630083295266688e-08]],
  };
  for (const [kind, [achieved, mags]] of Object.entries(ref)) {
    const r = simulateRfSlice(kind, 5, 10, 4);
    near(r.bandwidth, 2128.85, 1e-9, kind);
    near(r.duration, 0.0018789487281865797, 1e-12, kind);
    near(r.achievedMm, achieved, 1e-6, kind);
    [0, 50, 200].forEach((k, i) => near(r.magnitude[16384 + k], mags[i], 1e-6, `${kind} mag ${k}`));
  }
  near(simulateRfSlice("Sinc", 3, 20, 8).achievedMm, 3.009359576590497, 1e-6);
});

test("RF slice physics: gaussian FWHM equals requested thickness", () => {
  near(simulateRfSlice("Gaussian", 8, 15, 6).achievedMm, 8, 0.01);
});
