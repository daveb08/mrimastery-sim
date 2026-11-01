// Pulse-sequence diagram drawn to scale from an event-list sequence (shared/sequence.js), as an SVG string.
// Rows: RF, Gss (z), Gpe (y), Gfe (x), ADC. Gradients share one amplitude scale, so their real relative strengths show.
// Long stretches with nothing happening (typically the wait until the end of TR) are compressed to a short break,
// marked with the time they stand for, so a whole TR fits; a time window zooms in.
import { gradEnd } from "./sequence.js";

export const ROWS = [
  { key: "rf", label: "RF", color: "#FFD700" },
  { key: "z", label: "Gss", color: "#FF6666" },
  { key: "y", label: "Gpe", color: "#66DD66" },
  { key: "x", label: "Gfe", color: "#6699FF" },
  { key: "adc", label: "ADC", color: "#FFFFFF" },
];

const span = (e) => {
  if (e.kind === "grad") return [e.start, gradEnd(e)];
  if (e.kind === "rf") return [e.center - e.duration / 2, e.center + e.duration / 2];
  const half = (e.n / 2 + 1) * e.dwell;
  return [e.tc - half, e.tc + half];
};

// Piecewise-linear time axis over [t0, t1]: busy stretches at full scale, idle gaps longer than the threshold shrunk to
// `breakWidth` (a fraction of the axis). Returns { segments, x(t), t(x) } with x in 0..1.
export function timeAxis(seq, t0, t1, { breakWidth = 0.05, minGapMs = 3, gapFraction = 0.2 } = {}) {
  const busy = seq.events.map(span).filter(([a, b]) => b > t0 && a < t1).map(([a, b]) => [Math.max(t0, a), Math.min(t1, b)])
    .sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const [a, b] of busy) {
    if (merged.length && a <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    else merged.push([a, b]);
  }
  const busyTotal = merged.reduce((s, [a, b]) => s + b - a, 0) || t1 - t0;
  const threshold = Math.max(minGapMs, gapFraction * busyTotal);
  // walk [t0, t1] as alternating busy / idle pieces
  const pieces = [];
  let cur = t0;
  for (const [a, b] of merged) {
    if (a > cur) pieces.push({ t0: cur, t1: a, idle: true });
    pieces.push({ t0: a, t1: b, idle: false });
    cur = b;
  }
  if (cur < t1) pieces.push({ t0: cur, t1, idle: true });
  const pad = 0.15 * threshold; // keep a little real time either side of a break so pulses do not touch it
  const segs = [];
  for (const p of pieces) {
    const len = p.t1 - p.t0;
    if (p.idle && len > threshold) {
      const lead = p.t0 > t0 ? pad : 0, tail = p.t1 < t1 ? pad : 0;
      if (lead) segs.push({ t0: p.t0, t1: p.t0 + lead, compressed: false });
      segs.push({ t0: p.t0 + lead, t1: p.t1 - tail, compressed: true });
      if (tail) segs.push({ t0: p.t1 - tail, t1: p.t1, compressed: false });
    } else segs.push({ t0: p.t0, t1: p.t1, compressed: false });
  }
  const nBreaks = segs.filter((s) => s.compressed).length;
  const realTotal = segs.filter((s) => !s.compressed).reduce((s, g) => s + g.t1 - g.t0, 0) || 1;
  const realWidth = Math.max(0.2, 1 - nBreaks * breakWidth);
  let x = 0;
  for (const s of segs) {
    s.x0 = x;
    x += s.compressed ? breakWidth : ((s.t1 - s.t0) / realTotal) * realWidth;
    s.x1 = x;
  }
  const scale = x || 1;
  for (const s of segs) { s.x0 /= scale; s.x1 /= scale; }
  const toX = (t) => {
    if (t <= t0) return 0;
    if (t >= t1) return 1;
    const s = segs.find((g) => t <= g.t1) ?? segs[segs.length - 1];
    return s.x0 + ((t - s.t0) / (s.t1 - s.t0 || 1)) * (s.x1 - s.x0);
  };
  const toT = (xv) => {
    const s = segs.find((g) => xv <= g.x1) ?? segs[segs.length - 1];
    return s.t0 + ((xv - s.x0) / (s.x1 - s.x0 || 1)) * (s.t1 - s.t0);
  };
  return { segments: segs, x: toX, t: toT, t0, t1 };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f = (v) => (Math.round(v * 10) / 10).toString();

function niceStep(range, target) {
  const raw = range / target, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}

// Geometry shared by the drawing and by overlays (a moving cursor): viewBox size, plot area, rows and the time axis.
export function diagramGeometry(seq, opts = {}) {
  const W = opts.width ?? 1000, rowH = opts.rowHeight ?? 52;
  const left = 58, right = 14, top = 26, axisH = 30;
  const plotW = W - left - right, H = top + ROWS.length * rowH + axisH;
  const [t0, t1] = opts.window ?? [0, seq.tr];
  const ax = timeAxis(seq, t0, t1);
  return { W, H, left, right, top, rowH, plotW, t0, t1, axis: ax, X: (t) => left + ax.x(t) * plotW };
}

// opts: { width, rowHeight, window: [t0, t1], cursor: t, fontScale, scale: "axis" | "shared", signal: [{ t, v }], peaks: { x, y, z } }
// "axis" gives each gradient row its own full height (its peak is labelled); "shared" keeps true relative strengths.
// `signal` (v from 0 to 1) is drawn on the ADC row: the received signal magnitude at each sample.
export function diagramSvg(seq, opts = {}) {
  const fs = 12 * (opts.fontScale ?? 1);
  const { W, H, left, right, top, rowH, plotW, t0, t1, axis: ax, X } = diagramGeometry(seq, opts);
  const grads = seq.events.filter((e) => e.kind === "grad");
  const shared = opts.scale === "shared";
  // opts.peaks (per axis, e.g. the largest values over a whole scan) keeps heights comparable from one TR to the next
  const own = (axis) => Math.max(1e-9, ...grads.filter((g) => g.axis === axis).map((g) => Math.abs(g.amp)));
  const axisPeak = Object.fromEntries(["x", "y", "z"].map((a) => [a, Math.max(own(a), opts.peaks?.[a] ?? 0)]));
  const all = Math.max(axisPeak.x, axisPeak.y, axisPeak.z);
  const rowPeak = shared ? { x: all, y: all, z: all } : axisPeak;
  const rowMid = (i) => top + i * rowH + rowH / 2;
  const amp = (i, v) => rowMid(i) - (v / rowPeak[ROWS[i].key]) * (rowH * 0.42);
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#1a1a1a"/>`);
  parts.push(`<clipPath id="sdclip"><rect x="${left}" y="0" width="${plotW}" height="${H}"/></clipPath>`);

  // breaks: shaded band with zig-zag marks and the real time it stands for
  for (const s of ax.segments.filter((g) => g.compressed)) {
    const xa = left + s.x0 * plotW, xb = left + s.x1 * plotW, xm = (xa + xb) / 2;
    parts.push(`<rect x="${f(xa)}" y="${top}" width="${f(xb - xa)}" height="${ROWS.length * rowH}" fill="#262626"/>`);
    for (let i = 0; i < ROWS.length; i++) {
      const y = rowMid(i);
      parts.push(`<path d="M${f(xm - 5)},${f(y - 6)}l4,12M${f(xm + 1)},${f(y - 6)}l4,12" stroke="#777" stroke-width="1.2"/>`);
    }
    parts.push(`<text x="${f(xm)}" y="${f(top + ROWS.length * rowH + 13)}" fill="#999" font-size="${f(fs * 0.85)}" text-anchor="middle">${(s.t1 - s.t0).toFixed(0)} ms</text>`);
  }

  ROWS.forEach((row, i) => {
    const y = rowMid(i);
    parts.push(`<text x="${left - 8}" y="${f(y + fs * 0.35)}" fill="${row.color}" font-size="${f(fs)}" text-anchor="end">${row.label}</text>`);
    if (!shared && rowPeak[row.key]) {
      parts.push(`<text x="${left - 8}" y="${f(y + fs * 1.35)}" fill="#888" font-size="${f(fs * 0.72)}" text-anchor="end">${rowPeak[row.key].toFixed(1)} mT/m</text>`);
    }
    parts.push(`<line x1="${left}" y1="${f(y)}" x2="${W - right}" y2="${f(y)}" stroke="#3a3a3a" stroke-width="1"/>`);
  });

  const body = [];
  // gradients as filled trapezoids
  for (const g of grads) {
    const i = ROWS.findIndex((r) => r.key === g.axis);
    const xs = [g.start, g.start + g.rise, g.start + g.rise + g.flat, gradEnd(g)].map(X);
    const y0 = rowMid(i), ya = amp(i, g.amp);
    const col = ROWS[i].color;
    body.push(`<path d="M${f(xs[0])},${f(y0)}L${f(xs[1])},${f(ya)}L${f(xs[2])},${f(ya)}L${f(xs[3])},${f(y0)}Z" fill="${col}" fill-opacity=".28" stroke="${col}" stroke-width="1.3">`
      + `<title>${esc(g.label || "gradient")}: ${g.amp.toFixed(2)} mT/m, ${(gradEnd(g) - g.start).toFixed(2)} ms</title></path>`);
  }
  // RF pulses as sinc envelopes, height by flip angle
  for (const rf of seq.events.filter((e) => e.kind === "rf")) {
    const n = 48, a = Math.min(1, rf.flip / 180) * 0.75 + 0.25;
    const pts = Array.from({ length: n + 1 }, (_, k) => {
      const u = (k / n) * 2 - 1, x = u * 2; // sinc with two side lobes each side (time-bandwidth 4)
      const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      return `${f(X(rf.center + (u * rf.duration) / 2))},${f(rowMid(0) - s * a * rowH * 0.42)}`;
    });
    body.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#FFD700" stroke-width="1.5"><title>${rf.role === "excite" ? "excitation" : "refocusing"} ${rf.flip}°, ${rf.duration} ms</title></polyline>`);
    if (rf.center >= t0 && rf.center <= t1) {
      body.push(`<text x="${f(X(rf.center))}" y="${f(top + 10)}" fill="#FFD700" font-size="${f(fs * 0.9)}" text-anchor="middle" font-weight="bold">${rf.flip}°</text>`);
    }
  }
  // ADC windows
  for (const adc of seq.events.filter((e) => e.kind === "adc")) {
    const [a, b] = span(adc), y = rowMid(4);
    body.push(`<rect x="${f(X(a))}" y="${f(y - rowH * 0.22)}" width="${f(Math.max(1, X(b) - X(a)))}" height="${f(rowH * 0.44)}" fill="#ffffff" fill-opacity=".18" stroke="#ddd" stroke-width="1">`
      + `<title>ADC: ${adc.n} samples, ${(adc.n * adc.dwell).toFixed(2)} ms, ky line ${adc.row}${adc.dir < 0 ? " (read right to left)" : ""}</title></rect>`);
    body.push(`<line x1="${f(X(adc.tc))}" y1="${f(y - rowH * 0.3)}" x2="${f(X(adc.tc))}" y2="${f(y + rowH * 0.3)}" stroke="#fff" stroke-width="1" stroke-dasharray="2 2"/>`);
  }
  if (opts.signal && opts.signal.length) {
    const y = rowMid(4) + rowH * 0.22; // baseline at the bottom of the ADC boxes
    let d = "", prevT = -Infinity;
    for (const { t, v } of opts.signal) {
      d += `${t - prevT > 0.5 ? "M" : "L"}${f(X(t))},${f(y - v * rowH * 0.42)}`; // new stroke after a gap between ADC windows
      prevT = t;
    }
    body.push(`<path d="${d}" stroke="#ffffff" stroke-width="1.4" fill="none"><title>Received signal magnitude</title></path>`);
  }
  parts.push(`<g clip-path="url(#sdclip)">${body.join("")}</g>`);

  // time axis: ticks in real ms on the uncompressed stretches
  const axisY = top + ROWS.length * rowH;
  parts.push(`<line x1="${left}" y1="${axisY}" x2="${W - right}" y2="${axisY}" stroke="#555"/>`);
  const realSegs = ax.segments.filter((s) => !s.compressed);
  const realSpan = realSegs.reduce((s, g) => s + g.t1 - g.t0, 0);
  const step = niceStep(realSpan, Math.max(3, Math.floor(plotW / 90)));
  const ticks = [];
  for (const s of realSegs) {
    for (let t = Math.ceil(s.t0 / step) * step; t <= s.t1 + 1e-9; t += step) ticks.push(t);
  }
  let lastX = -1e9;
  for (const t of ticks) {
    const x = X(t);
    if (x - lastX < 40) continue;
    lastX = x;
    parts.push(`<line x1="${f(x)}" y1="${axisY}" x2="${f(x)}" y2="${axisY + 4}" stroke="#777"/>`
      + `<text x="${f(x)}" y="${f(axisY + 16)}" fill="#aaa" font-size="${f(fs * 0.85)}" text-anchor="middle">${+t.toFixed(3)}</text>`);
  }
  parts.push(`<text x="${W - right}" y="${f(H - 2)}" fill="#888" font-size="${f(fs * 0.85)}" text-anchor="end">time (ms)</text>`);
  parts.push(`<text x="${left}" y="${f(top - 10)}" fill="#888" font-size="${f(fs * 0.85)}">${shared
    ? `gradient heights to one scale: ${rowPeak.x.toFixed(1)} mT/m full height`
    : "gradient heights scaled per axis (peak shown under each label)"}</text>`);

  if (opts.cursor !== undefined && opts.cursor >= t0 && opts.cursor <= t1) {
    const x = X(opts.cursor);
    parts.push(`<line x1="${f(x)}" y1="${top - 4}" x2="${f(x)}" y2="${axisY}" stroke="#7fd8ff" stroke-width="2"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pulse sequence diagram to scale" style="width:100%;height:auto;display:block">${parts.join("")}</svg>`;
}
