// Fourier teaching panel numerics (DOM-free). Port of signal_processing.py.
// Time in s, frequency in Hz. Continuous-FT units (amplitude x s).

const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)); // numpy convention

export function signalValues(t, kind, width, frequency) {
  const out = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) {
    let env;
    if (kind === "Sinc") env = sinc(t[i] / width);
    else if (kind === "Rectangular") env = Math.abs(t[i]) <= width / 2 ? 1 : 0;
    else env = Math.exp(-0.5 * (t[i] / width) ** 2);
    out[i] = env * Math.cos(2 * Math.PI * frequency * t[i]);
  }
  return out;
}

export const DEFAULT_WIDTH = { Sinc: 0.12, Rectangular: 0.33, Gaussian: 0.12 };

// Folded (aliased) carrier frequency for sampling rate `rate`.
export function aliasFrequency(frequency, rate) {
  const m = (((frequency + rate / 2) % rate) + rate) % rate;
  return Math.abs(m - rate / 2);
}

// Phase is undefined at spectral zeros: those points become NaN.
export function phase(spec) {
  let peak = 0;
  for (let i = 0; i < spec.re.length; i++) peak = Math.max(peak, Math.hypot(spec.re[i], spec.im[i]));
  const floor = Math.max(peak * 1e-3, 1e-12);
  return Array.from(spec.re, (r, i) =>
    Math.hypot(r, spec.im[i]) < floor ? NaN : Math.atan2(spec.im[i], r));
}

export const magnitude = (spec) => Array.from(spec.re, (r, i) => Math.hypot(r, spec.im[i]));

// samples must be even (the UI uses multiples of 64).
export function transforms(kind, width, frequency, samplingRate, samples) {
  const dt = 1 / samplingRate;
  const t = Float64Array.from({ length: samples }, (_, i) => (i - Math.floor(samples / 2)) * dt);
  const values = signalValues(t, kind, width, frequency);
  const bins = Float64Array.from({ length: samples }, (_, j) => ((j - samples / 2) * samplingRate) / samples);

  // dt * sum v_n exp(-2 pi i f t_n): the DFT corrected for the centred time
  // origin, evaluated directly at each bin.
  const discrete = { re: new Float64Array(samples), im: new Float64Array(samples) };
  for (let k = 0; k < samples; k++) {
    let sr = 0, si = 0;
    const w = -2 * Math.PI * bins[k];
    for (let n = 0; n < samples; n++) {
      const a = w * t[n];
      sr += values[n] * Math.cos(a); si += values[n] * Math.sin(a);
    }
    discrete.re[k] = sr * dt; discrete.im[k] = si * dt;
  }

  // Numerical continuous FT over the same finite window (trapezoid rule).
  const start = t[0] - dt / 2, end = t[samples - 1] + dt / 2;
  const count = Math.max(8193, samples * 16 + 1);
  const h = (end - start) / (count - 1);
  const denseT = Float64Array.from({ length: count }, (_, j) => start + j * h);
  const denseValues = signalValues(denseT, kind, width, frequency);
  const extent = Math.max(samplingRate / 2, frequency * 1.25);
  const frequencies = Float64Array.from({ length: 801 }, (_, i) => -extent + (2 * extent * i) / 800);
  const continuous = { re: new Float64Array(801), im: new Float64Array(801) };
  for (let i = 0; i < 801; i++) {
    const f = frequencies[i];
    const stepR = Math.cos(-2 * Math.PI * f * h), stepI = Math.sin(-2 * Math.PI * f * h);
    let wr = 0, wi = 0, sr = 0, si = 0, prevR = 0, prevI = 0;
    for (let j = 0; j < count; j++) {
      if (j % 1024 === 0) { // reseed exactly to bound recurrence drift
        const a = -2 * Math.PI * f * denseT[j];
        wr = Math.cos(a); wi = Math.sin(a);
      } else {
        const nr = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR; wr = nr;
      }
      const gr = denseValues[j] * wr, gi = denseValues[j] * wi;
      if (j > 0) { sr += 0.5 * (prevR + gr); si += 0.5 * (prevI + gi); }
      prevR = gr; prevI = gi;
    }
    continuous.re[i] = sr * h; continuous.im[i] = si * h;
  }
  return { t, values, bins, discrete, denseT, denseValues, frequencies, continuous, dt };
}

// Separable 2D image and 80 dB spectrum, subsampled to at most `max` per axis
// for display. Subsampling takes exact samples of the 1D vectors.
export function twoDimensional(values, discrete, max = 512) {
  const n = values.length;
  const stride = Math.ceil(n / max);
  const idx = Array.from({ length: Math.ceil(n / stride) }, (_, i) => i * stride);
  const absD = magnitude(discrete);
  const peak1 = Math.max(...absD);
  const peak = peak1 * peak1;
  const image = idx.map((i) => idx.map((j) => values[i] * values[j]));
  const spectrumDb = idx.map((i) => idx.map((j) => {
    const m = peak > 0 ? (absD[i] * absD[j]) / peak : absD[i] * absD[j];
    return 20 * Math.log10(Math.max(m, 1e-4));
  }));
  return { image, spectrumDb, idx, stride };
}
