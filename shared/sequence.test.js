import test from "node:test";
import assert from "node:assert/strict";
import {
  GAMMA_BAR, DEFAULTS, DEFAULT_LIMITS, gradArea, gradEnd, shortestTrap, spinEcho, gradientEcho, fastSpinEcho, epi, BUILDERS,
  withInversion, slicePositions, acquisitionOrder,
} from "./sequence.js";
import { areaUpTo, prepare, adcSamples, adcTimes } from "./ktraj.js";
import { echoTrainReadouts, acquiredRows } from "../contrast/acquisition.js";

const P = { ...DEFAULTS, nx: 64, ny: 64 };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const rowsAll = (ny) => Array.from({ length: ny }, (_, i) => i);

// One sequence per TR (or train) needed to cover the whole of k-space.
function scan(kind, params) {
  if (kind === "SE") return rowsAll(params.ny).map((r) => spinEcho(params, r));
  if (kind === "GRE") return rowsAll(params.ny).map((r) => gradientEcho(params, r));
  if (kind === "EPI") return [epi(params, rowsAll(params.ny))];
  const ro = echoTrainReadouts(acquiredRows(params.ny, 1), params.ETL, 3);
  const shots = [...new Set(ro.map((r) => r.group))];
  return shots.map((s) => fastSpinEcho(params, ro.filter((r) => r.group === s).map((r) => r.row)));
}

test("trapezoid areas integrate exactly, piece by piece", () => {
  const g = { kind: "grad", axis: "x", start: 1, rise: 0.2, flat: 1, fall: 0.2, amp: 10 };
  assert.ok(near(areaUpTo(g, 1.1), (10 * 0.1 * 0.1) / 0.4));
  assert.ok(near(areaUpTo(g, 1.7), 10 * (0.1 + 0.5)));
  assert.ok(near(areaUpTo(g, 5), gradArea(g)));
  assert.equal(areaUpTo(g, 0.5), 0);
});

test("shortest trapezoids have the requested area and respect the limits", () => {
  for (const area of [0.01, 1, 5, 20, -3]) {
    const g = shortestTrap("x", 0, area, DEFAULT_LIMITS);
    assert.ok(near(gradArea(g), area), `area ${area}`);
    assert.ok(Math.abs(g.amp) <= DEFAULT_LIMITS.gMax + 1e-9);
    assert.ok(Math.abs(g.amp) / g.rise <= DEFAULT_LIMITS.slew + 1e-6);
  }
});

for (const kind of ["SE", "GRE", "FSE", "EPI"]) {
  test(`${kind}: every ADC sample lands on the Cartesian grid, and a full scan samples each grid point once`, () => {
    const params = { ...P, TE: kind === "GRE" ? 5 : kind === "EPI" ? 30 : 20, TR: kind === "GRE" ? 50 : 3000, bw: kind === "EPI" ? 1500 : 260 };
    const seen = new Uint16Array(params.nx * params.ny);
    for (const seq of scan(kind, params)) {
      for (const s of adcSamples(seq)) {
        const c = Math.round(s.colExact), r = Math.round(s.rowExact);
        assert.ok(Math.abs(s.colExact - c) < 1e-6 && Math.abs(s.rowExact - r) < 1e-6, `${kind} off grid at t=${s.t}`);
        assert.equal(r, s.row);
        assert.ok(c >= 0 && c < params.nx);
        assert.ok(Math.abs(s.kz) < 1e-9, `${kind}: kz not rephased during the readout`);
        seen[r * params.nx + c]++;
      }
    }
    assert.ok(seen.every((v) => v === 1), `${kind}: some grid points sampled ${Math.max(...seen)} times or not at all`);
  });

  test(`${kind}: all gradients respect the scanner limits`, () => {
    const params = { ...P, TE: kind === "GRE" ? 5 : kind === "EPI" ? 30 : 20, TR: kind === "GRE" ? 50 : 3000, bw: kind === "EPI" ? 1500 : 260 };
    for (const seq of scan(kind, params).slice(0, 3)) {
      for (const g of seq.events.filter((e) => e.kind === "grad")) {
        assert.ok(Math.abs(g.amp) <= DEFAULT_LIMITS.gMax + 1e-9, `${kind} ${g.label} ${g.amp}`);
        assert.ok(Math.abs(g.amp) / g.rise <= DEFAULT_LIMITS.slew + 1e-6, `${kind} ${g.label} slew`);
      }
      assert.deepEqual(seq.errors, []);
    }
  });
}

test("the echo (k = 0) of the centre line falls exactly at TE", () => {
  for (const [build, te] of [[spinEcho, 30], [gradientEcho, 6]]) {
    const seq = build({ ...P, TE: te }, P.ny / 2);
    const k = prepare(seq).kAt(seq.events.find((e) => e.kind === "rf" && e.role === "excite").center + te);
    for (const v of k) assert.ok(Math.abs(v) < 1e-12);
  }
});

test("spin echo: the 180 sends k to -k (the readout prephaser is positive before it and its effect negative after)", () => {
  const seq = spinEcho({ ...P, TE: 40 }, P.ny / 2);
  const pr = prepare(seq);
  const t180 = seq.events.find((e) => e.kind === "rf" && e.role === "refocus").center;
  const before = pr.kAt(t180 - 1e-9), after = pr.kAt(t180 + 1e-9);
  assert.ok(before[0] > 0 && near(after[0], -before[0], 1e-6));
  // and the readout then sweeps from -kmax to +kmax: first sample at column 0
  const s = adcSamples(seq, pr);
  assert.ok(near(s[0].colExact, 0, 1e-6) && near(s[s.length - 1].colExact, P.nx - 1, 1e-6));
});

test("the readout prephaser has half the readout area (gradient echo)", () => {
  const seq = gradientEcho(P, 0);
  const pre = seq.events.find((e) => e.label === "readout prephaser");
  const read = seq.events.find((e) => e.label === "readout");
  const halfRead = read.amp * (read.rise / 2 + read.flat / 2);
  assert.ok(near(-gradArea(pre), halfRead));
});

test("EPI: each blip moves ky by exactly one line, readouts alternate, and the reversed lines still fill the grid", () => {
  const seq = epi({ ...P, bw: 1500, TE: 30 }, rowsAll(P.ny));
  const blips = seq.events.filter((e) => e.label === "blip");
  assert.equal(blips.length, P.ny - 1);
  for (const b of blips) assert.ok(near(gradArea(b) * GAMMA_BAR, 1 / P.fovPhase));
  const adcs = seq.events.filter((e) => e.kind === "adc");
  assert.deepEqual(adcs.slice(0, 4).map((a) => a.dir), [1, -1, 1, -1]);
  const t = adcTimes(adcs[1]);
  assert.ok(t[1] > t[0]); // samples are still taken forward in time while kx runs backwards
});

test("impossible requests are reported: TE too short, readout gradient too strong", () => {
  const short = spinEcho({ ...P, TE: 2 }, 0);
  assert.ok(short.errors.some((e) => e.startsWith("TE too short")));
  assert.ok(short.te > 2); // drawn at the minimum TE instead
  const strong = gradientEcho({ ...P, fovRead: 100, bw: 2000, nx: 256 }, 0);
  assert.ok(strong.errors.some((e) => e.includes("exceeds")));
  const gre = gradientEcho({ ...P, TR: 1 }, 0);
  assert.ok(gre.errors.some((e) => e.startsWith("TR too short")));
});

test("FSE: echoes are evenly spaced, the effective TE is the echo that crosses ky = 0, and 180s sit midway", () => {
  const ro = echoTrainReadouts(acquiredRows(64, 1), 8, 3);
  const rows = ro.filter((r) => r.group === 0).map((r) => r.row);
  const seq = fastSpinEcho({ ...P, ETL: 8 }, rows);
  const adcs = seq.events.filter((e) => e.kind === "adc");
  const ex = seq.events.find((e) => e.role === "excite").center;
  adcs.forEach((a, m) => assert.ok(near(a.tc - ex, seq.info.esp * (m + 1))));
  const refocus = seq.events.filter((e) => e.role === "refocus");
  refocus.forEach((r, m) => assert.ok(near(r.center - ex, seq.info.esp * (m + 0.5))));
  assert.ok(near(seq.te, seq.info.esp * 4)); // echo index 3 holds row 32 (ky = 0)
});

test("a gradient ends where it should", () => {
  assert.equal(gradEnd({ start: 1, rise: 0.1, flat: 2, fall: 0.1 }), 3.2);
});

const centres = (seq, role) => seq.events.filter((e) => e.kind === "rf" && e.role === role).map((e) => e.center);

test("inversion recovery: the 180° inversion sits exactly TI before the excitation, and TE is unchanged", () => {
  for (const kind of ["SE", "FSE"]) {
    const rows = kind === "SE" ? 32 : [0, 8, 16, 24, 32, 40, 48, 56];
    const seq = BUILDERS[kind]({ ...P, ETL: 8, TE: 80, TR: 9000, inversion: "IR", TI: 2500 }, rows);
    const [inv] = centres(seq, "invert"), [ex] = centres(seq, "excite");
    assert.deepEqual(seq.errors, []);
    assert.ok(near(ex - inv, 2500));
    const echoes = seq.events.filter((e) => e.kind === "adc").map((a) => a.tc - ex);
    const plain = BUILDERS[kind]({ ...P, ETL: 8, TE: 80, TR: 9000 }, rows);
    const ex0 = centres(plain, "excite")[0];
    assert.deepEqual(echoes.map((t) => t.toFixed(9)), plain.events.filter((e) => e.kind === "adc").map((a) => (a.tc - ex0).toFixed(9)));
  }
});

test("inversion recovery: the inversion leaves k alone, so the samples are exactly those without it", () => {
  const params = { ...P, TE: 30, TR: 3000 };
  const a = adcSamples(BUILDERS.SE({ ...params, inversion: "IR", TI: 200 }, 5)), b = adcSamples(BUILDERS.SE(params, 5));
  a.forEach((s, i) => assert.ok(near(s.colExact, b[i].colExact, 1e-9) && near(s.rowExact, b[i].rowExact, 1e-9) && Math.abs(s.kz) < 1e-9));
  // and k is reported as 0 between the inversion and the excitation (no transverse magnetisation)
  const seq = BUILDERS.SE({ ...params, inversion: "IR", TI: 200 }, 5);
  const pr = prepare(seq);
  assert.deepEqual(pr.kAt(centres(seq, "invert")[0] + 3), [0, 0, 0]);
});

test("double inversion: inversions TI1 and TI2 before the excitation", () => {
  const seq = BUILDERS.FSE({ ...P, ETL: 8, TE: 25, TR: 8000, inversion: "DIR", TI1: 3400, TI2: 800 }, [32, 24, 40, 16, 48, 8, 56, 0]);
  const inv = centres(seq, "invert"), [ex] = centres(seq, "excite");
  assert.equal(inv.length, 2);
  assert.ok(near(ex - inv[0], 3400) && near(ex - inv[1], 800));
  assert.deepEqual(seq.errors, []);
});

test("inversion timing that cannot be played is reported and drawn at the nearest possible value", () => {
  const short = BUILDERS.SE({ ...P, TE: 30, TR: 3000, inversion: "IR", TI: 1 }, 0);
  assert.ok(short.errors.some((e) => e.startsWith("TI too short")));
  assert.ok(near(centres(short, "excite")[0] - centres(short, "invert")[0], short.info.minTI));
  const tr = BUILDERS.SE({ ...P, TE: 30, TR: 1000, inversion: "IR", TI: 2500 }, 0);
  assert.ok(tr.errors.some((e) => e.startsWith("TR too short")) && tr.tr > 2500);
  const dir = BUILDERS.FSE({ ...P, ETL: 4, TE: 25, TR: 8000, inversion: "DIR", TI1: 500, TI2: 500 }, [32, 16, 48, 0]);
  assert.ok(dir.errors.some((e) => e.startsWith("TI1 must be")));
  for (const g of dir.events.filter((e) => e.kind === "grad")) assert.ok(Math.abs(g.amp) <= DEFAULT_LIMITS.gMax + 1e-9);
});

test("spin echo: the phase encode before the 180 is applied with the opposite sign, so line 0 still reaches -ky max", () => {
  const seq = spinEcho({ ...P, TE: 30 }, 0);
  const pe = seq.events.find((e) => e.label === "phase encode");
  assert.ok(gradArea(pe) > 0); // positive lobe, inverted to -32 dky by the 180
  assert.ok(near(adcSamples(seq)[0].rowExact, 0, 1e-6));
});

test("multiSlice with one slice returns the unwrapped builder's sequence unchanged", () => {
  for (const k of ["SE", "GRE"]) {
    const plain = k === "SE" ? withInversion(spinEcho)(P, 32) : withInversion(gradientEcho)(P, 32);
    assert.deepEqual(BUILDERS[k]({ ...P, slices: 1 }, 32), plain);
  }
});
test("slice positions are centred, spaced by thickness x (1 + gap)", () => {
  assert.deepEqual(slicePositions(3, 5, 20, 14), [8, 14, 20]);
});
test("interleaved order plays odd slices first, starting with slice 1", () => {
  assert.deepEqual(acquisitionOrder(5, "interleaved"), [0, 2, 4, 1, 3]);
  assert.deepEqual(acquisitionOrder(4, "interleaved"), [0, 2, 1, 3]);
  assert.deepEqual(acquisitionOrder(3, "sequential"), [0, 1, 2]);
});
test("N slice blocks back to back, each with its own offset and the same k-space path", () => {
  const one = BUILDERS.SE({ ...P, TR: 3000 }, 32), seq = BUILDERS.SE({ ...P, TR: 3000, slices: 3 }, 32);
  const ex = seq.events.filter((e) => e.kind === "rf" && e.role === "excite");
  assert.equal(ex.length, 3);
  // ex[a] is acquisition a: interleaved 0, 2, 1
  assert.deepEqual(ex.map((e) => e.slice), [0, 2, 1]);
  ex.forEach((e, a) => assert.ok(near(e.center, ex[0].center + a * seq.info.block)));
  for (const e of ex) assert.ok(near(e.freqHz, GAMMA_BAR * 1000 * e.gss * e.zMm));
  // every block samples exactly the single-slice k positions
  const s1 = adcSamples(one), s3 = adcSamples(seq);
  for (let j = 0; j < 3; j++) {
    const mine = s3.filter((s) => s.slice === j);
    assert.equal(mine.length, s1.length);
    mine.forEach((s, i) => { assert.ok(near(s.colExact, s1[i].colExact, 1e-6)); assert.ok(near(s.rowExact, s1[i].rowExact, 1e-6)); });
  }
});
test("too many slices raises TR to N x block and names the limit; requested TR is kept in info", () => {
  const probe = BUILDERS.GRE({ ...P, TR: 50, slices: 2 }, 32);
  const n = probe.info.maxSlices + 3, seq = BUILDERS.GRE({ ...P, TR: 50, slices: n }, 32);
  assert.ok(near(seq.tr, n * seq.info.block));
  assert.equal(seq.info.requestedTR, 50);
  assert.match(seq.errors.join(" "), new RegExp(`TR too short for ${n} slices.*at most ${probe.info.maxSlices} slices`));
});
test("multi-slice forces the inversion off", () => {
  const seq = BUILDERS.FSE({ ...P, ETL: 8, TR: 9000, inversion: "IR", slices: 3 }, rowsAll(8));
  assert.ok(!seq.events.some((e) => e.kind === "rf" && e.role === "invert"));
});

const MS_CASES = [
  ["SE", 32], ["GRE", 32], ["FSE", rowsAll(8)], ["EPI", rowsAll(64)],
];
test("every RF pulse of every builder sits on a non-zero slice-select lobe at its slice's frequency", () => {
  for (const [k, rows] of MS_CASES) {
    const N = 3, seq = BUILDERS[k]({ ...P, ETL: 8, TR: 20000, slices: N }, rows);
    const zs = slicePositions(N, P.sliceMm, P.gapPct, 14);
    const rfs = seq.events.filter((e) => e.kind === "rf");
    assert.ok(rfs.length >= N, k);
    for (const e of rfs) {
      const lobe = seq.events.find((g) => g.kind === "grad" && g.axis === "z" && g.label === "slice select"
        && e.center >= g.start + g.rise - 1e-9 && e.center <= g.start + g.rise + g.flat + 1e-9);
      assert.ok(lobe, `${k} ${e.role} has a slice-select lobe`);
      assert.notEqual(e.gss, 0, k);
      assert.equal(e.gss, lobe.amp, k);
      assert.equal(e.zMm, zs[e.slice], k);
      assert.ok(near(e.freqHz, GAMMA_BAR * 1000 * lobe.amp * zs[e.slice]), k);
    }
  }
});
test("every builder samples the single-slice k positions in each of 3 slice blocks", () => {
  for (const [k, rows] of MS_CASES) {
    const prm = { ...P, ETL: 8, TR: 20000 };
    const s1 = adcSamples(BUILDERS[k](prm, rows)), s3 = adcSamples(BUILDERS[k]({ ...prm, slices: 3 }, rows));
    for (let j = 0; j < 3; j++) {
      const mine = s3.filter((s) => s.slice === j);
      assert.equal(mine.length, s1.length, k);
      mine.forEach((s, i) => { assert.ok(near(s.colExact, s1[i].colExact, 1e-6), k); assert.ok(near(s.rowExact, s1[i].rowExact, 1e-6), k); });
    }
  }
});
