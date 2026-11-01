// Event-list pulse sequences in real units (ms, mT/m, mm), built from imaging parameters within scanner limits.
// A sequence is { events, te, tr, errors, info } where events are
//   { kind: "rf",   role: "excite" | "refocus" | "invert", center, duration, flip, phase }
//   { kind: "grad", axis: "x" | "y" | "z", start, rise, flat, fall, amp, label }   (trapezoid; amp in mT/m)
//   { kind: "adc",  tc, n, dwell, dir, row }  (k crosses kx = 0 at tc; sample i maps to grid column i, or n - 1 - i if dir < 0)
// x is the frequency-encode (readout) axis, y phase encode, z slice select. k(t) is computed in shared/ktraj.js.

export const GAMMA_BAR = 0.042577478461; // proton gamma / 2 pi in 1 / (mm * mT/m * ms), i.e. 42.577 MHz/T
export const DEFAULT_LIMITS = { gMax: 40, slew: 150 }; // mT/m and mT/m/ms (= T/m/s)
const RF_TBW = 4; // time-bandwidth product of the sinc pulses
const CRUSH_CYCLES = 2; // crusher area: cycles of phase across the slice

export const DEFAULTS = {
  fovRead: 240, fovPhase: 240, nx: 128, ny: 128, bw: 260, sliceMm: 5, TE: 20, TR: 500, ETL: 8, flip: 90,
  rfExcite: 2.0, rfRefocus: 2.0, rfInvert: 4.0, inversion: "none", TI: 2500, TI1: 3400, TI2: 800, limits: DEFAULT_LIMITS,
};

// ---- trapezoids ----
export const gradArea = (g) => g.amp * (g.flat + (g.rise + g.fall) / 2);
export const gradEnd = (g) => g.start + g.rise + g.flat + g.fall;
const riseFor = (amp, lim) => Math.max(1e-3, Math.abs(amp) / lim.slew);

export function trap(axis, start, amp, flat, lim, label = "") {
  const rise = riseFor(amp, lim);
  return { kind: "grad", axis, start, rise, flat, fall: rise, amp, label };
}

// Shortest trapezoid (or triangle) with a given area: full gradient strength if it can, otherwise a triangle.
export function shortestTrap(axis, start, area, lim, label = "") {
  const a = Math.abs(area), s = Math.sign(area) || 1;
  if (a <= (lim.gMax * lim.gMax) / lim.slew) {
    const amp = Math.sqrt(a * lim.slew);
    const rise = Math.max(1e-3, amp / lim.slew);
    return { kind: "grad", axis, start, rise, flat: 0, fall: rise, amp: s * (a / rise), label };
  }
  const rise = lim.gMax / lim.slew;
  return { kind: "grad", axis, start, rise, flat: a / lim.gMax - rise, fall: rise, amp: s * lim.gMax, label };
}

// A trapezoid with the timing of `shape` but scaled to a different area (phase encodes all share one timing).
export const scaledTrap = (shape, start, area, label = shape.label) =>
  ({ ...shape, start, amp: area / (shape.flat + (shape.rise + shape.fall) / 2), label });

// ---- shared building blocks ----
function readoutGeometry(P, errors) {
  const lim = P.limits;
  const dwell = 1000 / (P.bw * P.nx); // ms per sample
  const dkx = 1 / P.fovRead, dky = 1 / P.fovPhase;
  const gRead = dkx / (GAMMA_BAR * dwell);
  if (gRead > lim.gMax) {
    errors.push(`Readout gradient ${gRead.toFixed(1)} mT/m exceeds the ${lim.gMax} mT/m limit: lower the bandwidth or the matrix, or widen the FOV`);
  }
  const flat = (P.nx + 1) * dwell; // the ADC window (n samples, offset half a dwell either way) fits inside
  const rise = riseFor(gRead, lim);
  return { nx: P.nx, ny: P.ny, dwell, dkx, dky, gRead, flat, rise, half: rise + flat / 2, halfArea: gRead * (rise / 2 + flat / 2) };
}

function sliceSelect(P, duration, errors) {
  const g = RF_TBW / duration / (GAMMA_BAR * P.sliceMm); // RF bandwidth / (gamma-bar * thickness)
  if (g > P.limits.gMax) errors.push(`Slice-select gradient ${g.toFixed(1)} mT/m exceeds the limit: use a thicker slice`);
  return g;
}

// Excitation: slice-select lobe centred on the RF pulse, then its rephaser. Returns events and timing.
function excitation(P, t0, flip, errors) {
  const lim = P.limits, d = P.rfExcite, gss = sliceSelect(P, d, errors);
  const lobe = trap("z", t0, gss, d, lim, "slice select");
  const center = t0 + lobe.rise + d / 2;
  const reph = shortestTrap("z", gradEnd(lobe), -gss * (d / 2 + lobe.fall / 2), lim, "slice rephaser");
  return { center, end: gradEnd(lobe), rephEnd: gradEnd(reph), events: [lobe, { kind: "rf", role: "excite", center, duration: d, flip, phase: 0 }, reph] };
}

// Refocusing: crusher, slice-select lobe centred on the 180, crusher. `half` is centre-to-edge of the block.
function refocusBlock(P, center) {
  const lim = P.limits, d = P.rfRefocus, gss = sliceSelect(P, d, []);
  const lobe = trap("z", 0, gss, d, lim, "slice select");
  const crush = shortestTrap("z", 0, CRUSH_CYCLES / (GAMMA_BAR * P.sliceMm), lim, "crusher");
  const cDur = gradEnd(crush);
  const half = cDur + lobe.rise + d / 2;
  const start = center - half;
  const events = [
    { ...crush, start },
    { ...lobe, start: start + cDur },
    { kind: "rf", role: "refocus", center, duration: d, flip: 180, phase: 90 },
    { ...crush, start: start + cDur + gradEnd(lobe) },
  ];
  return { half, events };
}

function finish(events, te, tr, errors, info) {
  events.sort((a, b) => (a.start ?? a.center ?? a.tc) - (b.start ?? b.center ?? b.tc));
  return { events, te, tr, errors, info };
}

// ---- spin echo (one line per TR) ----
export function spinEcho(P0, row) {
  const P = { ...DEFAULTS, ...P0 }, lim = P.limits, errors = [];
  const ro = readoutGeometry(P, errors);
  const ex = excitation(P, 0, 90, errors);
  const ky = (row - P.ny / 2) * ro.dky;
  const peShape = shortestTrap("y", 0, (P.ny / 2) * ro.dky / GAMMA_BAR, lim, "phase encode");
  // before the 180 the readout prephaser is positive: the 180 turns +k into -k
  const pre = shortestTrap("x", ex.end, ro.halfArea, lim, "readout prephaser");
  const pe = scaledTrap(peShape, ex.end, -ky / GAMMA_BAR); // also before the 180, so it is applied with the opposite sign
  const ref = refocusBlock(P, 0);
  const firstHalf = Math.max(gradEnd(pre), gradEnd(pe), ex.rephEnd) - ex.center + ref.half;
  const secondHalf = ref.half + ro.half;
  const minTE = 2 * Math.max(firstHalf, secondHalf);
  let TE = P.TE;
  if (TE < minTE - 1e-9) { errors.push(`TE too short: the minimum TE is ${minTE.toFixed(1)} ms`); TE = minTE; }
  const t180 = ex.center + TE / 2, tEcho = ex.center + TE;
  const read = trap("x", tEcho - ro.half, ro.gRead, ro.flat, lim, "readout");
  const end = gradEnd(read);
  let TR = P.TR;
  if (TR < end) { errors.push(`TR too short: the minimum TR is ${Math.ceil(end)} ms`); TR = end; }
  const events = [...ex.events, pre, pe, ...refocusBlock(P, t180).events, read,
    { kind: "adc", tc: tEcho, n: P.nx, dwell: ro.dwell, dir: 1, row }];
  return finish(events, TE, TR, errors, { ...ro, minTE, rows: [row] });
}

// ---- spoiled gradient echo (one line per TR) ----
export function gradientEcho(P0, row) {
  const P = { ...DEFAULTS, ...P0 }, lim = P.limits, errors = [];
  const ro = readoutGeometry(P, errors);
  const ex = excitation(P, 0, P.flip, errors);
  const ky = (row - P.ny / 2) * ro.dky;
  const peShape = shortestTrap("y", 0, (P.ny / 2) * ro.dky / GAMMA_BAR, lim, "phase encode");
  const pre = shortestTrap("x", ex.end, -ro.halfArea, lim, "readout prephaser");
  const pe = scaledTrap(peShape, ex.end, ky / GAMMA_BAR);
  const minTE = Math.max(gradEnd(pre), gradEnd(pe), ex.rephEnd) - ex.center + ro.half;
  let TE = P.TE;
  if (TE < minTE - 1e-9) { errors.push(`TE too short: the minimum TE is ${minTE.toFixed(2)} ms`); TE = minTE; }
  const tEcho = ex.center + TE;
  const read = trap("x", tEcho - ro.half, ro.gRead, ro.flat, lim, "readout");
  const rew = scaledTrap(peShape, gradEnd(read), -ky / GAMMA_BAR, "phase rewinder");
  const spoil = shortestTrap("z", gradEnd(read), 4 / (GAMMA_BAR * P.sliceMm), lim, "spoiler");
  const end = Math.max(gradEnd(rew), gradEnd(spoil));
  let TR = P.TR;
  if (TR < end) { errors.push(`TR too short: the minimum TR is ${end.toFixed(1)} ms`); TR = end; }
  const events = [...ex.events, pre, pe, read, rew, spoil, { kind: "adc", tc: tEcho, n: P.nx, dwell: ro.dwell, dir: 1, row }];
  return finish(events, TE, TR, errors, { ...ro, minTE, rows: [row] });
}

// ---- fast spin echo: one echo train per TR; rows[m] is the k-space row of echo m ----
// The echo spacing is the shortest the hardware allows; echoes sit at ESP, 2 ESP, ... after the 90.
export function fastSpinEcho(P0, rows) {
  const P = { ...DEFAULTS, ...P0 }, lim = P.limits, errors = [];
  const ro = readoutGeometry(P, errors);
  const ex = excitation(P, 0, 90, errors);
  const peShape = shortestTrap("y", 0, (P.ny / 2) * ro.dky / GAMMA_BAR, lim, "phase encode");
  const peDur = gradEnd(peShape);
  const ref = refocusBlock(P, 0);
  const pre = shortestTrap("x", ex.end, ro.halfArea, lim, "readout prephaser");
  const halfEsp = Math.max(ref.half + peDur + ro.half, Math.max(gradEnd(pre), ex.rephEnd) - ex.center + ref.half);
  const esp = 2 * halfEsp;
  const events = [...ex.events, pre];
  rows.forEach((row, m) => {
    const t180 = ex.center + esp * (m + 0.5), tEcho = ex.center + esp * (m + 1);
    const ky = (row - P.ny / 2) * ro.dky;
    events.push(...refocusBlock(P, t180).events);
    events.push(scaledTrap(peShape, t180 + ref.half, ky / GAMMA_BAR));
    const read = trap("x", tEcho - ro.half, ro.gRead, ro.flat, lim, "readout");
    events.push(read, { kind: "adc", tc: tEcho, n: P.nx, dwell: ro.dwell, dir: 1, row });
    events.push(scaledTrap(peShape, gradEnd(read), -ky / GAMMA_BAR, "phase rewinder"));
  });
  const centre = rows.indexOf(P.ny / 2);
  const te = centre >= 0 ? esp * (centre + 1) : null; // effective TE: the echo that crosses ky = 0
  const end = Math.max(...events.filter((e) => e.kind === "grad").map(gradEnd));
  let TR = P.TR;
  if (TR < end) { errors.push(`TR too short: the minimum TR for this echo train is ${Math.ceil(end)} ms`); TR = end; }
  return finish(events, te, TR, errors, { ...ro, esp, rows: [...rows] });
}

// ---- single-shot EPI: every row in one train, alternating readout polarity, one blip per line ----
export function epi(P0, rows) {
  const P = { ...DEFAULTS, ...P0 }, lim = P.limits, errors = [];
  const ro = readoutGeometry(P, errors);
  const ex = excitation(P, 0, 90, errors);
  const blip = shortestTrap("y", 0, ro.dky / GAMMA_BAR, lim, "blip");
  const gap = Math.max(0, gradEnd(blip) - 2 * ro.rise); // ramps are where the blips go; widen only if a blip will not fit
  const period = ro.flat + 2 * ro.rise + gap; // echo spacing
  const preX = shortestTrap("x", ex.end, -ro.halfArea, lim, "readout prephaser");
  const preY = shortestTrap("y", ex.end, (rows[0] - P.ny / 2) * ro.dky / GAMMA_BAR, lim, "phase prephaser");
  const trainStart = Math.max(gradEnd(preX), gradEnd(preY), ex.rephEnd);
  const centre = rows.indexOf(P.ny / 2);
  const minTE = trainStart + ro.half + Math.max(0, centre) * period - ex.center;
  let TE = P.TE;
  if (TE < minTE - 1e-9) { errors.push(`TE too short: the minimum TE for this train is ${minTE.toFixed(1)} ms`); TE = minTE; }
  const t0 = trainStart + (TE - minTE); // a longer TE delays the whole train
  const events = [...ex.events, preX, preY];
  rows.forEach((row, m) => {
    const dir = m % 2 === 0 ? 1 : -1, tc = t0 + ro.half + m * period;
    events.push({ ...trap("x", tc - ro.half, dir * ro.gRead, ro.flat, lim, "readout") });
    events.push({ kind: "adc", tc, n: P.nx, dwell: ro.dwell, dir, row });
    if (m < rows.length - 1) {
      const zero = tc + ro.half + gap / 2; // between lobes, where the readout passes through zero
      events.push({ ...blip, start: zero - gradEnd(blip) / 2, amp: blip.amp * Math.sign(rows[m + 1] - row) });
    }
  });
  const end = Math.max(...events.filter((e) => e.kind === "grad").map(gradEnd));
  let TR = P.TR;
  if (TR < end) { errors.push(`TR too short: the minimum TR is ${Math.ceil(end)} ms`); TR = end; }
  return finish(events, TE, TR, errors, { ...ro, esp: period, minTE, rows: [...rows] });
}

// ---- inversion recovery: one (IR: FLAIR, STIR) or two (DIR) 180° inversions before the excitation ----
// P.inversion is "none" | "IR" | "DIR". Inversion times run from each inversion's centre to the excitation's centre:
// IR uses P.TI; DIR uses P.TI1 (first inversion) and P.TI2 (second, so TI2 < TI1). An inversion only flips Mz, so it
// leaves k alone; the spoiler after it dephases any transverse magnetisation an imperfect inversion leaves behind.
function inversionBlock(P, center) {
  const lim = P.limits, d = P.rfInvert, gss = sliceSelect(P, d, []);
  const lobe = trap("z", 0, gss, d, lim, "inversion slice select");
  const spoil = shortestTrap("z", 0, 4 / (GAMMA_BAR * P.sliceMm), lim, "spoiler");
  const start = center - lobe.rise - d / 2;
  const events = [
    { ...lobe, start },
    { kind: "rf", role: "invert", center, duration: d, flip: 180, phase: 0 },
    { ...spoil, start: start + gradEnd(lobe) },
  ];
  return { events, lead: lobe.rise + d / 2, tail: gradEnd(lobe) - lobe.rise - d / 2 + gradEnd(spoil) };
}

export function withInversion(build) {
  return (P0, rows) => {
    const P = { ...DEFAULTS, ...P0 };
    if (!P.inversion || P.inversion === "none") return build(P0, rows);
    const img = build({ ...P0, TR: Infinity }, rows); // timed here, once the inversions are in front
    const errors = [...img.errors];
    const probe = inversionBlock(P, 0);
    const exCenter = img.events.find((e) => e.kind === "rf" && e.role === "excite").center;
    const minGap = probe.tail + probe.lead; // inversion centre to the next pulse's centre
    const minTI = probe.tail + exCenter;
    // centres of the inversions, measured back from the excitation
    let tis;
    if (P.inversion === "DIR") {
      let ti2 = P.TI2, ti1 = P.TI1;
      if (ti2 < minTI - 1e-9) { errors.push(`TI2 too short: the minimum TI2 is ${Math.ceil(minTI)} ms`); ti2 = minTI; }
      if (ti1 < ti2 + minGap - 1e-9) { errors.push(`TI1 must be at least ${Math.ceil(minGap)} ms longer than TI2`); ti1 = ti2 + minGap; }
      tis = [ti1, ti2];
    } else {
      let ti = P.TI;
      if (ti < minTI - 1e-9) { errors.push(`TI too short: the minimum TI is ${Math.ceil(minTI)} ms`); ti = minTI; }
      tis = [ti];
    }
    const first = probe.lead; // the first inversion block starts at t = 0
    const offset = first + tis[0] - exCenter; // shift of the imaging part
    const events = [];
    for (const ti of tis) events.push(...inversionBlock(P, first + tis[0] - ti).events);
    for (const e of img.events) events.push(e.kind === "adc" ? { ...e, tc: e.tc + offset } : e.kind === "rf" ? { ...e, center: e.center + offset } : { ...e, start: e.start + offset });
    const end = Math.max(...events.filter((e) => e.kind === "grad").map(gradEnd));
    let TR = P.TR;
    if (TR < end) { errors.push(`TR too short: the minimum TR with the inversion${tis.length > 1 ? "s" : ""} is ${Math.ceil(end)} ms`); TR = end; }
    return finish(events, img.te, TR, errors, { ...img.info, minTI, ti: tis });
  };
}

export const BUILDERS = { SE: withInversion(spinEcho), GRE: withInversion(gradientEcho), FSE: withInversion(fastSpinEcho), EPI: withInversion(epi) };
