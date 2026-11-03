// DOM-free model of a tuned and matched RF loop coil (SI units: m, H, F, ohm, Hz, T).
// Circuit: the loop (L in series with its own loss R_coil and the patient's loss R_sample) has a tuning capacitor Ct
// in parallel with it; a matching capacitor Cm in series connects that tank to a 50-ohm line. The patient also adds a
// little stray capacitance across the loop, which pulls the resonance down.

export const MU0 = 4e-7 * Math.PI;
export const GAMMA = 2.675221874e8; // proton gyromagnetic ratio, rad/s/T
export const GAMMA_BAR = GAMMA / (2 * Math.PI); // 42.577 MHz/T
export const Z0 = 50;
export const WIRE_RADIUS = 1e-3; // m
export const TISSUE_SIGMA = 0.5; // S/m, a typical tissue conductivity
const STRAY_FRACTION = 0.015; // patient stray capacitance at full loading, as a fraction of the resonant C

export const larmorHz = (b0) => GAMMA_BAR * b0;

// Self-inductance of a circular loop of radius r made of round wire of radius a.
export const loopInductance = (r, a = WIRE_RADIUS) => MU0 * r * (Math.log((8 * r) / a) - 2);

// The coil at field strength b0: losses, the patient's share and its stray capacitance.
// loading: 0 (empty coil) to 1 (coil fully loaded with tissue). The patient loss model is a loop over conducting
// tissue, R = mu0^2 sigma omega^2 r^3 / (4 pi) at full loading: it grows with frequency squared and coil size cubed.
export function coil({ b0, radius, qUnloaded, loading }) {
  const f = larmorHz(b0), w = 2 * Math.PI * f;
  const L = loopInductance(radius);
  const rCoil = (w * L) / qUnloaded;
  const rSample = (loading * MU0 * MU0 * TISSUE_SIGMA * w * w * radius ** 3) / (4 * Math.PI);
  const cStray = loading * STRAY_FRACTION / (w * w * L);
  const qLoaded = (w * L) / (rCoil + rSample);
  return { f, L, rCoil, rSample, cStray, qUnloaded, qLoaded, qRatio: qUnloaded / qLoaded };
}

// Complex numbers as [re, im].
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const inv = ([re, im]) => { const d = re * re + im * im; return [re / d, -im / d]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };

// Input impedance seen from the 50-ohm line at frequency f.
export function inputImpedance(c, ct, cm, f) {
  const w = 2 * Math.PI * f;
  const zLoop = [c.rCoil + c.rSample, w * c.L];
  const yTank = add(inv(zLoop), [0, w * (ct + c.cStray)]);
  return add(inv(yTank), [0, -1 / (w * cm)]);
}

export const reflection = (z) => div(sub(z, [Z0, 0]), add(z, [Z0, 0]));
export const s11dB = (z) => { const g = reflection(z); return 10 * Math.log10(Math.max(1e-12, g[0] * g[0] + g[1] * g[1])); };

// Natural resonance of the loop with the tuning capacitor alone.
export const tankResonance = (c, ct) => 1 / (2 * Math.PI * Math.sqrt(c.L * (ct + c.cStray)));

// The Ct and Cm that make the input impedance exactly 50 ohm at the Larmor frequency, or null when this circuit
// cannot: a parallel tank only steps resistance up, so a loop whose own loss is above 50 ohm (a large loop at high
// field, heavily loaded) cannot be matched this way. Real coils that size are split into capacitor-joined segments.
export function tuneAndMatch(c) {
  const w = 2 * Math.PI * c.f;
  const yLoop = inv([c.rCoil + c.rSample, w * c.L]);
  const g = yLoop[0];
  // the tank's total susceptance must be inductive (negative) with Re(1 / Y) = Z0
  const bTotal = -Math.sqrt(Math.max(0, g / Z0 - g * g));
  const ct = (bTotal - yLoop[1]) / w - c.cStray;
  if (!(ct > 0) || g > 1 / Z0) return null;
  const zTank = inv([g, bTotal]);
  const cm = 1 / (w * zTank[1]);
  return { ct, cm };
}

// Where the power goes at the Larmor frequency for a forward power p (W), and the RF field it makes at the loop's
// centre: peak current from the power dissipated in the loop, B = mu0 I / (2 r), and B1+ = B / 2 because a linearly
// polarized field is two counter-rotating halves and only one rotates with the spins.
export function excitation(c, ct, cm, radius, p = 100) {
  const z = inputImpedance(c, ct, cm, c.f);
  const g = reflection(z), reflected = g[0] * g[0] + g[1] * g[1];
  const delivered = p * (1 - reflected);
  const rTotal = c.rCoil + c.rSample;
  const current = Math.sqrt((2 * delivered) / rTotal);
  const b1 = (MU0 * current) / (2 * radius), b1Plus = b1 / 2;
  return {
    z, reflected, delivered, current, b1Plus,
    toPatient: (delivered * c.rSample) / rTotal, toCoil: (delivered * c.rCoil) / rTotal,
    t90: b1Plus > 0 ? Math.PI / 2 / (GAMMA * b1Plus) : Infinity, // seconds, rectangular pulse
  };
}

// |S11| over a frequency range wide enough to show both the Larmor frequency and where the coil actually resonates.
export function sweep(c, ct, cm, n = 1500) {
  const fRes = tankResonance(c, ct);
  const lo = Math.min(c.f, fRes) * 0.96, hi = Math.max(c.f, fRes) * 1.04;
  const f = new Float64Array(n), db = new Float64Array(n), zr = new Float64Array(n), zi = new Float64Array(n);
  let best = 0;
  for (let i = 0; i < n; i++) {
    f[i] = lo + ((hi - lo) * i) / (n - 1);
    const z = inputImpedance(c, ct, cm, f[i]);
    db[i] = s11dB(z); zr[i] = z[0] / Z0; zi[i] = z[1] / Z0;
    if (db[i] < db[best]) best = i;
  }
  return { f, db, zr, zi, fDip: f[best], dipDb: db[best], fRes };
}
