import test from "node:test";
import assert from "node:assert/strict";
import { trStripLayout } from "./trstrip.js";

const packed = (N, C, maxSlices, slotMs) => ({
  mode: "packed", N, maxSlices, concatenations: C, slotMs,
  passes: Array.from({ length: C }, (_, k) => Array.from({ length: N }, (_, i) => i).filter((i) => i % C === k)),
});

test("N = 5, C = 1: one row of five blocks in acquisition order, slot / TR wide", () => {
  const L = trStripLayout(packed(5, 1, 21, 20), 500, "interleaved", 288);
  assert.equal(L.rows.length, 1);
  assert.equal(L.more, 0);
  assert.deepEqual(L.rows[0].blocks.map((b) => b.slice), [1, 3, 5, 2, 4]);
  L.rows[0].blocks.forEach((b, i) => {
    assert.ok(Math.abs(b.x0 - i * 0.04) < 1e-12);
    assert.ok(Math.abs(b.x1 - b.x0 - 0.04) < 1e-12);
  });
  assert.ok(Math.abs(L.rows[0].idleFrom - 0.2) < 1e-12);
});

test("sequential order keeps spatial order", () => {
  const L = trStripLayout(packed(5, 1, 21, 20), 500, "sequential", 288);
  assert.deepEqual(L.rows[0].blocks.map((b) => b.slice), [1, 2, 3, 4, 5]);
});

test("C = 6: four rows, two more passes; each pass labels its own slices", () => {
  const L = trStripLayout(packed(12, 6, 2, 20), 40, "sequential", 60);
  assert.equal(L.rows.length, 4);
  assert.equal(L.more, 2);
  assert.deepEqual(L.rows[1].blocks.map((b) => b.slice), [2, 8]);
});

test("caption format", () => {
  assert.equal(trStripLayout(packed(5, 1, 21, 20), 500, "interleaved", 288).caption,
    "5 of max 21 slices per TR · 1 concatenation · TA 4:48");
  assert.match(trStripLayout(packed(12, 6, 2, 20), 40, "sequential", 60).caption, /· 6 concatenations · TA 1:00$/);
});

test("sequential mode: N equal blocks and its own caption", () => {
  const L = trStripLayout({ mode: "sequential", N: 4, maxSlices: null, concatenations: 4, slotMs: 0, passes: [[0], [1], [2], [3]] }, 500, "interleaved", 10);
  assert.equal(L.rows.length, 1);
  assert.equal(L.rows[0].blocks.length, 4);
  assert.equal(L.rows[0].blocks[2].x0, 0.5);
  assert.equal(L.caption, "4 slices acquired one after another");
});

test("single slice and 3D give no strip", () => {
  assert.equal(trStripLayout({ mode: "single", N: 1, passes: [[0]] }, 500, "interleaved", 10), null);
  assert.equal(trStripLayout({ mode: "3d", N: 1, passes: [[0]] }, 500, "interleaved", 10), null);
});
