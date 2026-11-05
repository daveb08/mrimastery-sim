import test from "node:test";
import assert from "node:assert/strict";
import { buildShots, shotRows } from "./scan.js";
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
