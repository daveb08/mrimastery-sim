// Experiment programs for the Bloch simulator: the event list for one experiment, repeated every TR. No DOM.
//
// Each repetition is: pulse  — excite, free precession until TR
//                     se     — excite, tau, refocus (180, phase + 90), tau (the echo), recovery until TR
//                     ir     — invert (180), TI, excite, recovery until TR
// Leftover transverse magnetization is spoiled between repetitions (never after the last one), as crusher or
// spoiler gradients do on a scanner. Every event carries `rep` (0-based); RF events carry `role`.

// The shortest TR each experiment allows (ms): its pulses and fixed delays.
export function minTrMs({ program, delay, pdur }) {
  if (program === "se") return 2 * delay + 2 * pdur;
  if (program === "ir") return delay + 2 * pdur;
  return pdur;
}

// Sampling: free precession is stepped finely enough to show T2 decay and off-resonance precession (8 steps per turn
// of the fastest spin, at most 1500 frames per segment); recovery after the signal has gone is stepped coarsely.
const FINE_MAX_FRAMES = 1500, T2_SPAN = 5;

// p: { program, flip, phase, pdur, shape, delay, tr, reps, t2?, off?, spread? }. Returns the events, the TR actually used (raised to the
// minimum, rounded up to a whole ms, when p.tr is too short) and whether it was raised.
export function buildProgram(p) {
  const trMs = Math.max(p.tr, Math.ceil(minTrMs(p) - 1e-9));
  const rf = (role, flipDeg, phaseDeg) => ({
    type: "rf", role, label: `${Math.round(flipDeg)}° RF pulse`, flipDeg, phaseDeg, durMs: p.pdur, shape: p.shape,
    tbw: 4, dtMs: p.pdur / 80,
  });
  const fastestHz = Math.abs(p.off ?? 0) + Math.abs(p.spread ?? 0);
  const aliasMs = fastestHz > 0 ? 1000 / (8 * fastestHz) : Infinity;
  const coarse = (durMs, label) => ({ type: "delay", label, durMs, dtMs: Math.max(0.1, durMs / 300) });
  const fine = (durMs, label) => ({ type: "delay", label, durMs,
    dtMs: Math.max(durMs / FINE_MAX_FRAMES, Math.min(Math.max(0.1, durMs / 300), aliasMs)) });
  // After an excitation or an echo: the decaying signal finely (about 5 x T2), then recovery to TR coarsely.
  const tail = (used) => {
    const left = trMs - used;
    if (left <= 1e-9) return [];
    const span = Math.min(left, T2_SPAN * (p.t2 ?? 100));
    return [fine(span, "free precession"), ...(left - span > 1e-9 ? [coarse(left - span, "recovery")] : [])];
  };
  const one = () => {
    if (p.program === "se") {
      return [rf("excite", p.flip, p.phase), fine(p.delay, "free precession"), rf("refocus", 180, p.phase + 90),
        fine(p.delay, "to the echo"), ...tail(2 * p.delay + 2 * p.pdur)];
    }
    if (p.program === "ir") {
      return [rf("invert", 180, p.phase), coarse(p.delay, "inversion recovery"), rf("excite", p.flip, p.phase),
        ...tail(p.delay + 2 * p.pdur)];
    }
    return [rf("excite", p.flip, p.phase), ...tail(p.pdur)];
  };
  const events = [];
  for (let rep = 0; rep < p.reps; rep++) {
    if (rep > 0) events.push({ type: "spoil", label: "spoiled", rep });
    for (const ev of one()) events.push({ ...ev, rep });
  }
  return { events, trMs, raised: trMs > p.tr };
}
