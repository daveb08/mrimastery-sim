import test from "node:test";
import assert from "node:assert/strict";
import { fromQuery, toQuery, fromContrast, contrastNote, nearestMatrix, explorerUrl } from "./settings.js";
import { defaultParams } from "../contrast/physics.js";

test("settings round-trip through the page address", () => {
  const s = { seq: "GRE", TE: 6, TR: 40, flip: 25, ny: 128, fov: 260, bw: 400, sliceMm: 3, gMax: 80, slew: 200 };
  assert.deepEqual(fromQuery(toQuery(s)), { seq: "GRE", TE: 6, TR: 40, flip: 25, nx: 128, ny: 128, fov: 260, bw: 400, sliceMm: 3, gMax: 80, slew: 200 });
});

test("bad or out-of-range values in the address are ignored or clamped", () => {
  const s = fromQuery("seq=MRA&te=-5&tr=99999&matrix=100&gmax=999&bw=abc");
  assert.equal(s.seq, undefined);
  assert.equal(s.TE, 1);
  assert.equal(s.TR, 5000);
  assert.equal(s.ny, 128); // nearest available matrix
  assert.equal(s.gMax, undefined);
  assert.equal(s.bw, undefined);
});

test("only the settings that apply to the sequence go in the address", () => {
  const q = toQuery({ seq: "SE", TE: 20, flip: 30, ETL: 8 });
  assert.ok(!q.includes("flip") && !q.includes("etl"));
  assert.ok(toQuery({ seq: "FSE", ETL: 8 }).includes("etl=8"));
});

test("nearest matrix uses ratios, not differences", () => {
  assert.equal(nearestMatrix(192), 256); // 192/128 = 1.5 is closer in ratio to 256/192 = 1.33
  assert.equal(nearestMatrix(160), 128);
  assert.equal(nearestMatrix(512), 256);
});

test("contrast-simulator sequences map to explorer sequences, with notes for the approximations", () => {
  assert.equal(fromContrast(defaultParams("FSE", "3.0T")).seq, "FSE");
  assert.equal(fromContrast({ ...defaultParams("FSE", "3.0T"), ETL: 1 }).seq, "SE");
  assert.equal(fromContrast(defaultParams("GRE", "3.0T")).seq, "GRE");
  assert.equal(fromContrast(defaultParams("EPI (single-shot)", "3.0T")).seq, "EPI");
  for (const seq of ["FLAIR", "STIR", "DIR", "bSSFP", "MPRAGE", "DWI"]) {
    const s = fromContrast(defaultParams(seq, "3.0T"));
    assert.ok(["SE", "GRE", "FSE", "EPI"].includes(s.seq), seq);
    assert.ok(contrastNote(s.from).length > 10, seq);
  }
  assert.equal(contrastNote("GRE"), "");
});

test("the contrast settings carry over: TE, TR, flip, ETL, matrix, FOV, bandwidth, slice", () => {
  const p = { ...defaultParams("GRE", "3.0T"), TE: 12, TR: 300, FA: 20, phaseMatrix: 256, fovRead: 280, BW: 300, sliceMm: 4 };
  const s = fromContrast(p);
  assert.deepEqual([s.TE, s.TR, s.flip, s.ny, s.fov, s.bw, s.sliceMm], [12, 300, 20, 256, 280, 300, 4]);
  assert.equal(fromContrast(defaultParams("EPI (single-shot)", "3.0T")).bw, 1500); // EPI needs a fast readout
  const url = explorerUrl("../kspace/", p);
  assert.ok(url.startsWith("../kspace/?seq=GRE&te=12&tr=300&flip=20"));
  assert.deepEqual(fromQuery(url.split("?")[1]).from, "GRE");
});
