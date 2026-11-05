import test from "node:test";
import assert from "node:assert/strict";
import { defaultParams, SEQUENCES, computeModel } from "./physics.js";
import { protocolMode, builderName, builderParams, protocolTiming, middleSliceFactors, PROTOCOL_DEFAULTS } from "./protocol.js";
import { sliceTiming } from "../shared/sequence.js";
import { shotRows } from "../kspace/scan.js";

const mk = (seq, extra = {}) => ({ ...defaultParams(seq, "3.0T"), ...PROTOCOL_DEFAULTS, ...extra });

test("N = 1 is today", () => {
  for (const seq of SEQUENCES) {
    const p = mk(seq, { slices: 1 });
    assert.equal(protocolTiming(p).scanFactor, 1, seq);
    assert.equal(middleSliceFactors(p), null, seq);
  }
});

test("inversion sequences run single-slice", () => {
  for (const seq of ["FLAIR", "STIR", "DIR"]) {
    const p = mk(seq, { slices: 20 }), t = protocolTiming(p);
    assert.equal(t.N, 1); assert.equal(t.scanFactor, 1); assert.equal(middleSliceFactors(p), null);
  }
});

test("MPRAGE ignores slices", () => {
  const p = mk("MPRAGE", { slices: 20 }), t = protocolTiming(p);
  assert.equal(protocolMode("MPRAGE"), "3d");
  assert.equal(t.N, 1); assert.equal(t.scanFactor, 1);
});

test("bSSFP is slice by slice", () => {
  const p = mk("bSSFP", { slices: 10 }), t = protocolTiming(p);
  assert.equal(t.mode, "sequential"); assert.equal(t.scanFactor, 10); assert.equal(middleSliceFactors(p), null);
});

test("builder names", () => {
  assert.equal(builderName(mk("FSE", { ETL: 1 })), "SE");
  assert.equal(builderName(mk("FSE", { ETL: 8 })), "FSE");
  assert.equal(builderName(mk("GRE")), "GRE");
  assert.equal(builderName(mk("DWI")), "EPI");
  assert.equal(builderName(mk("EPI (single-shot)")), "EPI");
  assert.equal(builderParams(mk("GRE")).seq, "GRE");
});

test("odd matrices stay finite", () => {
  for (const p of [mk("FSE", { freqMatrix: 320, phaseMatrix: 192, slices: 12 }), mk("EPI (single-shot)", { phaseMatrix: 512, ETL: 512, slices: 12 })]) {
    const t = protocolTiming(p);
    assert.ok(Number.isFinite(t.slotMs), p.seq); assert.ok(t.maxSlices >= 1); assert.ok(t.concatenations >= 1);
  }
});

test("pages agree on representable protocols", () => {
  const p = mk("GRE", { freqMatrix: 128, phaseMatrix: 128, fovRead: 240, fovPhase: 240, BW: 260, TR: 100, slices: 20, NEX: 1, pfFraction: 1 });
  const t = protocolTiming(p);
  // as kspace/ui.js params() builds them
  const P = { seq: "GRE", nx: 128, ny: 128, fovRead: 240, fovPhase: 240, bw: 260, TE: p.TE, TR: 100, ETL: p.ETL, flip: p.FA, sliceMm: p.sliceMm,
    slices: 20, gapPct: 20, sliceOrder: "interleaved", concatenations: "auto", overflow: "passes", inversion: "none" };
  const e = sliceTiming(P, shotRows("GRE", P).rowsPerShot[0][0]);
  assert.equal(t.maxSlices, e.maxSlices); assert.equal(t.concatenations, e.concatenations);
  const explorerSec = (100 * 128 * e.concatenations) / 1000;
  assert.ok(Math.abs(explorerSec - computeModel(p, { scanFactor: t.scanFactor }).scanSec) < 1e-9);
});

test("cross-talk factors", () => {
  const p = mk("FSE", { ETL: 1, slices: 8, gapPct: 0 });
  const f = middleSliceFactors(p);
  for (const k of ["WM", "GM", "CSF", "Fat", "muscle", "lesion"]) assert.ok(Number.isFinite(f[k]), k);
  assert.ok(f.WM < 1);
  assert.equal(middleSliceFactors({ ...p, crossTalkOn: false }), null);
});

test("speed", () => {
  const lim = process.env.CI ? 150 : 50;
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const p = mk("FSE", { ETL: 16, slices: 32, gapPct: 10 * i });
    const t0 = performance.now(); middleSliceFactors(p); best = Math.min(best, performance.now() - t0);
  }
  assert.ok(best < lim, `best of 5: ${best} ms`);
  const p = mk("FSE", { ETL: 16, slices: 32, gapPct: 0 });
  const t0 = performance.now(); middleSliceFactors(p);
  assert.ok(performance.now() - t0 < 1);
});

test("EPI and DWI are timed at an EPI readout bandwidth", () => {
  const e = protocolTiming(mk("EPI (single-shot)", { slices: 20 })), d = protocolTiming(mk("DWI", { slices: 20 }));
  assert.ok(e.maxSlices > 1); assert.ok(e.slotMs < 300, `slot ${e.slotMs}`); // 256 lines at 1500 Hz/px; the brief guessed under 200 ms
  assert.ok(Math.abs(d.slotMs - e.slotMs) < 1e-9);
});
