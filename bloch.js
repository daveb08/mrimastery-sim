// Rotating-frame Bloch equation engine. No DOM; usable from the browser and Node.
//
// Units: time in ms, frequency in Hz, gradient in mT/m, position in mm.
// Convention: dM/dt = gamma M x B (+ relaxation), so with B1 along +x a
// positive pulse takes Mz toward +y, and positive off-resonance precesses
// clockwise seen from +z. Magnetization is a Float64Array [x0,y0,z0,x1,...]
// with one isochromat per triplet.

export const GAMMA_HZ_T = 42.577478461e6; // proton gamma / 2pi, NIST 2022
// 1 mT/m * 1 mm = 1 uT, and gamma/2pi is 42.577 Hz per uT.
export const HZ_PER_MT_M_MM = GAMMA_HZ_T * 1e-6;

export function equilibrium(count, m0 = 1) {
  const M = new Float64Array(3 * count);
  for (let i = 0; i < count; i++) M[3 * i + 2] = m0;
  return M;
}

// Advance every isochromat by dtMs. b1x/b1y are in Hz, offResHz is per
// isochromat (array) or a single number. Rotation is exact for the piecewise
// constant field; relaxation is applied afterwards (error O(dt^2)).
export function blochStep(M, b1x, b1y, offResHz, dtMs, T1, T2, m0 = 1) {
  const count = M.length / 3;
  const E1 = Number.isFinite(T1) ? Math.exp(-dtMs / T1) : 1;
  const E2 = Number.isFinite(T2) ? Math.exp(-dtMs / T2) : 1;
  const perSpin = typeof offResHz !== "number";
  for (let i = 0; i < count; i++) {
    const df = perSpin ? offResHz[i] : offResHz;
    const wx = b1x, wy = b1y, wz = df;
    const w = Math.hypot(wx, wy, wz);
    const o = 3 * i;
    let x = M[o], y = M[o + 1], z = M[o + 2];
    if (w > 0) {
      const theta = -2 * Math.PI * w * dtMs * 1e-3; // right-handed about +n
      const nx = wx / w, ny = wy / w, nz = wz / w;
      const c = Math.cos(theta), s = Math.sin(theta);
      const dot = nx * x + ny * y + nz * z;
      const cx = ny * z - nz * y, cy = nz * x - nx * z, cz = nx * y - ny * x;
      x = x * c + cx * s + nx * dot * (1 - c);
      y = y * c + cy * s + ny * dot * (1 - c);
      z = z * c + cz * s + nz * dot * (1 - c);
    }
    M[o] = x * E2;
    M[o + 1] = y * E2;
    M[o + 2] = m0 + (z - m0) * E1;
  }
  return M;
}

// RF envelope samples (arbitrary units) over [-0.5, 0.5] of the pulse.
export function envelope(kind, count, tbw = 4) {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count - 0.5; // fraction of duration
    if (kind === "sinc") {
      const x = u * tbw;
      out[i] = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    } else if (kind === "gaussian") {
      out[i] = Math.exp(-0.5 * (u * tbw / 0.75) ** 2); // ~ -3 sigma span at tbw 4.5
    } else {
      out[i] = 1;
    }
  }
  return out;
}

// Scale an envelope so its integral rotates a spin by flipDeg on resonance.
export function scaleToFlip(env, durMs, flipDeg) {
  const dt = durMs / env.length;
  let area = 0;
  for (const v of env) area += v * dt * 1e-3; // sum of env * seconds
  const k = flipDeg / 360 / area; // Hz per unit envelope
  return env.map((v) => v * k);
}

// Run a list of events and record M after every sample.
//   {type:"rf", flipDeg, phaseDeg, durMs, shape?, tbw?, gradMTm?}
//   {type:"delay", durMs}
// params: {positionsMm?, offResHz[], T1, T2, m0, dtMs, M0?}
// Returns {t: Float64Array, frames: Float64Array[]} including t=0, plus
// eventEnds: index in frames where each event finished.
export function runProgram(events, params) {
  const { T1, T2, m0 = 1, dtMs = 0.05 } = params;
  const offRes = params.offResHz ?? [0];
  const pos = params.positionsMm ?? null;
  const count = offRes.length;
  const M = params.M0 ? Float64Array.from(params.M0) : equilibrium(count, m0);
  const t = [0];
  const frames = [Float64Array.from(M)];
  const eventEnds = [];
  let now = 0;
  const df = new Float64Array(count);
  for (const ev of events) {
    const steps = Math.max(1, Math.round(ev.durMs / (ev.dtMs ?? dtMs)));
    const h = ev.durMs / steps;
    let wave = null;
    if (ev.type === "rf") {
      wave = scaleToFlip(envelope(ev.shape ?? "rect", steps, ev.tbw ?? 4), ev.durMs, ev.flipDeg);
    }
    const ph = ((ev.phaseDeg ?? 0) * Math.PI) / 180;
    for (let k = 0; k < steps; k++) {
      const g = ev.gradMTm ?? 0;
      for (let i = 0; i < count; i++) {
        df[i] = offRes[i] + (pos && g ? HZ_PER_MT_M_MM * g * pos[i] : 0);
      }
      const amp = wave ? wave[k] : 0;
      blochStep(M, amp * Math.cos(ph), amp * Math.sin(ph), df, h, T1, T2, m0);
      now += h;
      t.push(now);
      frames.push(Float64Array.from(M));
    }
    eventEnds.push(frames.length - 1);
  }
  return { t: Float64Array.from(t), frames, eventEnds };
}

// Mean transverse (Mx, My) and |Mxy| across isochromats for one frame.
export function meanTransverse(frame) {
  const n = frame.length / 3;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    sx += frame[3 * i]; sy += frame[3 * i + 1]; sz += frame[3 * i + 2];
  }
  return { mx: sx / n, my: sy / n, mz: sz / n, mxy: Math.hypot(sx, sy) / n };
}
