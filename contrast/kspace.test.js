import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fft, fftAny, ifftAny, fft2, fftshift2 } from "../shared/fft.js";
import {
  kyRows, kxCols, fillMask, centricRows, partialFourierRows, applyPartialFourier, partialFourierMask, kspaceOf, reconstruct,
  combineMasks, countFilled, logMagnitude, toInferno, autoWindowLevelOf, autoWindowLevelObject,
} from "./kspace.js";

const golden = JSON.parse(readFileSync(new URL("./kspace_golden.json", import.meta.url), "utf8"));
const signal = (n, s = 1) => Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.3 * s) + (i % 5) - 0.3 * Math.cos(i * 0.21));

function dft(re, im) {
  const n = re.length, R = new Float64Array(n), I = new Float64Array(n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) {
    const a = (-2 * Math.PI * j * k) / n;
    R[k] += re[j] * Math.cos(a) - im[j] * Math.sin(a); I[k] += re[j] * Math.sin(a) + im[j] * Math.cos(a);
  }
  return [R, I];
}

test("any-length FFT matches a direct DFT, including lengths that are not powers of two", () => {
  for (const n of [1, 2, 3, 6, 7, 64, 96, 224, 320, 352]) {
    const re = signal(n), im = signal(n, 0.4);
    const [R, I] = dft(re, im);
    fftAny(re, im);
    const scale = Math.max(...R.map(Math.abs), 1);
    for (let k = 0; k < n; k++) { assert.ok(Math.abs(re[k] - R[k]) < 1e-11 * scale, `n=${n}`); assert.ok(Math.abs(im[k] - I[k]) < 1e-11 * scale); }
  }
});

test("power-of-two lengths still use the existing radix-2 FFT unchanged", () => {
  const a = signal(128), b = new Float64Array(128), c = Float64Array.from(a), d = new Float64Array(128);
  fft(a, b); fftAny(c, d);
  assert.deepEqual(Array.from(c), Array.from(a));
});

test("inverse FFT returns the input (1/n convention), and 2-D forward then inverse is the identity", () => {
  for (const n of [5, 64, 320]) {
    const re = signal(n), im = signal(n, 2), r0 = Float64Array.from(re), i0 = Float64Array.from(im);
    fftAny(re, im); ifftAny(re, im);
    for (let k = 0; k < n; k++) { assert.ok(Math.abs(re[k] - r0[k]) < 1e-10); assert.ok(Math.abs(im[k] - i0[k]) < 1e-10); }
  }
  const nx = 96, ny = 64, re = signal(nx * ny), im = new Float64Array(nx * ny), r0 = Float64Array.from(re);
  fft2(re, im, nx, ny); fft2(re, im, nx, ny, true);
  for (let k = 0; k < re.length; k++) assert.ok(Math.abs(re[k] - r0[k]) < 1e-9 && Math.abs(im[k]) < 1e-9);
});

test("Parseval: energy is conserved by the 2-D transform", () => {
  const nx = 64, ny = 96, re = signal(nx * ny), im = new Float64Array(nx * ny);
  const e0 = re.reduce((s, v) => s + v * v, 0);
  fft2(re, im, nx, ny);
  const e1 = re.reduce((s, v, i) => s + v * v + im[i] * im[i], 0) / (nx * ny);
  assert.ok(Math.abs(e1 - e0) < 1e-8 * e0);
});

test("fftshift puts the DC term at (nx/2, ny/2), and the inverse shift undoes it", () => {
  const nx = 6, ny = 4, a = Float64Array.from({ length: 24 }, (_, i) => i);
  const s = fftshift2(a, nx, ny);
  assert.equal(s[2 * nx + 3], 0);
  assert.deepEqual(Array.from(fftshift2(s, nx, ny, true)), Array.from(a));
});

test("ky rows match the original's fill rules (Center/Edges, linear and FSE centric) for every golden case", () => {
  for (const g of golden.rows) assert.deepEqual(kyRows(g.N, g.pct, g.region, g.centric), g.rows, JSON.stringify({ ...g, rows: undefined }));
});

test("kx columns match the original's fill rules for every golden case", () => {
  for (const g of golden.cols) assert.deepEqual(kxCols(g.N, g.pct, g.region), g.cols, JSON.stringify({ ...g, cols: undefined }));
});

test("centric order starts at ky = 0 and alternates outward", () => {
  assert.deepEqual(centricRows(8, 5), [4, 5, 3, 6, 2]);
});

test("Center fills a rectangle; Edges fills a border, or a rectangle when one axis is at 100%", () => {
  const c = fillMask(10, 8, { region: "Center", kyPct: 50, kxPct: 50 });
  assert.equal(countFilled(c.mask), 4 * 5);
  const e = fillMask(10, 8, { region: "Edges", kyPct: 50, kxPct: 40 });
  assert.equal(e.mode, "or");
  assert.equal(countFilled(e.mask), 4 * 10 + 4 * 8 - 4 * 4);
  const e100 = fillMask(10, 8, { region: "Edges", kyPct: 100, kxPct: 40 });
  assert.equal(e100.mode, "and");
  assert.equal(countFilled(e100.mask), 8 * 4);
});

test("a full, noise-free acquisition reconstructs the source image exactly", () => {
  const nx = 96, ny = 64, img = Float32Array.from(signal(nx * ny), (v) => Math.abs(v));
  const K = kspaceOf(img, nx, ny);
  const rec = reconstruct(K, new Uint8Array(nx * ny).fill(1), nx, ny, 0);
  for (let i = 0; i < img.length; i++) assert.ok(Math.abs(rec[i] - img[i]) < 1e-5);
});

test("filling only the k-space centre blurs: the reconstruction loses fine detail but keeps the mean", () => {
  const nx = 64, ny = 64, img = new Float32Array(nx * ny);
  for (let j = 16; j < 48; j++) for (let i = 16; i < 48; i++) img[j * nx + i] = 1; // a sharp-edged square
  const K = kspaceOf(img, nx, ny);
  const rec = reconstruct(K, fillMask(nx, ny, { region: "Center", kyPct: 25, kxPct: 25 }).mask, nx, ny, 0);
  const edge = (a) => Math.abs(a[32 * nx + 16] - a[32 * nx + 15]);
  assert.ok(edge(rec) < 0.8 * edge(img));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  // ky = kx = 0 is kept, so the complex mean is exact; the magnitude folds the negative ringing lobes up (~9% here)
  assert.ok(Math.abs(mean(rec) - mean(img)) < 0.15 * mean(img));
});

test("k-space noise is scaled so that a full acquisition has the image noise sigma", () => {
  const nx = 128, ny = 128, sigma = 0.7;
  const K = kspaceOf(new Float32Array(nx * ny), nx, ny);
  const rec = reconstruct(K, new Uint8Array(nx * ny).fill(1), nx, ny, sigma, 7);
  const mean = rec.reduce((s, v) => s + v, 0) / rec.length; // Rician of zero signal: sigma * sqrt(pi / 2)
  assert.ok(Math.abs(mean - sigma * Math.sqrt(Math.PI / 2)) < 0.02);
});

test("partial Fourier acquires an off-centre block that includes ky = 0", () => {
  assert.deepEqual(partialFourierRows(256, 1), { first: 0, count: 256 });
  assert.deepEqual(partialFourierRows(256, 5 / 8), { first: 96, count: 160 });
  const { first, count } = partialFourierRows(224, 6 / 8);
  assert.ok(first <= 112 && first + count === 224);
  assert.equal(countFilled(partialFourierMask(4, 8, 5 / 8)), 4 * 5);
});

test("partial Fourier: full acquisition is unchanged; zero filling blurs along the phase direction only", () => {
  const nx = 32, ny = 64, img = new Float32Array(nx * ny);
  for (let j = 20; j < 44; j++) for (let i = 8; i < 24; i++) img[j * nx + i] = 1;
  assert.equal(applyPartialFourier(img, nx, ny, 1), img);
  const pf = applyPartialFourier(img, nx, ny, 5 / 8);
  const vEdge = (a) => Math.abs(a[20 * nx + 16] - a[19 * nx + 16]); // phase-direction edge
  const hEdge = (a) => Math.abs(a[32 * nx + 8] - a[32 * nx + 7]); // frequency-direction edge
  assert.ok(vEdge(pf) < 0.9 * vEdge(img));
  assert.ok(Math.abs(hEdge(pf) - hEdge(img)) < 0.15); // no zero filling across columns
  const inside = pf[32 * nx + 16];
  assert.ok(Math.abs(inside - 1) < 0.15); // the centre line keeps the signal level
});

test("display helpers: log magnitude only at filled points; inferno scaled to the maximum; auto window = 2 sd, level = mean", () => {
  const K = { re: Float64Array.from([3, 0, 1, 2]), im: new Float64Array(4) };
  assert.deepEqual(Array.from(logMagnitude(K, Uint8Array.from([1, 1, 0, 1]))), [Math.log1p(3), 0, 0, Math.log1p(2)].map((v) => Math.fround(v)));
  const rgba = toInferno(Float32Array.from([0, 1]));
  assert.deepEqual([rgba[0], rgba[1], rgba[2]], [0, 0, 4]); // inferno starts near black
  assert.ok(rgba[4] > 200 && rgba[5] > 200); // and ends near pale yellow
  const wl = autoWindowLevelOf(Float32Array.from([1, 3]));
  assert.equal(wl.level, 2); assert.equal(wl.window, 2);
  assert.deepEqual(Array.from(combineMasks(Uint8Array.from([1, 1, 0]), Uint8Array.from([0, 1, 1]))), [0, 1, 0]);
});

test("object auto window ignores the surrounding air", () => {
  const v = new Float32Array(1000); // 90% air at ~0, 10% object at 1 and 2
  for (let i = 0; i < 50; i++) v[i] = 1;
  for (let i = 50; i < 100; i++) v[i] = 2;
  const wl = autoWindowLevelObject(v);
  assert.ok(Math.abs(wl.level - 1.5) < 1e-9 && Math.abs(wl.window - 1) < 1e-9);
  assert.ok(autoWindowLevelOf(v).level < 0.2); // the whole-image rule is dominated by air
});
