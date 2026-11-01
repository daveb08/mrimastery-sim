import test from "node:test";
import assert from "node:assert/strict";
import { scaleFonts, layout, textScale } from "./plot.js";

test("scaleFonts multiplies every font size and leaves everything else alone", () => {
  const lay = layout({ title: { text: "T", font: { size: 12 } }, xaxis: { tickfont: { size: 10 }, title: "x" } });
  const s = scaleFonts(lay, 1.3);
  assert.ok(Math.abs(s.font.size - 11 * 1.3) < 1e-12);
  assert.ok(Math.abs(s.legend.font.size - 10 * 1.3) < 1e-12);
  assert.ok(Math.abs(s.title.font.size - 12 * 1.3) < 1e-12);
  assert.ok(Math.abs(s.xaxis.tickfont.size - 13) < 1e-12);
  assert.equal(s.margin.l, 56);
  assert.equal(lay.font.size, 11); // the input is not modified
});

test("scaleFonts shares data arrays, scales trace text fonts, and is the identity at scale 1", () => {
  const x = new Float64Array([1, 2, 3]), y = [4, 5, 6];
  const traces = [{ x, y, marker: { size: 8 }, textfont: { size: [10, 20] } }];
  const s = scaleFonts(traces, 1.15);
  assert.equal(s[0].x, x); assert.equal(s[0].y, y);
  assert.equal(s[0].marker.size, 8); // marker sizes are not text
  assert.deepEqual(s[0].textfont.size, [10 * 1.15, 20 * 1.15]);
  assert.equal(scaleFonts(traces, 1), traces);
  assert.equal(textScale(), 1); // no document under Node
});
