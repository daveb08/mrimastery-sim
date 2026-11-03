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

// An MNI-style atlas point (mm) in phantom coordinates, as in phantom.js.
const mni = (x, y, z) => [0.94 * x, 0.94 * y + 17, 0.94 * z + 4];

test("deep anatomy sits at its atlas landmarks, on both sides", () => {
  const p = createPhantom({ seed: 1 });
  const at = (x, y, z) => p.labelAt(...mni(x, y, z));
  for (const sx of [1, -1]) {
    assert.equal(at(sx * 8, 16, 8), CSF, "frontal horn");
    assert.equal(at(sx * 28, -40, 12), CSF, "atrium");
    assert.equal(at(sx * 35, -18, -11), CSF, "temporal horn");
    assert.equal(at(sx * 15, 15, 8), GM, "caudate head");
    assert.equal(at(sx * 26, 2, 1), GM, "putamen");
    assert.equal(at(sx * 12, -18, 6), GM, "thalamus");
    assert.equal(at(sx * 27, -22, -14), GM, "hippocampus");
    assert.equal(at(sx * 22, -3, -18), GM, "amygdala");
  }
  assert.equal(at(0, -10, 2), CSF, "third ventricle");
  assert.equal(at(0, 32, 9), WM, "genu of the corpus callosum");
  assert.equal(at(0, -5, 24), WM, "body of the corpus callosum");
  assert.equal(at(0, -40, 9), WM, "splenium");
  assert.equal(at(0, -22, -26), WM, "pons");
  assert.equal(at(0, -45, -30), CSF, "fourth ventricle");
});

test("a row through the basal ganglia crosses the capsules in order", () => {
  // from the midline outwards at the level of the thalamus: third ventricle, thalamus, internal capsule (posterior
  // limb), lentiform nucleus, external capsule, claustrum, extreme capsule, insular cortex, Sylvian CSF
  const p = createPhantom({ seed: 1 });
  const runs = [];
  for (let x = 0; x <= 39; x += 0.5) { const l = p.labelAt(...mni(x, -10, 4)); if (runs[runs.length - 1] !== l) runs.push(l); }
  assert.deepEqual(runs.slice(0, 9), [CSF, GM, WM, GM, WM, GM, WM, GM, CSF]);
});

test("the temporal lobe sits in the middle cranial fossa, the cerebellum under the tentorium", () => {
  const p = createPhantom({ seed: 1 });
  const brain = (l) => l === WM || l === GM;
  assert.ok(brain(p.labelAt(...mni(45, -10, -28))), "inferior temporal lobe");
  assert.ok(brain(p.labelAt(...mni(25, -70, -40))), "cerebellar hemisphere");
  assert.ok(brain(p.labelAt(...mni(25, -80, 10))), "occipital lobe above the tentorium");
});

test("the cortex is a thin ribbon: grey matter between sulcal CSF and white matter is about 3 mm along radial rays", () => {
  const p = createPhantom({ seed: 1 });
  const runs = [];
  for (let k = 0; k < 400; k++) {
    // directions spread over the upper brain; record grey runs that end in CSF on their outer side
    const th = Math.acos(1 - 2 * ((k + 0.5) / 400)), ph = k * 2.39996;
    const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    if (d[2] < -0.2) continue;
    let prev = -1, start = 0;
    for (let r = 20; r < 90; r += 0.25) {
      const l = p.labelAt(d[0] * r, 1 + d[1] * r, 14 + d[2] * r);
      if (l !== prev) { if (prev === GM && l === CSF) runs.push(r - start); start = r; prev = l; }
    }
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  assert.ok(runs.length > 200, `runs ${runs.length}`);
  assert.ok(median > 2.2 && median < 4.5, `median ${median} mm`); // rays cross the ribbon at an angle, so a little over 2.7
});

test("named sulci are at their landmarks for every seed", () => {
  for (const seed of [1, 9]) {
    const p = createPhantom({ seed });
    let central = 0, calcarine = 0;
    // central sulcus: CSF along an anteroposterior line on the convexity near MNI (40, -20, 58)
    for (let y = -34; y <= -6; y += 0.5) if (p.labelAt(...mni(40, y, 58)) === CSF) central++;
    // calcarine: CSF in a vertical line on the medial occipital surface near MNI (6, -80, 3)
    for (let z = -6; z <= 12; z += 0.5) if (p.labelAt(...mni(6, -80, z)) === CSF) calcarine++;
    assert.ok(central > 0, `seed ${seed}: no central sulcus`);
    assert.ok(calcarine > 0, `seed ${seed}: no calcarine sulcus`);
  }
});

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
  assert.ok(gmFraction > 0.4 && gmFraction < 0.62, `GM fraction ${gmFraction}`);
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
  assert.equal(p.labelAt(32, 76, -28), CSF);
  assert.equal(p.labelAt(-32, 76, -28), CSF);
  assert.equal(p.labelAt(32, 60, -28), FAT);
  assert.equal(p.labelAt(0, 60, -44), AIR);
  assert.equal(p.labelAt(0, 66, -56), AIR, "oral cavity");
  assert.equal(p.labelAt(0, 66, -72), MUSCLE, "tongue / floor of mouth");
});

test("neck: muscle, vertebral marrow, spinal canal with cord, and an airway", () => {
  const p = createPhantom({ seed: 1 });
  assert.equal(p.labelAt(35, 0, -104), MUSCLE);
  assert.equal(p.labelAt(0, -4, -64), FAT, "vertebral marrow");
  assert.equal(p.labelAt(0, -26, -84), WM, "cord");
  assert.equal(p.labelAt(0, -33, -84), CSF, "CSF around the cord");
  assert.equal(p.labelAt(0, 10, -104), AIR, "airway");
  assert.equal(p.labelAt(100, 0, -104), AIR, "outside the neck is air");
  assert.equal(p.labelAt(27, 56, -40), AIR, "maxillary sinus sits below the orbit");
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

test("face detail: ears, lips, open nostril, mandible with marrow in a bone shell", () => {
  const p = createPhantom({ seed: 1 });
  assert.notEqual(p.labelAt(80, 4, -30), AIR, "ear");
  assert.notEqual(p.labelAt(-80, 4, -30), AIR, "ear");
  assert.equal(p.labelAt(92, 4, -30), AIR, "beyond the ear");
  assert.equal(p.labelAt(0, 92, -64), MUSCLE, "lips");
  assert.equal(p.labelAt(0, 108, -42), AIR, "nostril opens at the front");
  assert.equal(p.labelAt(33, 28, -86), FAT, "mandible marrow");
  assert.equal(p.labelAt(-33, 28, -86), FAT, "mandible marrow, other side");
  let bone = 0;
  for (let x = 25; x <= 41; x += 2) for (let y = 20; y <= 36; y += 2) for (let z = -94; z <= -78; z += 2) {
    if (p.labelAt(x, y, z) === BONE) bone++;
  }
  assert.ok(bone > 30, `mandible cortex ${bone}`);
});

test("the neck is short: it ends in a flat cut with three vertebrae", () => {
  const p = createPhantom({ seed: 1 });
  assert.notEqual(p.labelAt(0, 0, -115), AIR);
  assert.equal(p.labelAt(0, 0, -117), AIR, "cut 6 cm below the chin");
  let marrowLevels = 0;
  for (const z of [-64, -86, -108]) if (p.labelAt(0, -4, z) === FAT) marrowLevels++;
  assert.equal(marrowLevels, 3);
});

test("the face merges with the neck at mandible level (z = -84)", () => {
  const p = createPhantom({ seed: 1 });
  // walk from the chin straight back to the spine at z = -84: tissue throughout, apart from the airway
  let air = 0;
  for (let y = 70; y >= -40; y -= 1) if (p.labelAt(0, y, -84) === AIR) air++;
  assert.ok(air > 0 && air < 20, `airway voxels ${air}`);
  assert.notEqual(p.labelAt(0, 40, -84), AIR);
  assert.notEqual(p.labelAt(30, 40, -84), AIR);
});
