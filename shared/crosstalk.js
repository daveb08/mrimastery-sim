// Cross-talk engine (DOM-free). Bloch-simulated slice profiles of the sequence's RF pulses.
//
// Units: ms, mm, mT/m, Hz. Uses the bloch/bloch.js convention dM/dt = gamma M x B: +x RF tips Mz toward +y, positive
// off-resonance precesses clockwise seen from +z.

import { envelope, scaleToFlip, HZ_PER_MT_M_MM } from "../bloch/bloch.js";

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

  // One rotation per position per step, composed as a unit quaternion (w, x, y, z). Each step is the same rotation
  // bloch.js blochStep applies (right-handed by −2π|B|dt about B = (b1x, b1y, Δf), relaxation off), so the result
  // equals stepping three isochromats from unit x, y, z, at a third of the trig cost.
  const wave = scaleToFlip(envelope(shape, STEPS, tbw), durMs, flipDeg);
  const ph = (phaseDeg * Math.PI) / 180, cp = Math.cos(ph), sp = Math.sin(ph);
  const h = durMs / STEPS, k2 = -Math.PI * h * 1e-3; // half-angle per Hz of field
  const zz = new Float64Array(n);
  const mxyRe = new Float64Array(n), mxyIm = new Float64Array(n);
  const b2Re = new Float64Array(n), b2Im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const df = HZ_PER_MT_M_MM * gss * u[i];
    let qw = 1, qx = 0, qy = 0, qz = 0;
    for (let k = 0; k < STEPS; k++) {
      const bx = wave[k] * cp, by = wave[k] * sp;
      const b = Math.sqrt(bx * bx + by * by + df * df);
      if (b === 0) continue;
      const half = k2 * b, s = Math.sin(half) / b;
      const aw = Math.cos(half), ax = bx * s, ay = by * s, az = df * s;
      // q ← step ⊗ q (Hamilton product; the later rotation on the left)
      const w = aw * qw - ax * qx - ay * qy - az * qz;
      const x = aw * qx + ax * qw + ay * qz - az * qy;
      const y = aw * qy - ax * qz + ay * qw + az * qx;
      const z = aw * qz + ax * qy - ay * qx + az * qw;
      qw = w; qx = x; qy = y; qz = z;
    }
    // Rotation matrix; column j is the image of unit vector j.
    const Rxx = 1 - 2 * (qy * qy + qz * qz), Rxy = 2 * (qx * qy - qw * qz);
    const Ryx = 2 * (qx * qy + qw * qz), Ryy = 1 - 2 * (qx * qx + qz * qz);
    const Rxz = 2 * (qx * qz + qw * qy), Ryz = 2 * (qy * qz - qw * qx), Rzz = 1 - 2 * (qx * qx + qy * qy);
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
