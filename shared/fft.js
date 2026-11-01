// In-place iterative radix-2 FFT (forward, e^{-i...}). Length must be a power of two.
export function fft(re, im) {
  const n = re.length;
  if (n & (n - 1)) throw new Error("FFT length must be a power of two.");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ---- any-length transforms (Bluestein's chirp-z algorithm for lengths that are not powers of two) ----
const isPow2 = (n) => (n & (n - 1)) === 0;
const nextPow2 = (n) => { let m = 1; while (m < n) m <<= 1; return m; };
const chirpCache = new Map();

function bluesteinChirp(n) {
  if (!chirpCache.has(n)) {
    const m = nextPow2(2 * n - 1);
    const wr = new Float64Array(n), wi = new Float64Array(n); // w_k = exp(-i pi k^2 / n)
    for (let k = 0; k < n; k++) {
      const ang = (Math.PI * ((k * k) % (2 * n))) / n; // k^2 mod 2n keeps the angle accurate for large k
      wr[k] = Math.cos(ang); wi[k] = -Math.sin(ang);
    }
    const br = new Float64Array(m), bi = new Float64Array(m); // conj(w), wrapped, then transformed once
    br[0] = wr[0]; bi[0] = -wi[0];
    for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
    fft(br, bi);
    chirpCache.set(n, { m, wr, wi, br, bi });
  }
  return chirpCache.get(n);
}

// Forward DFT of any length, in place: X_k = sum_j x_j e^{-2 pi i jk/n}.
export function fftAny(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if (isPow2(n)) { fft(re, im); return; }
  const { m, wr, wi, br, bi } = bluesteinChirp(n);
  const ar = new Float64Array(m), ai = new Float64Array(m);
  for (let k = 0; k < n; k++) { ar[k] = re[k] * wr[k] - im[k] * wi[k]; ai[k] = re[k] * wi[k] + im[k] * wr[k]; }
  fft(ar, ai);
  for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
  // inverse FFT of length m via conjugation
  for (let k = 0; k < m; k++) ai[k] = -ai[k];
  fft(ar, ai);
  for (let k = 0; k < n; k++) {
    const cr = ar[k] / m, ci = -ai[k] / m;
    re[k] = cr * wr[k] - ci * wi[k]; im[k] = cr * wi[k] + ci * wr[k];
  }
}

// Inverse DFT of any length, in place, with the 1/n factor (numpy's ifft convention).
export function ifftAny(re, im) {
  const n = re.length;
  for (let k = 0; k < n; k++) im[k] = -im[k];
  fftAny(re, im);
  for (let k = 0; k < n; k++) { re[k] /= n; im[k] = -im[k] / n; }
}

// 2-D transform in place of row-major nx x ny arrays (index j * nx + i): rows, then columns.
export function fft2(re, im, nx, ny, inverse = false) {
  const f = inverse ? ifftAny : fftAny;
  const rr = new Float64Array(nx), ri = new Float64Array(nx);
  for (let j = 0; j < ny; j++) {
    const o = j * nx;
    for (let i = 0; i < nx; i++) { rr[i] = re[o + i]; ri[i] = im[o + i]; }
    f(rr, ri);
    for (let i = 0; i < nx; i++) { re[o + i] = rr[i]; im[o + i] = ri[i]; }
  }
  const cr = new Float64Array(ny), ci = new Float64Array(ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) { cr[j] = re[j * nx + i]; ci[j] = im[j * nx + i]; }
    f(cr, ci);
    for (let j = 0; j < ny; j++) { re[j * nx + i] = cr[j]; im[j * nx + i] = ci[j]; }
  }
}

// numpy.fft.fftshift / ifftshift of a row-major nx x ny array (returns a new array).
export function fftshift2(a, nx, ny, inverse = false) {
  const out = new a.constructor(a.length);
  const sx = inverse ? nx - Math.floor(nx / 2) : Math.floor(nx / 2);
  const sy = inverse ? ny - Math.floor(ny / 2) : Math.floor(ny / 2);
  for (let j = 0; j < ny; j++) {
    const dj = (j + sy) % ny;
    for (let i = 0; i < nx; i++) out[dj * nx + ((i + sx) % nx)] = a[j * nx + i];
  }
  return out;
}
