/*
 * Physics for the home page's Bloch bench: free relaxation after one RF pulse from equilibrium (M0 = 1).
 * Closed form, no off-resonance: Mz(t) = 1 - (1 - cos a) e^(-t/T1), |Mxy|(t) = sin a e^(-t/T2).
 * Units: degrees, ms. DOM-free; the drawing lives in home/home.js.
 */

export const LIMITS = { flip: [5, 180], t1: [200, 4500], t2: [20, 2500] };

/** Longitudinal and transverse magnetization t ms after a pulse of `flip` degrees. */
export function magnetization(t, { flip, t1, t2 }) {
  const a = (flip * Math.PI) / 180;
  return { z: 1 - (1 - Math.cos(a)) * Math.exp(-t / t1), xy: Math.sin(a) * Math.exp(-t / t2) };
}

/** Time span to draw: long enough to show T1 recovery (3 T1) and T2 decay (5 T2), between 600 ms and 10 s. */
export function windowMs(t1, t2) {
  return Math.min(Math.max(3 * t1, 5 * t2, 600), 10000);
}

/** Round, clamp and check bench settings; missing or non-numeric values fall back to `prev`. T2 never exceeds T1. */
export function clampBench(p, prev = { flip: 90, t1: 780, t2: 90 }) {
  const pick = (k) => {
    const v = Math.round(Number(p[k]));
    if (p[k] == null || !Number.isFinite(v)) return prev[k];
    return Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
  };
  const out = { flip: pick("flip"), t1: pick("t1"), t2: pick("t2") };
  if (out.t2 > out.t1) out.t2 = out.t1;
  return out;
}

/** A round tick spacing (ms) giving at most five intervals across `w` ms. */
export function niceStep(w) {
  return [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].find((s) => w / s <= 5) ?? 5000;
}
