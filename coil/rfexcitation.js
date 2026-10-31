// Ideal on-resonance hard-pulse excitation from a real, linear RF field.
// Inputs: peak sinusoidal B vectors in tesla, pulse duration in milliseconds.
// No relaxation, off-resonance, loading, spatial phase, or full-wave solution.
// Port of rf_excitation.py.

export const PROTON_GAMMA_HZ_T = 42.577478461e6; // NIST 2022 gamma / (2 pi)

// |B_peak x B0_hat| / 2 for a real, linearly polarized, single-channel field.
// `field` is a flat array of vectors [x0,y0,z0,...]; the result has one value
// per vector. NaN wire-exclusion masks propagate.
export function b1plusLinear(field, b0Direction) {
  const dir = Array.from(b0Direction);
  if (dir.length !== 3 || !dir.every(Number.isFinite)) throw new Error("B0 direction must be a finite three-vector.");
  const length = Math.hypot(...dir);
  if (length === 0) throw new Error("B0 direction cannot be zero.");
  const [dx, dy, dz] = dir.map((v) => v / length);
  if (field.length % 3 !== 0 || Array.from(field).some((v) => v === Infinity || v === -Infinity)) {
    throw new Error("Field must have shape (..., 3), without infinities.");
  }
  const n = field.length / 3;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = field[3 * i], y = field[3 * i + 1], z = field[3 * i + 2];
    out[i] = Math.hypot(y * dz - z * dy, z * dx - x * dz, x * dy - y * dx) / 2;
  }
  return out;
}

// Proton carrier frequency (Hz); positive B0 magnitude in tesla.
export function larmorHz(b0T) {
  if (!Number.isFinite(b0T) || b0T <= 0) throw new Error("B0 must be finite and positive.");
  return PROTON_GAMMA_HZ_T * b0T;
}

// Unwrapped rotation angle and local post-pulse magnetization fractions.
// Initial M is along B0. mxy is local magnitude, not the coherent sum, the
// receive-coil signal, or a tissue-contrast image. RWA, on resonance only.
// `b1plusT` is a number or an array; the result fields match.
export function hardPulseResponse(b1plusT, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("Duration must be finite and nonnegative.");
  const one = (b1) => {
    if (b1 === Infinity || b1 < 0) throw new Error("B1+ magnitudes must be nonnegative (NaN masks allowed).");
    const angle = 2 * Math.PI * PROTON_GAMMA_HZ_T * b1 * durationMs * 1e-3;
    return [(angle * 180) / Math.PI, Math.cos(angle), Math.abs(Math.sin(angle))];
  };
  if (typeof b1plusT === "number") {
    const [flipDeg, mz, mxy] = one(b1plusT);
    return { flipDeg, mz, mxy };
  }
  const n = b1plusT.length;
  const flipDeg = new Float64Array(n), mz = new Float64Array(n), mxy = new Float64Array(n);
  for (let i = 0; i < n; i++) [flipDeg[i], mz[i], mxy[i]] = one(b1plusT[i]);
  return { flipDeg, mz, mxy };
}

// Center 90-degree duration in ms, or null if there is no transverse field.
export function durationFor90Ms(b1plusT) {
  if (!Number.isFinite(b1plusT) || b1plusT < 0) throw new Error("B1+ must be finite and nonnegative.");
  if (b1plusT === 0) return null;
  return 1e3 / (4 * PROTON_GAMMA_HZ_T * b1plusT);
}
