import test from "node:test";
import assert from "node:assert/strict";
import { buildShots, shotRows, stackCrossTalk, trReadout } from "./scan.js";
import { crossTalk, TISSUE_T1 } from "../shared/crosstalk.js";
import { initialState, explorerParams, explorerUrl } from "./settings.js";
import { protocolTiming, PROTOCOL_DEFAULTS } from "../contrast/protocol.js";
import { defaultParams, computeModel } from "../contrast/physics.js";
import { BUILDERS, DEFAULTS } from "../shared/sequence.js";
import { prepare, adcSamples } from "../shared/ktraj.js";

const P0 = { ...DEFAULTS, fovRead: 240, fovPhase: 240 };
const params = (name, extra) => {
  const base = { SE: { TE: 20, TR: 500 }, GRE: { TE: 5, TR: 50, flip: 30 }, FSE: { TE: 80, TR: 3000, ETL: 8 }, EPI: { TE: 40, TR: 3000, bw: 1500 } }[name];
  return { ...P0, ...base, nx: 32, ny: 32, ...extra };
};
const build = (name, P, rows) => (name === "SE" || name === "GRE" ? BUILDERS[name](P, rows[0]) : BUILDERS[name](P, rows));
// the explorer's per-shot samples, straight from the full sequence (what it built before)
const direct = (seq) => adcSamples(seq, prepare(seq)).map((s) => ({ t: s.t, col: Math.round(s.colExact), row: Math.round(s.rowExact), slice: s.slice ?? 0 }));

test("one slice: every shot is the full sequence, built exactly as before", () => {
  for (const name of ["SE", "GRE", "FSE", "EPI"]) {
    const P = params(name), s = buildShots(name, P), { rowsPerShot } = shotRows(name, P);
    assert.equal(s.N, 1);
    assert.equal(s.shots.length, rowsPerShot.length);
    rowsPerShot.forEach((rows, i) => {
      const seq = build(name, P, rows);
      assert.deepEqual(s.shots[i].seq, seq, `${name} shot ${i}`);
      assert.deepEqual(s.shots[i].samples, direct(seq));
      assert.equal(s.full(i), s.shots[i]);
    });
    assert.deepEqual(s.first, build(name, P, rowsPerShot[0]));
    assert.equal(s.offset(0), 0);
  }
});

test("several slices: full shots match the N-block sequence, and each slice's samples are the single-slice ones offset in time", () => {
  for (const name of ["SE", "GRE", "FSE", "EPI"]) {
    for (const sliceOrder of ["sequential", "interleaved"]) {
      const P = params(name, { slices: 5, gapPct: 20, sliceOrder }), s = buildShots(name, P), { rowsPerShot } = shotRows(name, P);
      assert.equal(s.N, 5);
      for (const i of [0, rowsPerShot.length - 1]) {
        const seq = build(name, P, rowsPerShot[i]), want = direct(seq), got = s.full(i);
        assert.deepEqual(got.seq, seq);
        assert.equal(got.samples.length, want.length);
        got.samples.forEach((p, k) => {
          const w = want[k];
          assert.ok(p.row === w.row && p.col === w.col && p.slice === w.slice && Math.abs(p.t - w.t) < 1e-9, `${name} ${sliceOrder} shot ${i} sample ${k}`);
        });
        for (let j = 0; j < 5; j++) {
          const mine = want.filter((w) => w.slice === j);
          assert.equal(mine.length, s.shots[i].samples.length);
          mine.forEach((w, k) => {
            const p = s.shots[i].samples[k];
            assert.ok(p.row === w.row && p.col === w.col && Math.abs(p.t + s.offset(j) - w.t) < 1e-9, `${name} slice ${j} sample ${k}`);
          });
        }
      }
      assert.equal(s.full(0).seq, s.first);
    }
  }
});

// Building the scan runs on every slider tick; with 32 slices it used to take about a second (GRE, matrix 128).
const SLOW = process.env.CI ? 3 : 1;
test("speed: GRE, matrix 128, 32 slices builds in under 60 ms (median of 5)", () => {
  const P = params("GRE", { nx: 128, ny: 128, slices: 32, TR: 300 });
  buildShots("GRE", P).full(0);
  const times = [];
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    buildShots("GRE", P).full(0);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 60 * SLOW, `median ${times[2].toFixed(1)} ms`);
});

// ---- concatenations: the explorer plays the pass that holds the selected slice ----
const excitations = (seq) => seq.events.filter((e) => e.kind === "rf" && e.role === "excite");

test("N = 5, C = 2, selected slice in pass 1: the first sequence plays that pass's 2 slices", () => {
  const P = params("GRE", { slices: 5, concatenations: 2, overflow: "passes", TR: 500 });
  const s = buildShots("GRE", P, 3); // slice 3 is in pass 1 (slices 1 and 3)
  assert.deepEqual([s.N, s.C, s.pass], [5, 2, 1]);
  assert.equal(excitations(s.first).length, 2);
  assert.deepEqual(excitations(s.first).map((e) => e.slice).sort(), [1, 3]);
  // offsets are looked up by the slice's full-stack index, and match the full shot's samples
  const want = direct(s.first);
  for (const j of [1, 3]) {
    const mine = want.filter((w) => w.slice === j);
    assert.equal(mine.length, s.shots[0].samples.length);
    mine.forEach((w, k) => assert.ok(Math.abs(s.shots[0].samples[k].t + s.offset(j) - w.t) < 1e-9, `slice ${j} sample ${k}`));
  }
  assert.equal(s.offset(0), null); // not in this pass
  assert.equal(s.scanMs, s.first.tr * s.shots.length * 2);
  assert.equal(buildShots("GRE", P, 0).pass, 0);
  assert.equal(buildShots("GRE", P).pass, 0);
});

test("stack cross-talk: one crossTalk per pass, merged by full-stack index", () => {
  const P = params("GRE", { slices: 5, concatenations: 2, overflow: "passes", TR: 500, gapPct: 0 });
  const xt = stackCrossTalk("GRE", P, TISSUE_T1());
  assert.equal(xt.slices.length, 5);
  assert.equal(xt.passes.length, 2);
  xt.slices.forEach((s, j) => { assert.equal(s.index, j); assert.equal(s.pass, j % 2); });
  for (let k = 0; k < 2; k++) {
    const seq = BUILDERS.GRE({ ...P, pass: k }, shotRows("GRE", P).rowsPerShot[0][0]), own = crossTalk(seq, TISSUE_T1());
    for (const s of own.slices) assert.deepEqual(xt.slices[s.index].factor, s.factor);
    assert.deepEqual(xt.passes[k].slices.map((s) => s.index), own.slices.map((s) => s.index));
  }
  // one pass is the plain crossTalk of the sequence
  const one = params("GRE", { slices: 3, TR: 500, gapPct: 0 });
  const merged = stackCrossTalk("GRE", one, TISSUE_T1()), direct1 = crossTalk(buildShots("GRE", one).first, TISSUE_T1());
  assert.deepEqual(merged.slices.map((s) => s.factor), direct1.slices.map((s) => s.factor));
  assert.equal(stackCrossTalk("GRE", params("GRE"), TISSUE_T1()), null);
});

// The two pages agree on a protocol the explorer can represent exactly (square 128 matrix, FOV 240, BW 260, NEX 1,
// full sampling, no inversion): the explorer opened from the contrast page's link, with its real parameters.
test("contrast page and explorer agree: max slices, concatenations and scan time", () => {
  const p = { ...defaultParams("GRE", "3.0T"), ...PROTOCOL_DEFAULTS, freqMatrix: 128, phaseMatrix: 128, fovRead: 240, fovPhase: 240,
    BW: 260, NEX: 1, pfFraction: 1, TR: 500, TE: 100, slices: 20 };
  const timing = protocolTiming(p);
  assert.ok(timing.concatenations > 1, "needs more than one pass");
  const url = explorerUrl("../kspace/", p, timing), state = initialState(url.slice(url.indexOf("?"))); // as the explorer opens it
  const P = explorerParams(state), s = buildShots(state.seq, P, state.sel);
  assert.equal(s.N, 20);
  assert.equal(s.first.info.maxSlices, timing.maxSlices);
  assert.equal(s.C, timing.concatenations);
  assert.equal(s.first.tr, 500);
  const explorerSec = s.scanMs / 1000, contrastSec = computeModel(p, { scanFactor: timing.scanFactor }).scanSec;
  assert.ok(Math.abs(explorerSec - contrastSec) < 1e-9, `${explorerSec} s vs ${contrastSec} s`);
  assert.deepEqual([timing.maxSlices, timing.concatenations, contrastSec], [4, 5, 320]); // 4 slices per TR, 5 passes, 500 ms x 128 x 5
});

test("each shot records the rows it plays", () => {
  const s = buildShots("SE", explorerParams(initialState("?seq=SE&matrix=32")));
  assert.deepEqual(s.shots.map((x) => x.rows), Array.from({ length: 32 }, (_, i) => [i]));
  const f = buildShots("FSE", explorerParams(initialState("?seq=FSE&matrix=32&etl=4")));
  assert.deepEqual(f.shots.flatMap((x) => x.rows).sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i));
  assert.deepEqual(f.full(1).rows, f.shots[1].rows);
  const m = buildShots("SE", explorerParams(initialState("?seq=SE&matrix=32&slices=3")));
  assert.deepEqual(m.full(5).rows, [5]);
});

test("TR read-out names the line, and flags the centre", () => {
  assert.equal(trReadout("SE", [64], 64, 128, 128), "TR 65 of 128 · line 64 (centre)");
  assert.equal(trReadout("GRE", [3], 3, 128, 128), "TR 4 of 128 · line 3");
  assert.equal(trReadout("FSE", [2, 18, 34, 50], 2, 16, 64), "TR 3 of 16");
  assert.equal(trReadout("FSE", [8, 24, 32, 40], 0, 16, 64), "TR 1 of 16 · holds the centre line");
});
