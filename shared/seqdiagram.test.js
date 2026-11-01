import test from "node:test";
import assert from "node:assert/strict";
import { timeAxis, diagramSvg } from "./seqdiagram.js";
import { DEFAULTS, spinEcho, gradientEcho, fastSpinEcho, epi, gradEnd } from "./sequence.js";

const P = { ...DEFAULTS, nx: 64, ny: 64 };

test("the time axis is monotonic, spans 0..1, and keeps busy stretches at one common scale", () => {
  const seq = spinEcho({ ...P, TE: 30, TR: 2000 }, 32);
  const ax = timeAxis(seq, 0, seq.tr);
  assert.equal(ax.x(0), 0);
  assert.equal(ax.x(seq.tr), 1);
  let prev = -1;
  for (let t = 0; t <= seq.tr; t += 0.5) { const x = ax.x(t); assert.ok(x >= prev - 1e-12); prev = x; }
  const real = ax.segments.filter((s) => !s.compressed);
  const rates = real.filter((s) => s.t1 - s.t0 > 1e-6).map((s) => (s.x1 - s.x0) / (s.t1 - s.t0));
  for (const r of rates) assert.ok(Math.abs(r - rates[0]) < 1e-9 * rates[0]); // same ms-per-pixel everywhere
});

test("the long wait to the end of TR is compressed to a short break, and nothing that happens is compressed", () => {
  const seq = gradientEcho({ ...P, TE: 5, TR: 500 }, 10);
  const ax = timeAxis(seq, 0, seq.tr);
  const breaks = ax.segments.filter((s) => s.compressed);
  assert.equal(breaks.length, 1);
  const last = Math.max(...seq.events.filter((e) => e.kind === "grad").map(gradEnd));
  assert.ok(breaks[0].t0 >= last - 1e-9); // the break starts after the last gradient
  assert.ok(breaks[0].x1 - breaks[0].x0 < 0.1); // and takes little width, although it is most of the TR
  assert.ok(ax.x(last) > 0.8);
});

test("x and t are inverse maps on the uncompressed stretches", () => {
  const seq = fastSpinEcho({ ...P, ETL: 4 }, [32, 16, 48, 0]);
  const ax = timeAxis(seq, 0, seq.tr);
  for (const t of [1, 5, 12.3, 20]) assert.ok(Math.abs(ax.t(ax.x(t)) - t) < 1e-9);
});

test("a time window zooms in: the window fills the axis", () => {
  const seq = epi({ ...P, bw: 1500, TE: 30 }, Array.from({ length: 64 }, (_, i) => i));
  const ax = timeAxis(seq, 20, 30);
  assert.equal(ax.x(20), 0);
  assert.equal(ax.x(30), 1);
  assert.ok(ax.x(25) > 0.3 && ax.x(25) < 0.7);
});

test("the SVG draws every gradient, RF pulse and ADC window, labels the rows, and shows the cursor", () => {
  const seq = spinEcho({ ...P, TE: 30, TR: 1000 }, 0);
  const svg = diagramSvg(seq, { cursor: 15 });
  const n = (re) => (svg.match(re) || []).length;
  assert.equal(n(/<path d="M[^"]*Z"/g), seq.events.filter((e) => e.kind === "grad").length);
  assert.equal(n(/<polyline /g), 2); // 90 and 180
  assert.equal(n(/<title>ADC:/g), 1);
  for (const label of [">RF<", ">Gss<", ">Gpe<", ">Gfe<", ">ADC<"]) assert.ok(svg.includes(label));
  assert.ok(svg.includes('stroke="#7fd8ff"'));
  assert.ok(svg.includes("ms</text>")); // the break label
});

test("gradient heights: per axis by default (each row's peak labelled), or one shared scale", () => {
  const seq = gradientEcho({ ...P, TE: 5, TR: 50 }, 0);
  const perAxis = diagramSvg(seq);
  assert.equal((perAxis.match(/mT\/m<\/text>/g) || []).length, 3);
  const shared = diagramSvg(seq, { scale: "shared" });
  assert.ok(shared.includes("to one scale"));
});

test("pulse labels outside a zoom window are not drawn", () => {
  const seq = epi({ ...P, bw: 1500, TE: 30 }, Array.from({ length: 64 }, (_, i) => i));
  assert.ok(!diagramSvg(seq, { window: [20, 30] }).includes(">90°<"));
  assert.ok(diagramSvg(seq).includes(">90°<"));
});
