// DOM-free k-space tools: the fill masks of the original visualiser (Center / Edges, centric order for FSE),
// partial-Fourier acquisition with zero filling, k-space noise, reconstruction and display helpers.
// K-space arrays are row-major nx x ny (frequency x phase), fftshifted so ky = 0 is row ny/2 and kx = 0 is column nx/2.
import { fftAny, ifftAny, fft2, fftshift2 } from "../shared/fft.js";
import { roundHalfEven } from "./physics.js";
import { unitNoise } from "./noise.js";
import { INFERNO } from "./inferno.js";

// Number of lines for a percentage, as in the original: max(1, round(N * pct / 100)) with Python's rounding.
export const lineCount = (N, pct) => Math.max(1, roundHalfEven(N * (pct / 100)));

// First n row indices in FSE centric order: ky = 0, then +1, -1, +2, -2, ...
export function centricRows(N, n) {
  const centre = Math.floor(N / 2);
  const order = [centre];
  for (let d = 1; d < N && order.length < n; d++) {
    if (centre + d < N) order.push(centre + d);
    if (order.length >= n) break;
    if (centre - d >= 0) order.push(centre - d);
  }
  return order.slice(0, n);
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

function centreBand(N, n) {
  const ctr = Math.floor(N / 2), below = Math.floor(n / 2), above = n - below;
  return range(Math.max(0, ctr - below), Math.min(N, ctr + above));
}

function outerBands(N, n) {
  const first = Math.floor(n / 2), second = n - first;
  return [...range(0, first), ...range(N - second, N)];
}

export function kyRows(N, pct, region, centric) {
  const n = lineCount(N, pct);
  if (region === "Center") return centric ? centricRows(N, n) : centreBand(N, n);
  if (centric) {
    const inner = new Set(centricRows(N, N - n));
    return range(0, N).filter((r) => !inner.has(r));
  }
  return outerBands(N, n);
}

export function kxCols(N, pct, region) {
  const n = lineCount(N, pct);
  return region === "Center" ? centreBand(N, n) : outerBands(N, n);
}

// Center fills the rectangle rows x columns. Edges fills a continuous border (rows OR columns), except when one axis
// is at 100%, where the original uses the rectangle so the partial axis still constrains the fill.
export function fillMask(nx, ny, { region, kyPct, kxPct, centric }) {
  const rows = kyRows(ny, kyPct, region, centric), cols = kxCols(nx, kxPct, region);
  const mask = new Uint8Array(nx * ny);
  const useOr = region !== "Center" && rows.length !== ny && cols.length !== nx;
  if (useOr) {
    for (const j of rows) mask.fill(1, j * nx, (j + 1) * nx);
    for (let j = 0; j < ny; j++) for (const i of cols) mask[j * nx + i] = 1;
  } else {
    for (const j of rows) for (const i of cols) mask[j * nx + i] = 1;
  }
  return { mask, rows, cols, mode: useOr ? "or" : "and" };
}

// ---- partial Fourier: an off-centre block of ky lines is acquired and the rest are zero ----
// Rows [ny - nKeep, ny) of the shifted k-space are acquired, which always includes ky = 0.
export function partialFourierRows(ny, pf) {
  const nKeep = pf >= 1 ? ny : Math.min(ny, roundHalfEven(ny * pf));
  return { first: ny - nKeep, count: nKeep };
}

// Zero-filled partial-Fourier reconstruction along the phase direction (screen-up), magnitude output.
export function applyPartialFourier(values, nx, ny, pf) {
  if (!(pf < 1)) return values;
  const { first } = partialFourierRows(ny, pf);
  const half = Math.floor(ny / 2);
  const re = new Float64Array(ny), im = new Float64Array(ny);
  const out = new Float32Array(values.length);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) { re[j] = values[j * nx + i]; im[j] = 0; }
    fftAny(re, im);
    for (let r = 0; r < first; r++) { const k = (r - half + ny) % ny; re[k] = 0; im[k] = 0; } // shifted row r holds unshifted k
    ifftAny(re, im);
    for (let j = 0; j < ny; j++) out[j * nx + i] = Math.hypot(re[j], im[j]);
  }
  return out;
}

export function partialFourierMask(nx, ny, pf) {
  const { first } = partialFourierRows(ny, pf);
  const mask = new Uint8Array(nx * ny);
  mask.fill(1, first * nx);
  return mask;
}

// ---- transforms ----
export function kspaceOf(values, nx, ny) {
  const re = Float64Array.from(values), im = new Float64Array(values.length);
  fft2(re, im, nx, ny);
  return { re: fftshift2(re, nx, ny), im: fftshift2(im, nx, ny) };
}

// Magnitude image from the filled points, with complex Gaussian noise added at those points only. sigma is the
// image-domain noise of a full acquisition (the model's noise floor), so sigma_k = sigma * sqrt(nx * ny).
export function reconstruct(K, mask, nx, ny, sigma = 0, seed = 4242) {
  const n = nx * ny, sk = sigma * Math.sqrt(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  const noise = sk > 0 ? unitNoise(n, seed) : null;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    re[i] = K.re[i] + (noise ? sk * noise.a[i] : 0);
    im[i] = K.im[i] + (noise ? sk * noise.b[i] : 0);
  }
  const ur = fftshift2(re, nx, ny, true), ui = fftshift2(im, nx, ny, true);
  fft2(ur, ui, nx, ny, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.hypot(ur[i], ui[i]);
  return out;
}

export const combineMasks = (a, b) => a.map((v, i) => v & b[i]);
export const countFilled = (mask) => mask.reduce((s, v) => s + v, 0);

// log(1 + |K|) at the filled points (the original's display), 0 elsewhere.
export function logMagnitude(K, mask) {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < out.length; i++) if (mask[i]) out[i] = Math.log1p(Math.hypot(K.re[i], K.im[i]));
  return out;
}

// Inferno RGBA scaled to the image's own maximum (like matplotlib's imshow default).
export function toInferno(values) {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const c = max > 0 ? Math.min(255, Math.round((values[i] / max) * 255)) : 0;
    out[4 * i] = INFERNO[3 * c]; out[4 * i + 1] = INFERNO[3 * c + 1]; out[4 * i + 2] = INFERNO[3 * c + 2]; out[4 * i + 3] = 255;
  }
  return out;
}

// Auto window/level of a reconstruction: window = 2 x standard deviation, level = mean (the original's rule).
export function autoWindowLevelOf(values) {
  let s = 0, s2 = 0;
  for (const v of values) { s += v; s2 += v * v; }
  const mean = s / values.length, sd = Math.sqrt(Math.max(0, s2 / values.length - mean * mean));
  return { window: Math.max(1e-6, 2 * sd), level: mean };
}

// Auto window/level over the object only (pixels above 20% of the 99th percentile), so a field of view that is mostly
// air does not drag the level down and saturate the head. Falls back to the whole image if nothing qualifies.
export function autoWindowLevelObject(values) {
  const sorted = Float32Array.from(values).sort();
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))];
  const obj = values.filter((v) => v > 0.2 * p99);
  return autoWindowLevelOf(obj.length ? obj : values);
}
