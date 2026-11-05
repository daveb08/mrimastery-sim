// Exact k-space trajectory of an event-list sequence (shared/sequence.js): k(t) = gamma-bar * integral of G dt,
// integrated analytically over the trapezoids. An excitation sets k to 0 at the RF centre; a refocusing pulse sends k
// to -k there; an inversion pulse leaves it alone. Units: k in 1/mm, t in ms, G in mT/m.
import { GAMMA_BAR, gradEnd } from "./sequence.js";

const AXES = ["x", "y", "z"];

// Area of a trapezoid gradient from its start up to time t (mT/m * ms).
export function areaUpTo(g, t) {
  const s = g.start, r = g.rise, f = g.flat, d = g.fall;
  if (t <= s) return 0;
  const tau = t - s;
  if (tau <= r) return (g.amp * tau * tau) / (2 * r);
  if (tau <= r + f) return g.amp * (r / 2 + (tau - r));
  if (tau <= r + f + d) {
    const u = r + f + d - tau; // time left on the down ramp
    return g.amp * (r / 2 + f + d / 2) - (g.amp * u * u) / (2 * d);
  }
  return g.amp * (r / 2 + f + d / 2);
}

const gradientAt = (g, t) => {
  const tau = t - g.start;
  if (tau <= 0 || tau >= g.rise + g.flat + g.fall) return 0;
  if (tau < g.rise) return (g.amp * tau) / g.rise;
  if (tau <= g.rise + g.flat) return g.amp;
  return (g.amp * (g.rise + g.flat + g.fall - tau)) / g.fall;
};

// Precompute the k state at each RF centre so kAt(t) costs one pass over the gradients.
export function prepare(seq) {
  const grads = seq.events.filter((e) => e.kind === "grad");
  // inversion pulses only flip Mz (there is no transverse magnetisation yet), so they do not touch k
  const rfs = seq.events.filter((e) => e.kind === "rf" && e.role !== "invert").sort((a, b) => a.center - b.center);
  const integral = (a, b) => AXES.map((ax) => grads.reduce((s, g) => (g.axis === ax ? s + areaUpTo(g, b) - areaUpTo(g, a) : s), 0) * GAMMA_BAR);
  const states = []; // { t, k } just after each RF pulse
  let k = [0, 0, 0], tPrev = null;
  for (const rf of rfs) {
    if (tPrev !== null) k = k.map((v, i) => v + integral(tPrev, rf.center)[i]);
    k = rf.role === "excite" ? [0, 0, 0] : k.map((v) => -v);
    states.push({ t: rf.center, k: [...k] });
    tPrev = rf.center;
  }
  // k before the first excitation is undefined (no transverse magnetisation); report 0 there
  function kAt(t) {
    let lo = -1;
    for (let i = 0; i < states.length && states[i].t <= t; i++) lo = i;
    if (lo < 0) return [0, 0, 0];
    const base = states[lo].k, d = integral(states[lo].t, t);
    return [base[0] + d[0], base[1] + d[1], base[2] + d[2]];
  }
  const gAt = (t) => AXES.map((ax) => grads.reduce((s, g) => (g.axis === ax ? s + gradientAt(g, t) : s), 0));
  const end = Math.max(seq.tr, ...grads.map(gradEnd));
  return { kAt, gAt, states, end, firstExcite: rfs.find((r) => r.role === "excite")?.center ?? 0 };
}

// Sample times of an ADC event: sample i is where kx = (i - n/2) dk for dir > 0, or (n/2 - 1 - i) dk for dir < 0,
// so both readout directions land on the grid columns 0 .. n-1 (column n - 1 - i when reversed).
export function adcTimes(adc) {
  const off = adc.dir > 0 ? adc.n / 2 : adc.n / 2 - 1;
  return Array.from({ length: adc.n }, (_, i) => adc.tc + (i - off) * adc.dwell);
}

// Every ADC sample with its k position and the grid cell it fills.
export function adcSamples(seq, prepared = prepare(seq)) {
  const out = [];
  const { dkx, dky } = seq.info;
  for (const adc of seq.events.filter((e) => e.kind === "adc")) {
    adcTimes(adc).forEach((t, i) => {
      const [kx, ky, kz] = prepared.kAt(t);
      out.push({ t, kx, ky, kz, row: adc.row, slice: adc.slice ?? 0, i, colExact: kx / dkx + adc.n / 2, rowExact: ky / dky + seq.info.ny / 2 });
    });
  }
  return out;
}

// The trajectory sampled at n points between t0 and t1 (for drawing).
export function sampleTrajectory(seq, t0, t1, n = 2000, prepared = prepare(seq)) {
  const t = new Float64Array(n), kx = new Float64Array(n), ky = new Float64Array(n), kz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = t0 + ((t1 - t0) * i) / (n - 1);
    [kx[i], ky[i], kz[i]] = prepared.kAt(t[i]);
  }
  return { t, kx, ky, kz };
}
