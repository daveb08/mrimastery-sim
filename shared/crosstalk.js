// Cross-talk engine (DOM-free). Bloch-simulated slice profiles of the sequence's RF pulses.
//
// Units: ms, mm, mT/m, Hz. Uses the bloch/bloch.js convention dM/dt = gamma M x B: +x RF tips Mz toward +y, positive
// off-resonance precesses clockwise seen from +z.

import { envelope, scaleToFlip, HZ_PER_MT_M_MM } from "../bloch/bloch.js";
import { tissuesAt } from "../contrast/physics.js";
import { EXTRA_TISSUES } from "../contrast/image.js";
import { LABELS } from "../phantom/phantom.js";

const STEPS = 400; // RF samples per pulse
const cache = new Map();
const CACHE_MAX = 32; // bound the cache (keys vary with pulse and thickness): clear rather than grow
const PROFILE_HALF_WIDTH = 6; // crossTalk profiles span ±6 slice thicknesses; beyond that a pulse is taken to do nothing

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
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, out);
  return out;
}

// ---- steady-state cross-talk ----

// T1 (ms) of every tissue label in the phantom at a field strength: the field table plus the illustrative extras.
export function TISSUE_T1(field = "3.0T") {
  const t = tissuesAt(field);
  return { WM: t.WM.T1, GM: t.GM.T1, CSF: t.CSF.T1, Fat: t.Fat.T1, muscle: EXTRA_TISSUES.muscle.T1, lesion: EXTRA_TISSUES.lesion.T1 };
}

// Per-label factors (indexed by LABELS) from a { tissue: factor } map; AIR, BONE and any missing tissue read 1.
const LABEL_TISSUE = [[LABELS.WM, "WM"], [LABELS.GM, "GM"], [LABELS.CSF, "CSF"], [LABELS.FAT, "Fat"],
  [LABELS.MUSCLE, "muscle"], [LABELS.LESION, "lesion"]];
export function labelFactors(factor) {
  const out = new Float32Array(8).fill(1);
  for (const [label, name] of LABEL_TISSUE) if (Number.isFinite(factor[name])) out[label] = factor[name];
  return out;
}

// Steady-state cross-talk of a multi-slice sequence (shared/sequence.js, slices > 1) for tissues { name: T1 ms }.
// Model (docs/superpowers/specs/2026-11-04-multislice-design.md, "Cross-talk engine"):
//   - Each pulse acts at its centre and only on Mz: Mz ← zz(z)·Mz. Transverse magnetisation is spoiled between
//     pulses, except within a slice's own echo, which the signal weights below account for.
//   - Between pulse centres Mz recovers exactly: Mz ← 1 − (1 − Mz)·exp(−Δt/T1). Over one TR the map is affine,
//     Mz → a·Mz + b, so the steady state at t = 0 is b / (1 − a); it is then propagated to just before each excitation.
//   - Slice j's signal is the coherent sum |Σ_z Mz_before_j(z)·w_j(z)·dz| with w = m (complex Mxy per unit Mz after
//     the excitation and rephaser) for GRE/EPI, or w = b2·conj(m) with b2 of j's first refocusing pulse for SE/FSE
//     (for FSE the first 180 stands for the train; stimulated echoes are not modelled).
//   - factor = signal with all slices / signal with only slice j's pulses (same pulses, same TR).
// Returns { z, slices: [{ index, zMm, acq, freqHz, factor, mzBefore }], profiles: { excite, refocus } } with
// profiles.excite[j] = |Mxy| and profiles.refocus[j] = zz of j's first refocusing pulse, on z (refocus empty for GRE/EPI).
export function crossTalk(seq, tissues) {
  const info = seq.info, th = info?.sliceMm;
  if (!info?.slices) throw new Error("crossTalk: needs a multi-slice sequence (slices > 1)");
  const rf = seq.events.filter((e) => e.kind === "rf").sort((a, b) => a.center - b.center);
  if (rf.some((e) => !Number.isFinite(e.gss) || !Number.isInteger(e.slice))) throw new Error("crossTalk: RF events need slice and gss");
  const N = info.slices.length, TR = seq.tr;
  const zs = info.slices.map((s) => s.zMm), lo = Math.min(...zs), hi = Math.max(...zs);

  // z grid for the output, and a local grid u (same spacing) that depends only on the pulse: ±PROFILE_HALF_WIDTH
  // thicknesses, so the profile cache survives changes of N, gap and order.
  const dz = th / 20, z0 = lo - 3 * th;
  const nz = Math.round((hi - lo + 6 * th) / dz) + 1;
  const z = Float64Array.from({ length: nz }, (_, i) => z0 + i * dz);
  const halfU = PROFILE_HALF_WIDTH * 20, nu = 2 * halfU + 1;
  const u = Float64Array.from({ length: nu }, (_, i) => (i - halfU) * dz);

  // Profiles per distinct pulse, shifted onto z per slice (u = z − zMm; one interpolation weight per slice). Outside
  // the profile's grid the pulse does nothing: zz = 1, mxy = b2 = 0 (`outside`).
  const profile = (e) => pulseProfile({ role: e.role, flipDeg: e.flip, durMs: e.duration, gss: e.gss, shape: e.shape ?? "sinc", phaseDeg: e.phase ?? 0, u });
  const shift = (arr, zMm, outside = 0) => {
    const t = (z0 - zMm) / dz + halfU, i0 = Math.floor(t), f = t - i0, out = new Float64Array(nz).fill(outside);
    const from = Math.max(0, -i0), to = Math.min(nz, nu - 1 - i0); // i with 0 <= i0 + i and i0 + i + 1 < nu
    for (let i = from; i < to; i++) out[i] = arr[i0 + i] * (1 - f) + arr[i0 + i + 1] * f;
    return out;
  };
  // A pass plays only some slices of the stack: RF events carry the full-stack index, info.slices lists the pass.
  const posOf = new Map(info.slices.map((s, j) => [s.index, j]));
  if (rf.some((e) => !posOf.has(e.slice))) throw new Error("crossTalk: an RF event belongs to a slice outside info.slices");
  const zzCache = new Map(); // zz on z per (slice, pulse)
  const zzOf = (e) => {
    const key = [e.slice, e.role, e.flip, e.duration, e.gss, e.phase, e.shape].join("|");
    let v = zzCache.get(key);
    if (!v) { v = shift(profile(e).zz, zs[posOf.get(e.slice)], 1); zzCache.set(key, v); }
    return v;
  };
  const pulses = rf.map((e) => ({ t: e.center, slice: posOf.get(e.slice), excite: e.role === "excite", zz: zzOf(e) }));

  // Per slice: the complex signal weight w on z, and the plot profiles.
  const excite = [], refocus = [], wRe = [], wIm = [], freqHz = [];
  for (let j = 0; j < N; j++) {
    const ex = rf.find((e) => e.slice === info.slices[j].index && e.role === "excite");
    if (!ex) throw new Error(`crossTalk: no excitation for slice ${j}`);
    const p = profile(ex), mRe = shift(p.mxyRe, zs[j]), mIm = shift(p.mxyIm, zs[j]);
    freqHz.push(ex.freqHz);
    excite.push(mRe.map((v, i) => Math.hypot(v, mIm[i])));
    const ref = rf.find((e) => e.slice === info.slices[j].index && e.role === "refocus");
    if (ref) {
      const q = profile(ref), bRe = shift(q.b2Re, zs[j]), bIm = shift(q.b2Im, zs[j]);
      refocus.push(zzOf(ref));
      wRe.push(bRe.map((v, i) => v * mRe[i] + bIm[i] * mIm[i])); // b2 · conj(m)
      wIm.push(bIm.map((v, i) => v * mRe[i] - bRe[i] * mIm[i]));
    } else { wRe.push(mRe); wIm.push(mIm); }
  }
  const signal = (mz, j) => {
    const wr = wRe[j], wi = wIm[j];
    let re = 0, im = 0;
    for (let i = 0; i < nz; i++) { re += mz[i] * wr[i]; im += mz[i] * wi[i]; }
    return Math.hypot(re, im) * dz;
  };

  const slices = info.slices.map((s, j) => ({ index: s.index, zMm: s.zMm, acq: s.acq, freqHz: freqHz[j], factor: {}, mzBefore: {} }));
  const own = Array.from({ length: N }, (_, j) => pulses.filter((p) => p.slice === j));
  const a = new Float64Array(nz), b = new Float64Array(nz), m = new Float64Array(nz);
  // Compose recovery-by-e then pulse zz onto the map (a, b).
  const step = (e, zz) => {
    const r = 1 - e;
    if (zz) for (let i = 0; i < nz; i++) { a[i] *= e * zz[i]; b[i] = (b[i] * e + r) * zz[i]; }
    else for (let i = 0; i < nz; i++) { a[i] *= e; b[i] = b[i] * e + r; }
  };
  const K = pulses.length;
  for (const [name, T1] of Object.entries(tissues)) {
    const E = Float64Array.from({ length: K }, (_, k) => Math.exp(-(pulses[k].t - (k ? pulses[k - 1].t : 0)) / T1));

    // All slices: the TR's map from t = 0, its fixed point, then forward to just before each excitation.
    a.fill(1); b.fill(0);
    for (let k = 0; k < K; k++) step(E[k], pulses[k].zz);
    step(Math.exp(-(TR - pulses[K - 1].t) / T1), null);
    for (let i = 0; i < nz; i++) m[i] = b[i] / (1 - a[i]);
    for (let k = 0; k < K; k++) {
      const e = E[k], r = 1 - e, zz = pulses[k].zz;
      for (let i = 0; i < nz; i++) m[i] = m[i] * e + r;
      if (pulses[k].excite) slices[pulses[k].slice].mzBefore[name] = Float64Array.from(m);
      for (let i = 0; i < nz; i++) m[i] *= zz[i];
    }

    // Slice j alone: its map from just before its excitation round one TR, whose fixed point is Mz before it.
    for (let j = 0; j < N; j++) {
      const ps = own[j], t0 = ps[0].t;
      a.fill(1); b.fill(0);
      for (let k = 0; k < ps.length; k++) step(k ? Math.exp(-(ps[k].t - ps[k - 1].t) / T1) : 1, ps[k].zz);
      step(Math.exp(-(TR - (ps[ps.length - 1].t - t0)) / T1), null);
      for (let i = 0; i < nz; i++) m[i] = b[i] / (1 - a[i]);
      // Can exceed 1: neighbours may saturate edges whose transverse phase opposes the centre's (coherent sum).
      const den = signal(m, j);
      slices[j].factor[name] = den > 0 ? signal(slices[j].mzBefore[name], j) / den : 1;
    }
  }
  return { z, slices, profiles: { excite, refocus } };
}
