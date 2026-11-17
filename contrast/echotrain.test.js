import test from "node:test";
import assert from "node:assert/strict";
import { echoWeights, rowWeights, blurFactor, echoTrainSummary, ECHO_TRAIN_SEQUENCES } from "./echotrain.js";
import { acquiredRows, echoTrainReadouts } from "./acquisition.js";
import { defaultParams, computeModel } from "./physics.js";
import { composeSignal, composeEchoTrain, labelT2 } from "./image.js";
import { LABELS } from "../phantom/phantom.js";

const near = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b}`);

test("echo weights: the effective echo has weight 1, earlier echoes more signal, later echoes less", () => {
  const w = echoWeights(8, 3, 20, 80);
  assert.equal(w.length, 8);
  assert.equal(w[3], 1);
  near(w[0], Math.exp((3 * 20) / 80), 1e-12); near(w[7], Math.exp((-4 * 20) / 80), 1e-12);
  for (let e = 1; e < 8; e++) assert.ok(w[e] < w[e - 1]);
  assert.deepEqual(echoWeights(1, 0, 20, 80), [1]);
  assert.equal(echoWeights(4, 9, 20, 80)[3], 1, "an effective echo beyond the train is the last echo");
});

test("row weights: every k-space line carries the weight of the echo that fills it, and ky = 0 has weight 1", () => {
  const ny = 64, etl = 8, effIdx = 2, esp = 20, T2 = 80;
  const w = rowWeights(ny, 1, etl, effIdx, esp, T2), ew = echoWeights(etl, effIdx, esp, T2);
  assert.equal(w.length, ny);
  assert.equal(w[ny / 2], 1);
  for (const r of echoTrainReadouts(acquiredRows(ny, 1), etl, effIdx)) assert.equal(w[r.row], ew[r.echo], `row ${r.row}`);
  assert.ok(rowWeights(ny, 1, 1, 0, esp, T2).every((v) => v === 1), "a single echo weights every line equally");
  const pf = rowWeights(ny, 0.75, etl, effIdx, esp, T2);
  assert.ok(pf.slice(0, 16).every((v) => v === 1), "lines never acquired are left for the zero filling");
});

test("a longer echo train blurs more at the same effective TE", () => {
  const at = (ETL) => { const p = { ...defaultParams("FSE", "3.0T"), TE: 80, ETL }; return echoTrainSummary(p, computeModel(p)); };
  const s4 = at(4), s16 = at(16), s32 = at(32);
  assert.ok(s4.blur.WM < s16.blur.WM && s16.blur.WM < s32.blur.WM);
  near(s16.blur.WM, 1.31, 0.02, "WM, T2 80 ms, 16 echoes at 10 ms, eighth echo effective");
  near(s32.blur.WM, 2.07, 0.03, "32 echoes");
  assert.equal(s16.espMs, 10); assert.equal(s16.effIdx, 7); assert.equal(s16.trainMs, 160);
});

test("blur is the energy width of the point-spread function: N x sum(w^2) / sum(w)^2, never below one pixel", () => {
  assert.equal(blurFactor(new Float64Array(64).fill(1), 64, 1), 1);
  assert.equal(blurFactor(new Float64Array(64).fill(2.5), 64, 1), 1, "a uniform scale is not blur");
  const w = rowWeights(64, 1, 16, 7, 10, 80);
  let s = 0, s2 = 0; for (const v of w) { s += v; s2 += v * v; }
  near(blurFactor(w, 64, 1), (64 * s2) / (s * s), 1e-12);
  assert.ok(blurFactor(w, 64, 1) > 1);
});

test("short-T2 tissue blurs more than CSF; a single echo does not blur; other sequences have no echo train", () => {
  const p = { ...defaultParams("FSE", "3.0T"), TE: 80, ETL: 16 }, s = echoTrainSummary(p, computeModel(p));
  assert.ok(s.blur.WM > s.blur.GM && s.blur.GM > s.blur.CSF && s.blur.CSF < 1.01);
  const one = { ...p, ETL: 1 };
  assert.equal(echoTrainSummary(one, computeModel(one)).blur.WM, 1);
  for (const seq of ["GRE", "bSSFP", "DWI", "MPRAGE", "EPI (single-shot)"]) {
    const q = defaultParams(seq, "3.0T");
    assert.equal(echoTrainSummary(q, computeModel(q)), null, seq);
  }
  assert.deepEqual(ECHO_TRAIN_SEQUENCES, ["FSE", "FLAIR", "STIR", "DIR"]);
});

// A small synthetic sampling: nx columns, ny rows, one layer of labels.
function sampling(nx, ny, labelAt) {
  const layer = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) layer[j * nx + i] = labelAt(i, j);
  return { nx, ny, groups: [[layer]] };
}

test("echo-train image: equal weights reproduce the plain image", () => {
  const nx = 8, ny = 32, s = sampling(nx, ny, (i, j) => (j > 8 && j < 20 ? LABELS.WM : LABELS.CSF));
  const lut = new Float32Array(8); lut[LABELS.WM] = 0.4; lut[LABELS.CSF] = 0.9;
  const ones = new Float64Array(ny).fill(1);
  const got = composeEchoTrain(s, lut, { [LABELS.WM]: ones, [LABELS.CSF]: ones }), want = composeSignal(s, lut);
  for (let i = 0; i < want.length; i++) near(got[i], want[i], 1e-5, `pixel ${i}`);
});

test("echo-train image: a uniform region keeps its signal, a one-pixel line keeps only the mean line weight", () => {
  const nx = 4, ny = 64, w = rowWeights(ny, 1, 16, 3, 20, 80);
  const mean = w.reduce((a, b) => a + b, 0) / ny;
  const lut = new Float32Array(8); lut[LABELS.WM] = 0.5;
  const flat = composeEchoTrain(sampling(nx, ny, () => LABELS.WM), lut, { [LABELS.WM]: w });
  for (const v of flat) near(v, 0.5, 1e-5, "bulk signal");
  const line = composeEchoTrain(sampling(nx, ny, (i, j) => (j === 32 ? LABELS.WM : LABELS.AIR)), lut, { [LABELS.WM]: w });
  near(line[32 * nx], 0.5 * mean, 1e-5, "peak of a thin line");
  assert.ok(mean < 0.7, "the line is visibly weaker");
});

test("label T2 values come from the model's tissues, with the illustrative muscle and lesion values", () => {
  const m = computeModel(defaultParams("FSE", "3.0T")), t2 = labelT2(m);
  assert.equal(t2[LABELS.WM], 80); assert.equal(t2[LABELS.GM], 110); assert.equal(t2[LABELS.CSF], 2000);
  assert.equal(t2[LABELS.FAT], m.tissues.Fat.T2); assert.equal(t2[LABELS.MUSCLE], 32); assert.equal(t2[LABELS.LESION], 140);
});
