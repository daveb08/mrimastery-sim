import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "./physics.js";

const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
const near = (a, b, rtol = 1e-11, atol = 1e-13, msg = "") =>
  assert.ok(Math.abs(a - b) <= atol + rtol * Math.abs(b), `${msg} ${a} != ${b}`);

const FN = {
  fse: P.fseSignal, gre: P.greSignal, flair: P.flairSignal, bssfp: P.bssfpSignal, dir: P.dirSignal,
  dwi: P.dwiSignal, mprage: P.mprageSignal, epi: P.epiSignal,
  csfNullTi: P.csfNullTi, ernstAngle: P.ernstAngle, bssfpOptimalFa: P.bssfpOptimalFa, dirNullTi2: P.dirNullTi2,
};

// ---- golden values: the signal equations and helpers were computed with the original Python physics; the scan-time and
// pipeline cases were re-recorded from this model after the 2026-11-16 accuracy fixes (lines in the noise, DWI time, tables) ----

test(`signal equations match Python (${golden.signals.length} cases)`, () => {
  for (const g of golden.signals) near(FN[g.fn](...g.args), g.value, 1e-11, 1e-14, `${g.fn}(${g.args})`);
});

test(`helper functions match Python (${golden.helpers.length} cases)`, () => {
  for (const g of golden.helpers) {
    const v = FN[g.fn](...g.args);
    if (g.value === null) assert.equal(v, null, `${g.fn}(${g.args})`);
    else near(v, g.value, 1e-9, 1e-9, `${g.fn}(${g.args})`);
  }
});

test("scan time matches the recorded reference for every sequence", () => {
  for (const g of golden.scanTime) near(P.calcScanTime(...g.args), g.value, 1e-12, 0, `${g.args}`);
});

test(`the Signal -> Noise -> SNR chain matches the recorded reference (${golden.pipeline.length} scenarios)`, () => {
  for (const g of golden.pipeline) {
    const m = P.computeModel({ ...g.params, seq: g.seq, field: g.field });
    const tag = `${g.seq} ${g.field}`;
    for (const t of P.TISSUE_NAMES) {
      near(m.baseSignals[t], g.baseSignals[t], 1e-11, 1e-14, `${tag} base ${t}`);
      assert.equal(m.signals[t], g.signals[t], `${tag} signal ${t} (rounded)`);
      near(m.snrs[t], g.snrs[t], 1e-11, 1e-12, `${tag} snr ${t}`);
    }
    near(m.noiseFloor, g.noiseFloor, 1e-12, 0, `${tag} noise`);
    near(m.voxelVol, g.voxelVol, 1e-12, 0, `${tag} voxel`);
    near(m.volScale, g.volScale, 1e-12, 0, `${tag} volScale`);
    near(m.scanSec, g.scanSec, 1e-12, 0, `${tag} scan time`);
  }
});

// ---- tables ----

test("tables are complete and the field-specific T1/T2 override the base table", () => {
  assert.deepEqual(P.FIELDS, ["0.064T", "0.5T", "1.0T", "1.5T", "3.0T", "4.7T", "7.0T", "9.4T", "11.7T"]);
  for (const f of P.FIELDS) {
    assert.ok(P.FIELD_SNR_SCALE[f] > 0 && P.TR_MAX_BY_FIELD[f] > 0);
    for (const t of P.TISSUE_NAMES) assert.ok(P.tissuesAt(f)[t].T1 > 0);
  }
  const wm3 = P.tissuesAt("3.0T").WM;
  assert.equal(wm3.T1, 832); assert.equal(wm3.T2, 80); assert.equal(wm3.T2s, 53);
  assert.equal(wm3.PD, 0.7); assert.equal(wm3.ADC, 0.0007); // PD and ADC come from the base table
  assert.notEqual(P.TISSUES_BASE.WM.T1, wm3.T1, "the base T1 is overwritten at runtime");
  assert.throws(() => P.tissuesAt("2.0T"));
  assert.equal(P.SEQUENCES.length, 9);
  assert.equal(Object.keys(P.PROTOCOL_PRESETS).length, 9);
});

test("noise reference and reference voxel", () => {
  near(P.REF_VOXEL_VOL, 4.39453125, 1e-12);
  near(P.NOISE_REF, Math.sqrt(200) / (4.39453125 * 200), 1e-12);
  const m = P.computeModel(P.defaultParams("FSE", "3.0T"));
  near(m.noiseFloor, P.NOISE_REF, 1e-12);
  // at the 2-D reference geometry the volume scale is 400/256 squared times 5/5.
  assert.ok(m.volScale > 1);
});

// ---- Python rounding ----

test("round-half-even matches Python's round()", () => {
  const cases = [[0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [-0.5, -0], [-1.5, -2], [2.4, 2], [2.6, 3]];
  for (const [x, want] of cases) assert.equal(P.roundHalfEven(x) + 0, want + 0, `${x}`); // +0 folds -0 into 0
  assert.equal(P.round2(0.123456), 0.12);
  assert.equal(P.round2(1.005), 1); // binary 1.00499999...: same as Python
});

// ---- model properties ----

test("signals respond to the physics: T1 weighting, T2 weighting, fat saturation, flip angle", () => {
  const base = P.defaultParams("FSE", "3.0T");
  const t1w = P.computeModel({ ...base, TR: 600, TE: 15 }).baseSignals;
  assert.ok(t1w.WM > t1w.GM && t1w.GM > t1w.CSF, "T1w: WM > GM > CSF");
  const t2w = P.computeModel({ ...base, TR: 4000, TE: 100 }).baseSignals;
  assert.ok(t2w.CSF > t2w.GM && t2w.CSF > t2w.WM, "T2w: CSF brightest");
  const on = P.computeModel({ ...base, fatSat: true }).baseSignals.Fat;
  const off = P.computeModel({ ...base, fatSat: false }).baseSignals.Fat;
  near(on, off * 0.05, 1e-12);
  assert.equal(P.computeModel({ ...base, fatSat: true }).baseSignals.WM, P.computeModel(base).baseSignals.WM);
  const g1 = P.greSignal(700, 10, 10, 832, 26, 0.7), g2 = P.greSignal(700, 10, 60, 832, 26, 0.7);
  assert.notEqual(g1, g2);
});

test("null points: FLAIR TI nulls CSF, STIR TI nulls fat, DIR TI2 nulls WM", () => {
  const t = P.tissuesAt("3.0T");
  const TR = 9000, ti = P.csfNullTi(TR, t.CSF.T1);
  assert.ok(P.flairSignal(TR, ti, 0, t.CSF.T1, t.CSF.T2, 1) < 1e-9);
  const tiFat = P.csfNullTi(3000, t.Fat.T1);
  assert.ok(P.flairSignal(3000, tiFat, 0, t.Fat.T1, t.Fat.T2, 1) < 1e-9);
  const ti2 = P.dirNullTi2(8000, 3400, t.WM.T1);
  assert.ok(ti2 > 100 && ti2 < 3400);
  assert.ok(P.dirSignal(8000, 3400, ti2, 0, t.WM.T1, t.WM.T2, 0.7) < 0.01);
  near(P.csfNullTi(1e9, 1000), 1000 * Math.LN2, 1e-9); // TR >> T1 limit
  assert.equal(P.dirNullTi2(8000, 20, 832), null, "no null inside an empty search window");
});

test("Ernst angle maximises GRE signal; bSSFP optimal FA maximises bSSFP signal", () => {
  const t = P.tissuesAt("3.0T").WM;
  const ernst = P.ernstAngle(100, t.T1);
  const at = (a) => P.greSignal(100, 0, a, t.T1, 1e9, 1);
  assert.ok(at(ernst) >= at(ernst - 5) && at(ernst) >= at(ernst + 5));
  const opt = P.bssfpOptimalFa(5, t.T1, t.T2);
  const bs = (a) => P.bssfpSignal(5, a, t.T1, t.T2, 1);
  assert.ok(bs(opt) >= bs(opt - 3) && bs(opt) >= bs(opt + 3) - 1e-3);
});

test("noise scales with BW, NEX and field, not with the frequency matrix or slice; SNR scales with voxel volume", () => {
  const base = P.defaultParams("FSE", "3.0T");
  const m0 = P.computeModel(base);
  near(P.computeModel({ ...base, BW: 800 }).noiseFloor, m0.noiseFloor * 2, 1e-12);
  near(P.computeModel({ ...base, NEX: 4 }).noiseFloor, m0.noiseFloor / 2, 1e-12);
  assert.equal(P.computeModel({ ...base, TR: 800, TE: 20, freqMatrix: 128, sliceMm: 8 }).noiseFloor, m0.noiseFloor);
  near(P.computeModel({ ...base, field: "1.5T" }).noiseFloor, m0.noiseFloor * 2, 1e-12);
  const double = P.computeModel({ ...base, sliceMm: 10 });
  near(double.volScale, m0.volScale * 2, 1e-12);
});

test("partial Fourier scales SNR by sqrt(fraction) and scan time by fraction", () => {
  const base = P.defaultParams("FSE", "3.0T");
  const full = P.computeModel(base), pf = P.computeModel({ ...base, pfFraction: 0.5 });
  near(pf.scanSec, full.scanSec * 0.5, 1e-12);
  near(pf.baseSignals.WM, full.baseSignals.WM, 1e-12);
  assert.ok(Math.abs(pf.signals.WM - round(full.signals.WM * Math.sqrt(0.5))) < 0.011);
  function round(x) { return Number(x.toFixed(2)); }
});

// ---- timing constraints and messages ----

test("GRE minimum TE is 7 ms and shorter TEs raise an error", () => {
  assert.equal(P.GRE_MIN_TE_MS, 7);
  const bad = P.computeModel({ ...P.defaultParams("GRE"), TE: 5 }).timing;
  assert.equal(bad.messages[0].level, "error");
  assert.match(bad.messages[0].text, /minimum achievable TE is 7 ms/);
  assert.deepEqual(P.computeModel({ ...P.defaultParams("GRE"), TE: 7 }).timing.messages, []);
});

test("FSE: effective echo index, ESP, minimum TR (with Python's banker's rounding)", () => {
  // TE 50 / 20 = 2.5 -> Python rounds to 2, so effIdx = 1 and ESP = 25 ms.
  const t = P.derivedTiming("FSE", { ...P.defaultParams("FSE"), TE: 50, ETL: 16, TR: 4000 });
  assert.equal(t.effIdx, 1); assert.equal(t.espMs, 25); assert.equal(t.minTR, 16 * 25);
  // TE 80 / 20 = 4 -> effIdx 3, ESP 20 ms, minimum TR = 16 * 20 = 320 ms.
  const ok = P.derivedTiming("FSE", { ...P.defaultParams("FSE"), TE: 80, ETL: 16, TR: 500 });
  assert.equal(ok.minTR, 320); assert.deepEqual(ok.messages, []);
  const short = P.derivedTiming("FSE", { ...P.defaultParams("FSE"), TE: 80, ETL: 16, TR: 300 });
  assert.match(short.messages[0].text, /TR too short: minimum TR for current ETL and TEeff is 320 ms/);
  // The echo index is clamped to the sixth echo, so a long ETL does not shorten the spacing.
  const clamped = P.derivedTiming("FSE", { ...P.defaultParams("FSE"), TE: 200, ETL: 32, TR: 8000 });
  assert.equal(clamped.effIdx, 5); near(clamped.espMs, 200 / 6, 1e-12);
});

test("FLAIR / STIR / DIR minimum TR include the inversion times", () => {
  const f = P.derivedTiming("FLAIR", { ...P.defaultParams("FLAIR"), TR: 2800, TI: 2500, TE: 90, ETL: 16 });
  assert.equal(f.minTR, 2500 + 16 * f.espMs); // ESP 22.5 -> 2860 ms
  assert.match(f.messages[0].text, /minimum TR for current TI, ETL and TEeff is/);
  const d = P.derivedTiming("DIR", { ...P.defaultParams("DIR"), TR: 4300, TI1: 3400, TI2: 800, TE: 25, ETL: 8 });
  assert.equal(d.minTR, 3400 + 800 + 8 * d.espMs);
  assert.match(d.messages[0].text, /TI1, TI2, ETL and TEeff/);
});

test("MPRAGE timing violation is a warning; readout train is 7 ms per partition", () => {
  const t = P.derivedTiming("MPRAGE", { ...P.defaultParams("MPRAGE"), TR: 2000, TI: 900, nPartitions: 176 });
  assert.equal(t.readoutTrainMs, 1232);
  assert.equal(t.minTR, 2132);
  assert.equal(t.messages[0].level, "warning");
  assert.deepEqual(P.derivedTiming("MPRAGE", { ...P.defaultParams("MPRAGE"), TR: 2300 }).messages, []);
});

test("EPI: echo index, maximum TEeff and the blocking error", () => {
  const ok = P.derivedTiming("EPI (single-shot)", { ...P.defaultParams("EPI (single-shot)"), TE: 30, phaseMatrix: 128 });
  assert.equal(ok.effIdx, 37); assert.equal(ok.maxTE, 128 * 0.8); assert.equal(ok.blocking, false);
  const bad = P.derivedTiming("EPI (single-shot)", { ...P.defaultParams("EPI (single-shot)"), TE: 150, phaseMatrix: 128 });
  assert.equal(bad.blocking, true);
  assert.match(bad.messages[0].text, /TEeff too long: maximum is 102 ms for 128 phase encodes at ESP 0.8 ms/);
});

// ---- sidebar rules: ranges, defaults, presets ----

test("TR slider ranges per sequence and field strength", () => {
  assert.deepEqual(P.trRange("FLAIR", "0.064T"), { min: 3000, max: 10000, step: 100 });
  assert.deepEqual(P.trRange("FSE", "0.064T"), { min: 500, max: 1000, step: 50 });
  assert.deepEqual(P.trRange("FSE", "3.0T"), { min: 500, max: 6000, step: 50 });
  assert.deepEqual(P.trRange("STIR", "0.064T"), { min: 1000, max: 1050, step: 50 }, "ceiling lifted above the minimum");
  assert.deepEqual(P.trRange("DIR", "1.5T"), { min: 5000, max: 5100, step: 100 });
  assert.deepEqual(P.trRange("DWI", "7.0T"), { min: 3000, max: 10000, step: 100 });
  assert.deepEqual(P.trRange("MPRAGE", "0.5T"), { min: 2000, max: 2100, step: 100 });
  assert.deepEqual(P.trRange("bSSFP", "11.7T"), { min: 3, max: 20, step: 1 });
  assert.deepEqual(P.trRange("EPI (single-shot)", "0.064T"), { min: 500, max: 1000 > 600 ? 1000 : 600, step: 100 });
  assert.deepEqual(P.trRange("EPI (single-shot)", "11.7T"), { min: 500, max: 3000, step: 100 });
  for (const f of P.FIELDS) for (const s of P.SEQUENCES) {
    const r = P.trRange(s, f);
    assert.ok(r.max > r.min, `${s} at ${f}`);
  }
});

test("defaults: every sequence yields a valid, fully-populated model", () => {
  for (const seq of P.SEQUENCES) for (const field of ["0.064T", "3.0T", "11.7T"]) {
    const p = P.defaultParams(seq, field);
    const r = P.trRange(seq, field);
    assert.ok(p.TR >= r.min && p.TR <= r.max, `${seq} ${field} TR ${p.TR}`);
    const m = P.computeModel(p);
    for (const t of P.TISSUE_NAMES) assert.ok(Number.isFinite(m.signals[t]) && Number.isFinite(m.snrs[t]), `${seq} ${t}`);
  }
  assert.equal(P.defaultParams("bSSFP").TE, 2.5);
  assert.equal(P.defaultParams("EPI (single-shot)").ETL, 256);
  assert.equal(P.defaultParams("MPRAGE").sliceMm, 1.0);
  assert.equal(P.defaultParams("FSE").nPartitions, 1);
});

test("protocol presets produce the documented parameters and respect their TR ranges", () => {
  const flair = P.defaultParams("FSE", "3.0T", "FLAIR brain");
  assert.equal(flair.seq, "FLAIR"); assert.equal(flair.TI, 2500); assert.equal(flair.TR, 9000); assert.equal(flair.fovRead, 240);
  const stir = P.defaultParams("FSE", "3.0T", "STIR fat suppression");
  assert.equal(stir.seq, "STIR"); assert.equal(stir.fatSat, false); assert.equal(stir.phaseMatrix, 224);
  const t2 = P.defaultParams("FSE", "3.0T", "T2 FSE brain");
  assert.equal(t2.freqMatrix, 320); assert.equal(t2.pfFraction, 1.0);
  const epi = P.defaultParams("FSE", "3.0T", "EPI BOLD");
  assert.equal(epi.seq, "EPI (single-shot)"); assert.equal(epi.ghostPct, 10); assert.equal(epi.ETL, 128);
  const mp = P.defaultParams("FSE", "3.0T", "MPRAGE 3D T1");
  assert.equal(mp.nPartitions, 176); assert.equal(mp.sliceMm, 1.0);
  for (const name of Object.keys(P.PROTOCOL_PRESETS)) {
    const p = P.defaultParams("FSE", "3.0T", name);
    const m = P.computeModel(p);
    assert.ok(Number.isFinite(m.scanSec) && m.scanSec > 0, name);
  }
});

test("sequence controls list the right sliders", () => {
  assert.deepEqual(P.sequenceControls("FSE").map((c) => c.key), ["TE", "ETL"]);
  assert.deepEqual(P.sequenceControls("DIR").map((c) => c.key), ["TI1", "TI2", "TE", "ETL"]);
  assert.deepEqual(P.sequenceControls("MPRAGE").map((c) => c.key), ["TI", "TE", "FA"]);
  assert.deepEqual(P.sequenceControls("DWI").map((c) => c.key), ["b", "TE"]);
});

test("optimal window/level matches the recorded values", () => {
  const cases = [
    ["FSE", "3.0T", { TR: 4000, TE: 80 }, 0.29194347506407575, 0.41312250302513337],
    ["GRE", "3.0T", { TR: 700, TE: 25, FA: 25 }, 0.0804021314826813, 0.21704960887973068],
    ["FLAIR", "3.0T", { TR: 9000, TE: 90, TI: 2500 }, 0.18764303513959152, 0.16323518957739616],
    ["DWI", "1.5T", { TR: 5000, TE: 80, b: 1000 }, 0.09990176263159838, 0.10369195459477125],
  ];
  for (const [seq, field, over, w, l] of cases) {
    const r = P.optimalWindowLevel({ ...P.defaultParams(seq, field), ...over });
    near(r.window, w, 1e-12, 0, `${seq} window`); near(r.level, l, 1e-12, 0, `${seq} level`);
  }
});

test("key metric per sequence", () => {
  const m = (seq, over = {}) => P.computeModel({ ...P.defaultParams(seq), ...over }).keyMetric;
  assert.deepEqual(m("GRE", { TR: 100 }).label, "Ernst ∠ WM");
  assert.match(m("FLAIR").value, /^\d+ ms$/);
  assert.equal(m("DWI").label, "WM ADC"); assert.equal(m("DWI").value, "0.70 ×10⁻³ mm²/s");
  assert.equal(m("EPI (single-shot)").value, "66 ms  (T2*)"); // GM T2* at 3 T
  assert.equal(m("FSE").label, "Sequence");
});

test("scan-time display splits into minutes and seconds", () => {
  const m = P.computeModel({ ...P.defaultParams("FSE"), TR: 4000, ETL: 16, phaseMatrix: 256 });
  assert.equal(m.scanSec, 64);
  assert.equal(m.scanMinutes, 1); assert.equal(m.scanSeconds, 4);
});

test("extras default to today", () => {
  for (const seq of ["FSE", "GRE", "FLAIR", "STIR", "bSSFP", "DIR", "DWI", "MPRAGE", "EPI (single-shot)"]) {
    const p = P.defaultParams(seq, "3.0T");
    assert.deepEqual(P.computeModel(p), P.computeModel(p, {}));
  }
});

test("scan factor multiplies scan time", () => {
  const p = P.defaultParams("FSE", "3.0T");
  assert.equal(P.computeModel(p, { scanFactor: 3 }).scanSec, 3 * P.computeModel(p).scanSec);
  assert.equal(P.computeModel(p, { scanFactor: 3 }).scanFactor, 3);
});

test("cross-talk scales signal not noise", () => {
  const p = P.defaultParams("FSE", "3.0T");
  const crossTalk = { WM: 0.9, GM: 0.8, CSF: 0.7, Fat: 0.6, muscle: 0.5, lesion: 0.4 };
  const a = P.computeModel(p), b = P.computeModel(p, { crossTalk });
  assert.equal(b.noiseFloor, a.noiseFloor);
  assert.deepEqual(b.crossTalk, crossTalk);
  for (const n of ["WM", "GM", "CSF", "Fat"]) {
    assert.ok(Math.abs(b.signals[n] - a.signals[n] * crossTalk[n]) <= 0.01, n);
    assert.ok(Math.abs(b.snrs[n] - a.snrs[n] * crossTalk[n]) <= 0.02 / a.noiseFloor, n);
  }
});

// ---- accuracy fixes (2026-11-16 review) ----

test("grey matter T2 is longer than white matter T2 at every field, so a longer TE raises grey/white contrast", () => {
  for (const f of P.FIELDS) assert.ok(P.tissuesAt(f).GM.T2 > P.tissuesAt(f).WM.T2, f);
  const t = P.tissuesAt("3.0T");
  assert.equal(t.WM.T2, 80); assert.equal(t.GM.T2, 110); // Wansapura 1999
  const ratio = (TE) => P.fseSignal(4000, TE, t.GM.T1, t.GM.T2, t.GM.PD) / P.fseSignal(4000, TE, t.WM.T1, t.WM.T2, t.WM.PD);
  assert.ok(ratio(100) > ratio(20) * 1.2, "T2 weighting grows with TE");
  const flair = P.computeModel(P.defaultParams("FSE", "3.0T", "FLAIR brain")).baseSignals;
  assert.ok(flair.GM > flair.WM, "FLAIR: grey matter brighter than white");
});

test("T2* of brain tissue follows Peters 2007 at 1.5, 3 and 7 T, shortens as the field rises and never exceeds T2", () => {
  const s = (f, n) => P.tissuesAt(f)[n].T2s;
  assert.deepEqual([s("1.5T", "WM"), s("3.0T", "WM"), s("7.0T", "WM")], [66, 53, 27]);
  assert.deepEqual([s("1.5T", "GM"), s("3.0T", "GM"), s("7.0T", "GM")], [84, 66, 33]);
  for (const n of ["WM", "GM"]) for (let i = 1; i < P.FIELDS.length; i++) {
    assert.ok(s(P.FIELDS[i], n) <= s(P.FIELDS[i - 1], n), `${n} T2* at ${P.FIELDS[i]}`);
  }
  for (const f of P.FIELDS) for (const n of P.TISSUE_NAMES) assert.ok(s(f, n) <= P.tissuesAt(f)[n].T2, `${n} at ${f}`);
});

test("noise falls with the square root of the phase-encode lines: doubling the phase matrix costs 1/sqrt(2) in SNR, not 1/2", () => {
  const base = P.defaultParams("FSE", "3.0T");
  const m0 = P.computeModel(base), m2 = P.computeModel({ ...base, phaseMatrix: 512 });
  near(m2.noiseFloor, m0.noiseFloor / Math.SQRT2, 1e-12);
  near(m2.voxelVol, m0.voxelVol / 2, 1e-12);
  assert.ok(Math.abs(m2.snrs.WM / m0.snrs.WM - Math.SQRT1_2) < 0.02, "SNR ratio");
  // the frequency matrix does not change the read-out time at a fixed bandwidth per pixel, so only the voxel shrinks
  const f2 = P.computeModel({ ...base, freqMatrix: 512 });
  assert.equal(f2.noiseFloor, m0.noiseFloor);
  // halving the phase FOV at a fixed matrix halves the voxel with the same number of lines
  assert.equal(P.computeModel({ ...base, fovPhase: base.fovPhase / 2 }).noiseFloor, m0.noiseFloor);
});

test("3-D MPRAGE: doubling the partitions over the same slab halves the voxel and averages sqrt(2) more", () => {
  const p = P.defaultParams("MPRAGE", "3.0T");
  const a = P.computeModel(p), b = P.computeModel({ ...p, nPartitions: 352 });
  near(b.voxelVol, a.voxelVol / 2, 1e-12);
  near(b.noiseFloor, a.noiseFloor / Math.SQRT2, 1e-12);
  near(a.scanSec, (2300 * 256 * 1) / 1000, 1e-12, 0, "scan time ignores partitions");
});

test("STIR nulls fat with its inversion time, at every field, without the fat-saturation switch", () => {
  for (const field of ["1.5T", "3.0T"]) for (const p of [P.defaultParams("STIR", field), P.defaultParams("FSE", field, "STIR fat suppression")]) {
    assert.equal(p.seq, "STIR"); assert.equal(p.fatSat, false);
    assert.ok(Math.abs(p.TI - P.csfNullTi(p.TR, P.tissuesAt(field).Fat.T1)) <= 5, `${field} TI ${p.TI}`);
    assert.ok(P.computeModel(p).baseSignals.Fat < 0.02, `${field} fat signal`);
  }
  assert.equal(P.defaultParams("STIR", "3.0T").TI, 250);
  assert.equal(P.defaultParams("STIR", "1.5T").TI, 170);
  const ti = P.sequenceControls("STIR").find((c) => c.key === "TI");
  for (const f of P.FIELDS) {
    const v = P.defaultParams("STIR", f).TI;
    assert.ok(v >= ti.min && v <= ti.max && v % ti.step === 0, `${f} TI ${v} fits its slider`);
  }
});

test("protocol presets use a head-sized field of view", () => {
  for (const name of Object.keys(P.PROTOCOL_PRESETS)) {
    if (name === "Custom") continue;
    const p = P.defaultParams("FSE", "3.0T", name);
    assert.equal(p.fovRead, 240, name); assert.equal(p.fovPhase, 240, name);
  }
});

test("DWI is single-shot: one image takes TR x NEX, whatever the matrix", () => {
  assert.equal(P.calcScanTime(5000, 128, 1, 2, "DWI"), 10);
  assert.equal(P.calcScanTime(5000, 256, 1, 2, "DWI"), 10);
  assert.equal(P.computeModel(P.defaultParams("FSE", "3.0T", "DWI b1000")).scanSec, 10);
});
