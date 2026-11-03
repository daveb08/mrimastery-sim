import test from "node:test";
import assert from "node:assert/strict";
import { createPhantom, LABELS } from "../phantom/phantom.js";
import {
  sampleSlice, composeSignal, labelSignals, addGhost, addRicianNoise, toRgba, wrapShifts, patientToScreen, screenToPatient,
  clampPos, autoWindowLevel,
} from "./image.js";
import { computeModel, defaultParams } from "./physics.js";

const phantom = createPhantom({ seed: 1 });
const spec = { nx: 64, ny: 64, fovRead: 250, fovPhase: 250, thicknessMm: 1 };

test("thin, fine sampling returns only valid labels and a brain in the middle of an axial slice", () => {
  const s = sampleSlice(phantom, "axial", 14, spec);
  assert.equal(s.groups.length, 1);
  const layer = s.groups[0][0];
  assert.ok(layer.every((l) => l <= 7));
  assert.ok(layer.includes(LABELS.WM) && layer.includes(LABELS.AIR));
});

test("signal of a noise-free image is the label signal; air and bone are zero", () => {
  const p = defaultParams("FSE", "3.0T"), m = computeModel(p);
  const lut = labelSignals(m, p);
  assert.equal(lut[LABELS.AIR], 0);
  assert.equal(lut[LABELS.BONE], 0);
  assert.ok(lut[LABELS.CSF] > lut[LABELS.GM] && lut[LABELS.GM] > 0);
  const img = composeSignal(sampleSlice(phantom, "axial", 14, { nx: 200, ny: 200, fovRead: 200, fovPhase: 200, thicknessMm: 1 }), lut);
  const allowed = Array.from(lut);
  assert.ok(img.every((v) => allowed.some((a) => Math.abs(a - v) < 1e-6))); // 1 mm pixels: no partial volume
});

test("a thick slab averages labels, creating intermediate values (partial volume)", () => {
  const p = defaultParams("FSE", "3.0T"), m = computeModel(p), lut = labelSignals(m, p);
  const thin = composeSignal(sampleSlice(phantom, "coronal", 0, { ...spec, thicknessMm: 1 }), lut);
  const thick = composeSignal(sampleSlice(phantom, "coronal", 0, { ...spec, thicknessMm: 10 }), lut);
  const distinct = (a) => new Set(Array.from(a, (v) => v.toFixed(4))).size;
  assert.ok(distinct(thick) > distinct(thin));
});

test("wrap-around only when the FOV is smaller than the object", () => {
  assert.deepEqual(wrapShifts("axial", 300), [0]);
  assert.deepEqual(wrapShifts("axial", 150), [-1, 0, 1]);
  assert.equal(wrapShifts("axial", 60).length, 5);
});

test("a small phase FOV folds signal: image gets brighter at the edges than an unfolded one", () => {
  const p = defaultParams("FSE", "3.0T"), m = computeModel(p), lut = labelSignals(m, p);
  const wide = composeSignal(sampleSlice(phantom, "axial", 14, { ...spec, fovPhase: 250 }), lut);
  const narrow = composeSignal(sampleSlice(phantom, "axial", 14, { ...spec, fovPhase: 120 }), lut);
  const row = (img, j) => img.slice(j * 64, j * 64 + 64).reduce((a, b) => a + b, 0);
  assert.ok(row(narrow, 0) > row(wide, 0)); // top edge of the narrow FOV contains folded-in anatomy
});

test("ghost adds a half-FOV-shifted copy", () => {
  const v = new Float32Array(4 * 4); v[0] = 10; // pixel (0,0)
  const g = addGhost(v, 4, 4, 0.5);
  assert.equal(g[0], 10);
  assert.equal(g[2 * 4], 5); // two rows down (ny/2)
  assert.equal(addGhost(v, 4, 4, 0), v);
});

test("Rician noise: sigma 0 leaves values, noise-only mean is sigma*sqrt(pi/2)", () => {
  const v = new Float32Array(20000);
  assert.equal(addRicianNoise(v, 0, 1), v);
  const n = addRicianNoise(v, 2, 1);
  const mean = n.reduce((a, b) => a + b, 0) / n.length;
  assert.ok(Math.abs(mean - 2 * Math.sqrt(Math.PI / 2)) < 0.05);
  assert.deepEqual(Array.from(addRicianNoise(v, 2, 1).slice(0, 5)), Array.from(n.slice(0, 5))); // deterministic
});

test("window/level maps to grey and clips", () => {
  const out = toRgba(new Float32Array([0, 0.5, 1, 2]), 1, 0.5);
  assert.deepEqual([out[0], out[4], out[8], out[12]], [0, 127.5 > 127 ? 128 : 127, 255, 255]);
});

test("screen/patient mapping round-trips and clamps", () => {
  for (const plane of ["axial", "coronal", "sagittal"]) {
    const pos = { x: 12, y: -30, z: 40 };
    const [r, u] = patientToScreen(plane, pos);
    const back = screenToPatient(plane, r, u);
    for (const [k, v] of Object.entries(back)) assert.equal(v, pos[k]);
  }
  assert.deepEqual(clampPos({ x: 500, z: -500 }), { x: 70, z: -150 });
});

test("auto window scales with voxel volume", () => {
  const p = defaultParams("FSE", "3.0T");
  const a = autoWindowLevel(p, computeModel(p));
  const b = autoWindowLevel({ ...p, freqMatrix: 128 }, computeModel({ ...p, freqMatrix: 128 }));
  assert.ok(b.window > a.window);
});
