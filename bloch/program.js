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

// p: { program, flip, phase, pdur, shape, delay, tr, reps }. Returns the events, the TR actually used (raised to the
// minimum, rounded up to a whole ms, when p.tr is too short) and whether it was raised.
export function buildProgram(p) {
  const trMs = Math.max(p.tr, Math.ceil(minTrMs(p) - 1e-9));
  const rf = (role, flipDeg, phaseDeg) => ({
    type: "rf", role, label: `${Math.round(flipDeg)}° RF pulse`, flipDeg, phaseDeg, durMs: p.pdur, shape: p.shape,
    tbw: 4, dtMs: p.pdur / 80,
  });
  const wait = (durMs, label) => ({ type: "delay", label, durMs, dtMs: Math.max(0.1, durMs / 300) });
  const one = () => {
    const rest = (used, label) => (trMs - used > 1e-9 ? [wait(trMs - used, label)] : []);
    if (p.program === "se") {
      return [rf("excite", p.flip, p.phase), wait(p.delay, "free precession"), rf("refocus", 180, p.phase + 90),
        wait(p.delay, "to the echo"), ...rest(2 * p.delay + 2 * p.pdur, "recovery")];
    }
    if (p.program === "ir") {
      return [rf("invert", 180, p.phase), wait(p.delay, "inversion recovery"), rf("excite", p.flip, p.phase),
        ...rest(p.delay + 2 * p.pdur, "recovery")];
    }
    return [rf("excite", p.flip, p.phase), ...rest(p.pdur, "free precession")];
  };
  const events = [];
  for (let rep = 0; rep < p.reps; rep++) {
    if (rep > 0) events.push({ type: "spoil", label: "spoiled", rep });
    for (const ev of one()) events.push({ ...ev, rep });
  }
  return { events, trMs, raised: trMs > p.tr };
}
