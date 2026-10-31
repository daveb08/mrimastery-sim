// Small-tip RF excitation and slice-profile numerics (DOM-free).
// Port of rf_slice.simulate_rf_slice. Time in s, frequency in Hz, gradient in mT/m.
import { fft } from "../shared/fft.js";

const HZ_PER_UT = 42.577; // gamma / 2pi in Hz per microtesla; 1 mT/m * 1 mm = 1 uT
const COUNT = 2048;
const NFFT = 32768;

export function simulateRfSlice(kind, thicknessMm, gradientMtM, tbw) {
  const hzPerMm = HZ_PER_UT * gradientMtM;
  const bandwidth = hzPerMm * thicknessMm;
  const duration = tbw / bandwidth;
  const dt = duration / COUNT;
  const time = Float64Array.from({ length: COUNT }, (_, i) => (i - (COUNT - 1) / 2) * dt);
  let pulse;
  if (kind === "Sinc") {
    pulse = time.map((t) => { const x = bandwidth * t; return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); });
  } else if (kind === "Rectangular") {
    pulse = new Float64Array(COUNT).fill(1);
  } else {
    // Untruncated Gaussian magnitude-spectrum FWHM equals the target bandwidth.
    const sigma = Math.sqrt(2 * Math.log(2)) / (Math.PI * bandwidth);
    pulse = time.map((t) => Math.exp(-0.5 * (t / sigma) ** 2));
  }
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  re.set(pulse);
  fft(re, im);
  // fftshift: index j holds bin (j - NFFT/2).
  const frequencies = new Float64Array(NFFT), mag = new Float64Array(NFFT);
  let peak = 0;
  for (let j = 0; j < NFFT; j++) {
    const k = (j + NFFT / 2) % NFFT;
    frequencies[j] = (j - NFFT / 2) / (NFFT * dt);
    mag[j] = Math.hypot(re[k], im[k]) * dt;
    peak = Math.max(peak, mag[j]);
  }
  for (let j = 0; j < NFFT; j++) mag[j] /= peak;

  // Contiguous central lobe, measured at half its on-resonance amplitude.
  const c = NFFT / 2;
  let crossing = -1;
  for (let k = 0; c + k < NFFT; k++) if (mag[c + k] / mag[c] <= 0.5) { crossing = k; break; }
  let achievedMm = NaN;
  if (crossing > 0) {
    const fLow = frequencies[c + crossing - 1], fHigh = frequencies[c + crossing];
    const yLow = mag[c + crossing - 1] / mag[c], yHigh = mag[c + crossing] / mag[c];
    const halfWidth = fLow + ((0.5 - yLow) * (fHigh - fLow)) / (yHigh - yLow);
    achievedMm = (2 * halfWidth) / hzPerMm;
  }
  return { time, pulse, frequencies, magnitude: mag, bandwidth, duration, achievedMm, hzPerMm };
}
