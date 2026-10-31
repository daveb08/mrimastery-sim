import test from "node:test";
import assert from "node:assert/strict";
import { createPhantom, sliceLabels, LABELS } from "./phantom.js";

const { AIR, WM, GM, CSF, FAT, BONE, LESION, MUSCLE } = LABELS;

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
  assert.ok(parenchyma > 800 && parenchyma < 1500, `parenchyma ${parenchyma} mL`);
  assert.ok(v[CSF] > 100 && v[CSF] < 400, `CSF ${v[CSF]} mL`);
  const gmFraction = v[GM] / parenchyma;
  assert.ok(gmFraction > 0.25 && gmFraction < 0.55, `GM fraction ${gmFraction}`);
  assert.equal(v[LESION], 0, "no lesions unless requested");
});

test("every seed stays in range", () => {
  for (const seed of [2, 7, 13]) {
    const v = volumesMl(createPhantom({ seed }), 4);
    assert.ok(v[WM] + v[GM] > 800 && v[WM] + v[GM] < 1600, `seed ${seed}: ${v[WM] + v[GM]}`);
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

test("face: eyes are vitreous inside orbital fat, with an open nasal passage", () => {
  const p = createPhantom({ seed: 1 });
  assert.equal(p.labelAt(32, 76, -4), CSF);
  assert.equal(p.labelAt(-32, 76, -4), CSF);
  assert.equal(p.labelAt(32, 60, -4), FAT);
  assert.equal(p.labelAt(0, 60, -20), AIR);
  assert.equal(p.labelAt(0, 66, -32), AIR, "oral cavity");
  assert.equal(p.labelAt(0, 66, -48), MUSCLE, "tongue / floor of mouth");
});

test("neck: muscle, vertebral marrow, spinal canal with cord, and an airway", () => {
  const p = createPhantom({ seed: 1 });
  assert.equal(p.labelAt(35, 0, -80), MUSCLE);
  assert.equal(p.labelAt(0, -4, -40), FAT, "vertebral marrow");
  assert.equal(p.labelAt(0, -26, -60), WM, "cord");
  assert.equal(p.labelAt(0, -33, -60), CSF, "CSF around the cord");
  assert.equal(p.labelAt(0, 10, -80), AIR, "airway");
  assert.equal(p.labelAt(100, 0, -80), AIR, "outside the neck is air");
  assert.equal(p.labelAt(27, 56, -16), AIR, "maxillary sinus sits below the orbit");
});

test("the skull base separates the brain from the face", () => {
  const p = createPhantom({ seed: 1 });
  const column = [];
  for (let z = 40; z >= -40; z -= 0.5) { const l = p.labelAt(10, 60, z); if (column[column.length - 1] !== l) column.push(l); }
  // brain tissue above, then bone/marrow of the base, then soft tissue below
  const firstBone = column.indexOf(BONE);
  assert.ok(firstBone > 0 && column.slice(0, firstBone).some((l) => l === WM || l === GM || l === CSF));
  assert.ok(column.slice(firstBone).includes(MUSCLE) || column.slice(firstBone).includes(AIR));
});

test("interhemispheric fissure is CSF above the corpus callosum and tissue below it", () => {
  const p = createPhantom({ seed: 1 });
  let csfAbove = 0, csfBelow = 0;
  for (let y = -30; y <= 30; y += 2) for (let x = -1.6; x <= 1.6; x += 0.4) {
    if (p.labelAt(x, y, 50) === CSF) csfAbove++;
    if (p.labelAt(x, y, 17) === CSF) csfBelow++;
  }
  assert.ok(csfAbove > 20, `above ${csfAbove}`);
  assert.ok(csfBelow < csfAbove / 2, `below ${csfBelow}`);
});

test("temporal lobes hold brain tissue lateral and inferior to the cerebrum", () => {
  const p = createPhantom({ seed: 1 });
  let tissue = 0;
  for (let y = -10; y <= 20; y += 3) for (const sx of [-1, 1]) for (let z = -18; z <= -6; z += 3) {
    const l = p.labelAt(sx * 47, y, z); if (l === WM || l === GM) tissue++;
  }
  assert.ok(tissue > 20, `tissue ${tissue}`);
});
