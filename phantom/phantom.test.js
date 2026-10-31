import test from "node:test";
import assert from "node:assert/strict";
import { createPhantom, sliceLabels, LABELS } from "./phantom.js";

const { AIR, WM, GM, CSF, FAT, BONE, LESION } = LABELS;

function volumesMl(phantom, step = 3) {
  const counts = new Array(7).fill(0);
  for (let z = -95; z <= 95; z += step) for (let y = -105; y <= 105; y += step) for (let x = -85; x <= 85; x += step) {
    counts[phantom.labelAt(x, y, z)]++;
  }
  return counts.map((c) => (c * step ** 3) / 1000);
}

test("phantom is deterministic for a seed and differs between seeds", () => {
  const a = sliceLabels(createPhantom({ seed: 4 }), "axial", 10, 64);
  const b = sliceLabels(createPhantom({ seed: 4 }), "axial", 10, 64);
  const c = sliceLabels(createPhantom({ seed: 5 }), "axial", 10, 64);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("tissue volumes are in a plausible adult range", () => {
  const v = volumesMl(createPhantom({ seed: 1 }));
  const parenchyma = v[WM] + v[GM];
  assert.ok(parenchyma > 1000 && parenchyma < 1500, `parenchyma ${parenchyma} mL`);
  assert.ok(v[CSF] > 100 && v[CSF] < 400, `CSF ${v[CSF]} mL`);
  const gmFraction = v[GM] / parenchyma;
  assert.ok(gmFraction > 0.25 && gmFraction < 0.55, `GM fraction ${gmFraction}`);
  assert.equal(v[LESION], 0, "no lesions unless requested");
});

test("every seed stays in range", () => {
  for (const seed of [2, 7, 13]) {
    const v = volumesMl(createPhantom({ seed }), 4);
    assert.ok(v[WM] + v[GM] > 900 && v[WM] + v[GM] < 1600, `seed ${seed}: ${v[WM] + v[GM]}`);
  }
});

test("lesions replace white matter only and add volume", () => {
  const plain = createPhantom({ seed: 1 }), withLesions = createPhantom({ seed: 1, lesions: true });
  let lesionVoxels = 0;
  for (let z = -60; z <= 60; z += 2) for (let y = -80; y <= 80; y += 2) for (let x = -60; x <= 60; x += 2) {
    const a = plain.labelAt(x, y, z), b = withLesions.labelAt(x, y, z);
    if (b === LESION) { lesionVoxels++; assert.equal(a, WM, `lesion at ${x},${y},${z} replaced label ${a}`); }
    else assert.equal(a, b);
  }
  assert.ok(lesionVoxels > 50);
});

test("no sulcal depth gives a smoother brain with less CSF", () => {
  const smooth = volumesMl(createPhantom({ seed: 1, sulcalDepthMm: 0 }))[CSF];
  const folded = volumesMl(createPhantom({ seed: 1, sulcalDepthMm: 14 }))[CSF];
  assert.ok(smooth < folded, `${smooth} vs ${folded}`);
});

test("layers run from the centre outwards: brain, skull, scalp, air", () => {
  const p = createPhantom({ seed: 1 });
  const seen = [];
  for (let x = 0; x <= 90; x += 0.25) { const l = p.labelAt(x, 0, 14); if (seen[seen.length - 1] !== l) seen.push(l); }
  assert.equal(seen[seen.length - 1], AIR);
  for (const l of [BONE, FAT, CSF]) assert.ok(seen.includes(l), `missing label ${l}`);
  assert.ok(seen.indexOf(CSF) < seen.indexOf(BONE) && seen.indexOf(BONE) < seen.lastIndexOf(FAT));
  assert.equal(p.labelAt(0, 0, 200), AIR);
  assert.notEqual(p.labelAt(0, 0, 14), AIR);
});

test("slice orientation follows radiological convention", () => {
  const p = createPhantom({ seed: 1 });
  const n = 240, at = (img, right, up) => img[Math.round(n / 2 - up) * n + Math.round(n / 2 + right)];
  // Axial: screen-right is patient left (+x), screen-up is anterior (+y).
  const ax = sliceLabels(p, "axial", 14, n, 240);
  assert.equal(at(ax, 60, 0), p.labelAt(60.5, -0.5, 14));
  assert.notEqual(at(ax, 60, 0), at(ax, -60, 80), "sanity: different places differ");
  assert.equal(at(ax, 70, 0), p.labelAt(70.5, -0.5, 14));
  assert.equal(at(ax, 0, 80), p.labelAt(0.5, 79.5, 14));
  // Coronal: screen-up is superior (+z).
  const co = sliceLabels(p, "coronal", 0, n, 240);
  assert.equal(at(co, 0, 40), p.labelAt(0.5, 0, 39.5));
  // Sagittal: face to the left, so screen-right is posterior (-y).
  const sa = sliceLabels(p, "sagittal", 0, n, 240);
  assert.equal(at(sa, 50, 0), p.labelAt(0, -50.5, -0.5));
});

test("the cerebellum sits posterior and inferior to the cerebrum", () => {
  const p = createPhantom({ seed: 1 });
  let cerebellar = 0, anteriorLow = 0;
  for (let x = -30; x <= 30; x += 3) for (let z = -40; z <= -20; z += 3) {
    if (p.labelAt(x, -55, z) === WM || p.labelAt(x, -55, z) === GM) cerebellar++;
    if (p.labelAt(x, 55, z) === WM || p.labelAt(x, 55, z) === GM) anteriorLow++;
  }
  assert.ok(cerebellar > anteriorLow);
});
