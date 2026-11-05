// Cross-talk engine (DOM-free). Bloch-simulated slice profiles of the sequence's RF pulses.
//
// Units: ms, mm, mT/m, Hz. Uses the bloch/bloch.js convention dM/dt = gamma M x B: +x RF tips Mz toward +y, positive
// off-resonance precesses clockwise seen from +z.

import { envelope, scaleToFlip, blochStep, HZ_PER_MT_M_MM } from "../bloch/bloch.js";

const STEPS = 400; // RF samples per pulse
const cache = new Map();

// Slice profile of one pulse played under slice-select gradient gss (mT/m), at positions u (mm, Float64Array) from
// the slice centre. Relaxation is off, so the pulse is a pure rotation R(u); it is found from the start vectors x, y, z.
//   zz     R_zz: Mz after per Mz before, with transverse magnetisation spoiled.
//   mxy    excite only: transverse M+ = Mx + i My per unit Mz after the pulse and the slice rephaser (zeros for refocus).
//   b2     refocus only: the coefficient of conj(M+) in M+ after the pulse (what survives the crushers):
//          M+' = (Rxx + iRyx) Mx + (Rxy + iRyy) My, and with Mx = (M+ + M+*)/2, My = (M+ − M+*)/(2i) the M+* term is
//          b2 = (Rxx − Ryy)/2 + i (Ryx + Rxy)/2. This identity holds whatever the rotation's handedness; with this
//          engine a hard 180 about +x gives b2 = +1 and about +y gives b2 = −1 (tested). Zeros for excite.
// Results are cached by their inputs and shared between callers: treat them as read-only.
export function pulseProfile({ role, flipDeg, durMs, gss, tbw = 4, shape = "sinc", phaseDeg = 0, u }) {
  const n = u.length;
  const du = n > 1 ? u[1] - u[0] : 0;
  const key = [role, flipDeg, durMs, gss, tbw, shape, phaseDeg, u[0], du, n, u[n - 1]].join("|");
  const hit = cache.get(key);
  if (hit) return hit;

  // Three isochromats per position, started at unit x, y and z.
  const M = new Float64Array(9 * n);
  const df = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    M[9 * i] = 1; M[9 * i + 4] = 1; M[9 * i + 8] = 1;
    df[3 * i] = df[3 * i + 1] = df[3 * i + 2] = HZ_PER_MT_M_MM * gss * u[i];
  }
  const wave = scaleToFlip(envelope(shape, STEPS, tbw), durMs, flipDeg);
  const ph = (phaseDeg * Math.PI) / 180, cp = Math.cos(ph), sp = Math.sin(ph);
  const h = durMs / STEPS;
  for (let k = 0; k < STEPS; k++) blochStep(M, wave[k] * cp, wave[k] * sp, df, h, Infinity, Infinity, 1);

  const zz = new Float64Array(n);
  const mxyRe = new Float64Array(n), mxyIm = new Float64Array(n);
  const b2Re = new Float64Array(n), b2Im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = 9 * i;
    // Column j of R is the image of start vector j.
    const Rxx = M[o], Ryx = M[o + 1];
    const Rxy = M[o + 3], Ryy = M[o + 4];
    const Rxz = M[o + 6], Ryz = M[o + 7], Rzz = M[o + 8];
    zz[i] = Rzz;
    if (role === "excite") {
      // The rephaser (−half the slice-select area) undoes the precession after the pulse's centre. Positive
      // off-resonance precesses clockwise (phase −2π f t), so the rephaser adds +φ: rotate counter-clockwise about z.
      const phi = 2 * Math.PI * HZ_PER_MT_M_MM * gss * (durMs / 2) * u[i] * 1e-3;
      const c = Math.cos(phi), s = Math.sin(phi);
      mxyRe[i] = Rxz * c - Ryz * s;
      mxyIm[i] = Rxz * s + Ryz * c;
    } else {
      b2Re[i] = (Rxx - Ryy) / 2;
      b2Im[i] = (Ryx + Rxy) / 2;
    }
  }
  const out = { u, zz, mxyRe, mxyIm, b2Re, b2Im };
  cache.set(key, out);
  return out;
}
