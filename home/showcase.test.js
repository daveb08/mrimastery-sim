import { test } from "node:test";
import assert from "node:assert/strict";
import { WEIGHTINGS, labelLut, imageFromLabels, kspaceOf, centerOutRows, reconFromRows } from "./showcase.js";
import { LABELS } from "../phantom/phantom.js";

const lut = (id) => labelLut(WEIGHTINGS.find((w) => w.id === id));

test("T1-weighted: white matter brighter than grey matter, CSF dark, fat brightest", () => {
  const L = lut("t1");
  assert.ok(L[LABELS.WM] > L[LABELS.GM]);
  assert.ok(L[LABELS.GM] > L[LABELS.CSF]);
  assert.equal(Math.max(...L), L[LABELS.FAT]);
});

test("T2-weighted: CSF brightest, grey matter brighter than white matter", () => {
  const L = lut("t2");
  assert.equal(Math.max(...L), L[LABELS.CSF]);
  assert.ok(L[LABELS.GM] > L[LABELS.WM]);
});

test("FLAIR: CSF is nulled below white matter while lesions stay bright", () => {
  const L = lut("flair");
  assert.ok(L[LABELS.CSF] < 0.2 * L[LABELS.WM]);
  assert.ok(L[LABELS.LESION] > L[LABELS.GM]);
});

test("each lookup is scaled to a maximum of 1, and air and bone give no signal", () => {
  for (const w of WEIGHTINGS) {
    const L = labelLut(w);
    assert.ok(Math.abs(Math.max(...L) - 1) < 1e-12, w.id);
    assert.equal(L[LABELS.AIR], 0);
    assert.equal(L[LABELS.BONE], 0);
  }
});

test("imageFromLabels maps each pixel's label through the lookup", () => {
  const img = imageFromLabels(Uint8Array.from([0, 1, 3, 5]), Float32Array.from([0, 0.5, 0, 0.9, 0, 0, 0, 0]));
  [0, 0.5, 0.9, 0].forEach((v, i) => assert.ok(Math.abs(img[i] - v) < 1e-6, `pixel ${i}`));
});

test("center-out order starts at the k-space centre and visits every row once", () => {
  const rows = centerOutRows(8);
  assert.deepEqual(rows.slice(0, 3), [4, 3, 5]);
  assert.deepEqual([...rows].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("reconstructing from every k-space row gives back the image", () => {
  const n = 16, img = new Float64Array(n * n);
  for (let j = 4; j < 12; j++) for (let i = 3; i < 10; i++) img[j * n + i] = (i + j) % 3 ? 1 : 0.4;
  const k = kspaceOf(img, n);
  const back = reconFromRows(k, n, centerOutRows(n));
  for (let p = 0; p < img.length; p++) assert.ok(Math.abs(back[p] - img[p]) < 1e-9, `pixel ${p}`);
});

test("only the central rows blur the image along the phase-encode direction but keep its overall signal", () => {
  const n = 16, img = new Float64Array(n * n);
  for (let j = 4; j < 12; j++) for (let i = 4; i < 12; i++) img[j * n + i] = 1;
  const k = kspaceOf(img, n);
  const blur = reconFromRows(k, n, centerOutRows(n).slice(0, 3));
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum(blur) - sum(img)) / sum(img) < 0.15, "overall signal kept");
  assert.ok(blur[2 * n + 8] > 0.05, "signal spreads above the square (blurred along y)");
  assert.ok(blur[8 * n + 1] < 1e-9, "but not sideways: every kx is still sampled");
});
