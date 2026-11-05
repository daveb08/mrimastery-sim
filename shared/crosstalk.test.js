import test from "node:test";
import assert from "node:assert/strict";
import { pulseProfile, crossTalk, labelFactors, TISSUE_T1 } from "./crosstalk.js";
import { GAMMA_BAR, BUILDERS, gradArea, gradEnd, RF_SHAPE } from "./sequence.js";
import { blochStep, envelope, scaleToFlip, HZ_PER_MT_M_MM } from "../bloch/bloch.js";
import { tissuesAt } from "../contrast/physics.js";
import { EXTRA_TISSUES } from "../contrast/image.js";
import { LABELS } from "../phantom/phantom.js";
import { simulateRfSlice } from "../signal/rfslice.js";

const grid = (a, b, d) => {
  const n = Math.round((b - a) / d) + 1;
  return Float64Array.from({ length: n }, (_, i) => a + i * d);
};
const abs = (re, im) => re.map((v, i) => Math.hypot(v, im[i]));
const centre = (u) => {
  let best = 0;
  for (let i = 1; i < u.length; i++) if (Math.abs(u[i]) < Math.abs(u[best])) best = i;
  return best;
};
// Full width at half maximum, crossings linearly interpolated.
function fwhm(u, y) {
  const c = centre(u), half = y[c] / 2;
  let i = c, j = c;
  while (i > 0 && y[i - 1] >= half) i--;
  while (j < y.length - 1 && y[j + 1] >= half) j++;
  const lo = u[i - 1] + ((half - y[i - 1]) / (y[i] - y[i - 1])) * (u[i] - u[i - 1]);
  const hi = u[j] + ((y[j] - half) / (y[j] - y[j + 1])) * (u[j + 1] - u[j]);
  return hi - lo;
}
// Range of the transverse phase (radians) within |u| <= halfMm, relative to the centre phase.
function phaseSpread(p, u, halfMm) {
  const c = centre(u), p0 = Math.atan2(p.mxyIm[c], p.mxyRe[c]);
  let lo = 0, hi = 0;
  for (let i = 0; i < u.length; i++) {
    if (Math.abs(u[i]) > halfMm) continue;
    let d = Math.atan2(p.mxyIm[i], p.mxyRe[i]) - p0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return hi - lo;
}

const gss = 4 / 2 / (GAMMA_BAR * 5); // TBW 4, 2 ms, 5 mm — as sequence.js computes it
// Timing limits hold locally; CI runners are slower and node --test runs files in parallel, so allow 3× there.
const SLOW = process.env.CI ? 3 : 1;

// The builders' pulse (RF_SHAPE: TBW-4 sinc under a Hann window) unless a test says otherwise.
test("excite profile: FWHM near the slice thickness and phase is flat after the rephaser (90°)", () => {
  const u = grid(-15, 15, 0.05), p = pulseProfile({ role: "excite", flipDeg: 90, durMs: 2, gss, shape: RF_SHAPE, u });
  // At 90° |Mxy| = sin(flip(z)) saturates at the top, so its half maximum lies where the local flip is 30°, outside the
  // nominal edge; the windowed pulse's wider transition band makes that visible: FWHM 5.50 mm (plain sinc 5.02). The
  // nominal-thickness check (within 3 %) is at 10°, below.
  const w = fwhm(u, abs(p.mxyRe, p.mxyIm));
  assert.ok(w > 5 && w < 5.75, `FWHM ${w}`);
  assert.ok(Math.abs(abs(p.mxyRe, p.mxyIm)[centre(u)] - 1) < 0.01);
  // A half-area rephaser leaves exactly flat phase only in the small-tip limit; at 90° the Bloch nonlinearity leaves
  // a residual that grows toward the slice edges. Windowed pulse, measured: ≈ 0.18 rad over ±0.5 mm (plain sinc
  // 0.05), ≈ 0.44 rad over ±1.5 mm (plain sinc 0.76). That is physics, so the 90° check is over the central ±0.5 mm
  // with bound 0.25 (was 0.1 for the plain sinc), and the ±1.5 mm check is at 30° (≈ 0.04 rad), below.
  assert.ok(phaseSpread(p, u, 0.5) < 0.25);
  assert.ok(phaseSpread(p, u, 1.5) < 1); // without the rephaser, or with it reversed, this is ≈ 6 rad
  assert.ok(Math.abs(p.zz[centre(u)]) < 0.01); // 90°: Mz → 0 at the centre
  assert.ok(p.b2Re.every((v) => v === 0) && p.b2Im.every((v) => v === 0));
});

// At a small flip the profile is the Fourier transform of the envelope, and its FWHM is the slice thickness: the
// windowed pulse measures 4.978 mm at 5 mm nominal (−0.45 %), so sequence.js needs no bandwidth correction.
// Cross-check with the signal page's small-tip model (signal/rfslice.js), which has no window: its FT of the plain
// TBW-4 sinc gives 5.059 mm, 1.6 % wider than the windowed Bloch profile (the plain sinc's own Bloch FWHM, 5.058 mm,
// agreed with it within 0.1 %). Tolerance 2 %, from that measurement.
test("excite FWHM at 10° is within 3 % of the thickness, and within 2 % of signal/rfslice.js (unwindowed)", () => {
  const u = grid(-15, 15, 0.01), p = pulseProfile({ role: "excite", flipDeg: 10, durMs: 2, gss, shape: RF_SHAPE, u });
  const bloch = fwhm(u, abs(p.mxyRe, p.mxyIm)), ft = simulateRfSlice("Sinc", 5, gss, 4);
  assert.ok(Math.abs(bloch - 5) < 0.03 * 5, `Bloch FWHM ${bloch.toFixed(4)} mm`);
  assert.ok(Math.abs(ft.duration * 1000 - 2) < 1e-4, `rfslice duration ${ft.duration * 1000} ms`); // the same pulse (gamma to 5 digits there)
  assert.ok(Math.abs(bloch - ft.achievedMm) < 0.02 * ft.achievedMm, `Bloch ${bloch.toFixed(4)} mm, rfslice ${ft.achievedMm.toFixed(4)} mm`);
});

test("small-tip excite: phase is flat across the central ±1.5 mm after the rephaser", () => {
  const u = grid(-15, 15, 0.05), p = pulseProfile({ role: "excite", flipDeg: 30, durMs: 2, gss, shape: RF_SHAPE, u });
  assert.ok(phaseSpread(p, u, 1.5) < 0.1); // radians (windowed 0.043, plain sinc 0.060)
  assert.ok(Math.abs(abs(p.mxyRe, p.mxyIm)[centre(u)] - Math.sin(Math.PI / 6)) < 0.01);
});

test("refocus profile: zz ≈ −1 and |b2| ≈ 1 at the centre, zz → 1 and b2 → 0 far away", () => {
  const u = grid(-15, 15, 0.05);
  const p = pulseProfile({ role: "refocus", flipDeg: 180, durMs: 2, gss, shape: RF_SHAPE, phaseDeg: 90, u });
  const c = centre(u), b2 = abs(p.b2Re, p.b2Im);
  assert.ok(Math.abs(p.zz[c] + 1) < 0.01);
  assert.ok(Math.abs(b2[c] - 1) < 0.01);
  for (const i of [0, u.length - 1]) {
    assert.ok(Math.abs(p.zz[i] - 1) < 0.01);
    assert.ok(b2[i] < 0.01);
  }
  assert.ok(p.mxyRe.every((v) => v === 0) && p.mxyIm.every((v) => v === 0));
});

test("an ideal hard 180 about x gives b2 = 1, about y gives b2 = −1", () => {
  const u = Float64Array.from([-1, 0, 1]);
  for (const [phaseDeg, want] of [[0, 1], [90, -1]]) {
    const p = pulseProfile({ role: "refocus", flipDeg: 180, durMs: 1, gss: 0, shape: "rect", phaseDeg, u });
    for (let i = 0; i < u.length; i++) {
      assert.ok(Math.abs(p.b2Re[i] - want) < 1e-9, `phase ${phaseDeg}: b2Re ${p.b2Re[i]}`);
      assert.ok(Math.abs(p.b2Im[i]) < 1e-9);
      assert.ok(Math.abs(p.zz[i] + 1) < 1e-9);
    }
  }
});

test("profiles are cached by their inputs", () => {
  const u = grid(-5, 5, 0.5);
  const a = pulseProfile({ role: "excite", flipDeg: 30, durMs: 2, gss, u });
  assert.equal(pulseProfile({ role: "excite", flipDeg: 30, durMs: 2, gss, u: grid(-5, 5, 0.5) }), a);
  assert.notEqual(pulseProfile({ role: "excite", flipDeg: 40, durMs: 2, gss, u }), a);
});

// Median of 5 fresh-key runs under 20 ms: robust to the parallel suite's load, and still well below the 30–40 ms
// this cost before the quaternion speed-up, so a regression is caught.
test("a 601-point profile computes in under 20 ms on a cold cache (median of 5)", () => {
  const u = grid(-15, 15, 0.05), times = [];
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    pulseProfile({ role: "excite", flipDeg: 90, durMs: 2, gss: gss * (1 + 1e-6 * (k + 1)), u }); // fresh cache keys
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 20 * SLOW, `median ${times[2].toFixed(1)} ms`);
});

// ---- steady-state cross-talk factors ----

const TS = TISSUE_T1();
const rowsFor = (kind, P) => (kind === "SE" || kind === "GRE" ? 32
  : kind === "FSE" ? Array.from({ length: P.ETL ?? 8 }, (_, i) => 28 + i)
  : Array.from({ length: 64 }, (_, i) => i));
const SMALL = { nx: 64, ny: 64, fovRead: 240, fovPhase: 240 };
const build = (kind, P) => {
  const prm = { ...SMALL, ...P };
  return BUILDERS[kind](prm, rowsFor(kind, prm));
};
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const wmFactors = (ct) => ct.slices.map((s) => s.factor.WM);

test("TISSUE_T1 and labelFactors map the phantom's labels", () => {
  const t1 = TISSUE_T1("3.0T"), base = tissuesAt("3.0T");
  for (const n of ["WM", "GM", "CSF", "Fat"]) assert.equal(t1[n], base[n].T1);
  assert.equal(t1.muscle, EXTRA_TISSUES.muscle.T1);
  assert.equal(t1.lesion, EXTRA_TISSUES.lesion.T1);
  const f = labelFactors({ WM: 0.9, GM: 0.8, CSF: 0.7, Fat: 0.6, muscle: 0.5, lesion: 0.4 });
  assert.ok(f instanceof Float32Array && f.length === 8);
  const want = { AIR: 1, WM: 0.9, GM: 0.8, CSF: 0.7, FAT: 0.6, BONE: 1, LESION: 0.4, MUSCLE: 0.5 };
  for (const [name, v] of Object.entries(want)) assert.ok(Math.abs(f[LABELS[name]] - v) < 1e-6, name);
});

test("crossTalk output shape: grid, slices and plot profiles", () => {
  const seq = build("SE", { slices: 3, sliceMm: 3, gapPct: 20, TR: 600 }), ct = crossTalk(seq, TS);
  const zs = seq.info.slices.map((s) => s.zMm), th = 3;
  assert.ok(ct.z instanceof Float64Array);
  assert.ok(Math.abs(ct.z[1] - ct.z[0] - th / 20) < 1e-9);
  assert.ok(Math.abs(ct.z[0] - (Math.min(...zs) - 3 * th)) < 1e-9);
  assert.ok(Math.abs(ct.z[ct.z.length - 1] - (Math.max(...zs) + 3 * th)) < 1e-6);
  assert.equal(ct.slices.length, 3);
  ct.slices.forEach((s, j) => {
    assert.equal(s.index, j);
    assert.equal(s.zMm, zs[j]);
    assert.equal(s.acq, seq.info.slices[j].acq);
    assert.ok(Number.isFinite(s.freqHz));
    assert.deepEqual(Object.keys(s.factor).sort(), Object.keys(TS).sort());
    assert.ok(s.mzBefore.WM instanceof Float64Array && s.mzBefore.WM.length === ct.z.length);
  });
  assert.equal(ct.profiles.excite.length, 3);
  assert.equal(ct.profiles.refocus.length, 3);
  const g = crossTalk(build("GRE", { slices: 3, sliceMm: 3, TR: 300, flip: 30 }), TS);
  assert.equal(g.profiles.refocus.length, 0);
});

test("isolated slices read 1", () => {
  const ct = crossTalk(build("SE", { slices: 3, sliceMm: 3, gapPct: 1000, TR: 600 }), TS);
  for (const s of ct.slices) for (const [n, v] of Object.entries(s.factor)) assert.ok(Math.abs(v - 1) < 1e-3, `${n} ${v}`);
});

test("edges lose less than the middle", () => {
  const f = wmFactors(crossTalk(build("SE", { slices: 5, gapPct: 0, sliceOrder: "sequential", TR: 500 }), TS));
  assert.ok(f[0] > f[2] && f[4] > f[2], f.join(", "));
});

test("interleaved beats sequential", () => {
  const P = { slices: 6, gapPct: 0, TR: 600 };
  const inter = mean(wmFactors(crossTalk(build("SE", { ...P, sliceOrder: "interleaved" }), TS)));
  const seqn = mean(wmFactors(crossTalk(build("SE", { ...P, sliceOrder: "sequential" }), TS)));
  assert.ok(inter > seqn, `${inter} vs ${seqn}`);
});

test("loss grows as the gap shrinks", () => {
  const m = [0, 20, 50].map((gapPct) => mean(wmFactors(crossTalk(build("SE", { slices: 5, gapPct, TR: 500 }), TS))));
  assert.ok(m[0] < m[1] && m[1] < m[2], m.join(", "));
});

// Longer T1 loses more where pulses only saturate. With the plain sinc SE was the exception: j's own 180 left Mz
// inverted near its slice edges and a neighbour's pulse pulled that toward 0, which helped more the longer T1 was
// (N = 5, gap 0, TR 500: CSF 0.9998, WM 0.9967). The windowed pulse's edges are cleaner and SE follows the rule too
// (CSF 0.968, GM 0.982, WM 0.987), so it is included.
test("longer T1 loses more (SE, FSE, and GRE at 30°)", () => {
  for (const [kind, P] of [["SE", { TR: 500 }], ["FSE", { TR: 3000 }], ["GRE", { TR: 100, flip: 30, concatenations: 1, overflow: "tr" }]]) { // GRE: TR 100 holds < 5 slices; spec section 5: keep one pass, raise TR
    const s = crossTalk(build(kind, { slices: 5, gapPct: 0, ...P }), TS).slices[2];
    assert.ok(s.factor.CSF < s.factor.GM && s.factor.GM < s.factor.WM, `${kind}: ${JSON.stringify(s.factor)}`);
  }
});

// A 90° excitation without refocusing (GRE at 90°, EPI) can still gain a little, with the windowed pulse only at wide
// gaps (40–70 %). Just outside the slice (0.85–1.2 thicknesses from its centre) the 90° profile keeps a small transverse
// component (≈ 2 % of the centre) whose phase opposes the centre's. Its own pulse barely touches Mz there, so for long
// T1 at short TR that edge carries full Mz while the centre is saturated, and it cancels part of the coherent sum. A
// neighbour 1.4–1.7 thicknesses away saturates that edge and the sum grows. Measured (N 3 and 8, 1 and 5 mm, TR
// 100–3000, all tissues): at most +7.8 % (GRE 90°, gap 60 %, TR 100, CSF), +1.3 % for EPI (gap 50 %). The plain sinc
// gave up to +385 % (GRE 90°, gap 20 %), from its side lobes. The brute-force Bloch check below reproduces the model.
test("90° excitation without refocusing can gain a little at wide gaps (GRE 90°, EPI)", () => {
  for (const [kind, P, atLeast] of [["GRE", { slices: 8, gapPct: 50, TR: 300 }, 1.02], ["EPI", { slices: 3, gapPct: 50, TR: 1000 }, 1.005]]) {
    const ct = crossTalk(build(kind, { sliceMm: 5, flip: 90, ...P }), TS);
    const all = ct.slices.flatMap((s) => Object.values(s.factor));
    for (const v of all) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1.1, `${kind} ${v}`);
    assert.ok(Math.max(...all) > atLeast, `${kind}: max ${Math.max(...all)}`); // measured 1.031 (GRE), 1.011 (EPI)
  }
});

// With the windowed pulse and gaps up to 20 %, nothing gains: measured over N 3 and 8, 1 and 5 mm, TR 100–3000 and
// all tissues, the largest factor is 1.00003 (GRE 90°, Fat, N 3, 5 mm, gap 0, TR 3000). Gains appear from gap 30 %
// (GRE 90°: +0.08 %) and peak at 50–60 % (test above).
test("gaps 0–20 %: factors never exceed 1 (to 1e-4) for SE, FSE, GRE 30° and 90°, and EPI", () => {
  for (const [kind, flip] of [["SE", 90], ["FSE", 90], ["GRE", 30], ["GRE", 90], ["EPI", 90]]) {
    for (const gapPct of [0, 20]) for (const slices of [3, 8]) for (const sliceMm of [1, 5]) for (const TR of [300, 3000]) {
      const ct = crossTalk(build(kind, { slices, sliceMm, gapPct, TR, flip }), TS);
      for (const s of ct.slices) for (const [n, v] of Object.entries(s.factor)) {
        assert.ok(v <= 1 + 1e-4, `${kind} ${flip}° N ${slices} ${sliceMm} mm gap ${gapPct} % TR ${TR}: ${n} ${v}`);
      }
    }
  }
});

test("huge stack stays finite", () => {
  const ct = crossTalk(build("FSE", { slices: 32, sliceMm: 10, gapPct: 100, ETL: 8, TR: 8000 }), TS);
  for (const s of ct.slices) for (const v of Object.values(s.factor)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, String(v));
});

test("speed: FSE ETL 16, 32 slices, six tissues in under 50 ms (median of 5, warm cache)", () => {
  const seq = build("FSE", { slices: 32, sliceMm: 5, ETL: 16, TR: 8000 });
  crossTalk(seq, TS);
  const times = [];
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    crossTalk(seq, TS);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 50 * SLOW, `median ${times[2].toFixed(1)} ms`);
});

test("speed: changing the gap reuses the cached profiles (FSE ETL 16, 32 slices, median of 5 under 50 ms)", () => {
  const P = { slices: 32, sliceMm: 5, ETL: 16, TR: 8000 };
  crossTalk(build("FSE", { ...P, gapPct: 0 }), TS);
  const times = [];
  for (const gapPct of [10, 20, 30, 40, 50]) {
    const seq = build("FSE", { ...P, gapPct });
    const t0 = performance.now();
    crossTalk(seq, TS);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 50 * SLOW, `median ${times[2].toFixed(1)} ms`);
});

// Brute-force reference: time-stepped Bloch over several TRs, independent of crossTalk's affine algebra.
// Each z cell holds ISO isochromats (one when there is no 180); a crusher is a rotation about z by +2πk/ISO for
// isochromat k, before and after every 180. At the end of each slice block (just before the next excitation) the
// block is spoiled as the spec models it: Mx and My are zeroed, and each cell's Mz is replaced by its mean over the
// isochromats. This models the spec's assumption that only Mz carries over between slice blocks. Without that step
// the crusher phase that a 180 stores in Mz (identical crushers in every block) survives into later blocks and TRs and
// refocuses as stimulated-echo pathways the spec leaves out; measured, that moves the SE ratios by up to 30 %.
// Only the slices in `play` have their pulses played. Returns, per played slice, |mean M+| at its echo in the last
// TR: after the rephaser (no refocusing pulse) or after the 180 and its second crusher.
const ISO = 16, DT = 0.02, DZ = 0.5; // DZ: reference grid (mm) for 5 mm slices; crossTalk uses thickness / 20
function bruteForce(seq, T1, play, dz, nTR = 40) {
  const th = seq.info.sliceMm, zs = seq.info.slices.map((s) => s.zMm);
  // Isochromats only matter where there are crushers; without a refocusing pulse they would be identical copies.
  const spinEcho = seq.events.some((e) => e.role === "refocus"), iso = spinEcho ? ISO : 1;
  const z0 = Math.min(...zs) - 3 * th, nz = Math.round((Math.max(...zs) + 3 * th - z0) / dz) + 1;
  const count = nz * iso, M = new Float64Array(3 * count);
  for (let i = 0; i < count; i++) M[3 * i + 2] = 1;
  const zOf = (i) => z0 + Math.floor(i / iso) * dz;
  const cphi = Float64Array.from({ length: count }, (_, i) => Math.cos((2 * Math.PI * (i % iso)) / iso));
  const sphi = Float64Array.from({ length: count }, (_, i) => Math.sin((2 * Math.PI * (i % iso)) / iso));
  const grads = seq.events.filter((e) => e.kind === "grad" && e.axis === "z");
  const rf = seq.events.filter((e) => e.kind === "rf" && play.includes(e.slice)).sort((a, b) => a.center - b.center);
  const pulses = rf.map((e) => {
    const steps = Math.round(e.duration / DT);
    const wave = scaleToFlip(envelope(e.shape ?? "sinc", steps, 4), e.duration, e.flip); // the pulse crossTalk plays
    const df = Float64Array.from({ length: count }, (_, i) => HZ_PER_MT_M_MM * e.gss * (zOf(i) - e.zMm));
    let reph = null;
    if (e.role === "excite") {
      // Net z-gradient area after the pulse ends, from the events: the lobe's ramp-down plus the slice rephaser.
      const lobe = grads.find((g) => g.label === "slice select" && Math.abs(g.start + g.rise + g.flat / 2 - e.center) < 1e-6);
      const r = grads.find((g) => g.label === "slice rephaser" && Math.abs(g.start - gradEnd(lobe)) < 1e-6);
      const area = (lobe.amp * lobe.fall) / 2 + gradArea(r); // mT/m·ms
      reph = Float64Array.from({ length: count }, (_, i) => HZ_PER_MT_M_MM * area * (zOf(i) - e.zMm)); // Hz for 1 ms
    }
    return { e, steps, wave, df, reph, ph: (e.phase * Math.PI) / 180 };
  });
  const spoil = () => {
    for (let c = 0; c < nz; c++) {
      let s = 0;
      for (let q = 0; q < iso; q++) s += M[3 * (c * iso + q) + 2];
      for (let q = 0; q < iso; q++) { const o = 3 * (c * iso + q); M[o] = 0; M[o + 1] = 0; M[o + 2] = s / iso; }
    }
  };
  const relax = (dt) => {
    const E1 = Math.exp(-dt / T1);
    for (let i = 0; i < count; i++) M[3 * i + 2] = 1 - (1 - M[3 * i + 2]) * E1;
  };
  const crush = () => {
    for (let i = 0; i < count; i++) {
      const x = M[3 * i], y = M[3 * i + 1];
      M[3 * i] = x * cphi[i] - y * sphi[i];
      M[3 * i + 1] = x * sphi[i] + y * cphi[i];
    }
  };
  const meanPlus = () => {
    let sx = 0, sy = 0;
    for (let i = 0; i < count; i++) { sx += M[3 * i]; sy += M[3 * i + 1]; }
    return Math.hypot(sx, sy) / count;
  };
  const sig = {};
  let tEnd = 0; // when the previous pulse ended, relative to the current TR's start
  for (let n = 0; n < nTR; n++) {
    for (const p of pulses) {
      relax(p.e.center - p.e.duration / 2 - tEnd);
      if (p.e.role === "excite") spoil();
      else crush();
      const h = p.e.duration / p.steps, c = Math.cos(p.ph), s = Math.sin(p.ph);
      for (let k = 0; k < p.steps; k++) blochStep(M, p.wave[k] * c, p.wave[k] * s, p.df, h, T1, Infinity);
      tEnd = p.e.center + p.e.duration / 2;
      if (p.e.role === "excite") blochStep(M, 0, 0, p.reph, 1, Infinity, Infinity);
      else crush();
      if (n === nTR - 1 && (p.e.role === "refocus" || !spinEcho)) sig[p.e.slice] = meanPlus();
    }
    tEnd -= seq.tr;
  }
  return sig;
}

// WM for SE and GRE, and CSF for GRE at 90° (long T1 at short TR), including gap 50 %, where the windowed pulse still
// raises the signal (measured 1.020–1.042; at gaps 0 and 20 % CSF loses, 0.53–0.89). With the plain sinc the CSF
// factors were 1.34–1.90 and the large cancellation in the coherent sum needed the reference on crossTalk's own grid
// (0.25 mm); with the window the reference on the 0.5 mm grid agrees within 0.03 % (measured), so all cases use DZ.
test("matches brute-force Bloch within 1 % (SE and GRE for WM; GRE 90° for CSF, also at gap 50 %)", () => {
  for (const [kind, tissue, gaps] of [["SE", "WM", [0, 20]], ["GRE", "WM", [0, 20]], ["GRE", "CSF", [0, 20, 50]]]) {
    const T1 = TS[tissue], dz = DZ;
    for (const gapPct of gaps) {
      const seq = build(kind, { slices: 3, sliceMm: 5, gapPct, TR: 200, flip: 90 });
      // enough TRs to reach the steady state: weakly tipped edges recover by about exp(−TR/T1) per TR (CSF: ~200)
      const nTR = Math.max(40, Math.ceil((8 * T1) / seq.tr));
      const ct = crossTalk(seq, { [tissue]: T1 }), all = bruteForce(seq, T1, [0, 1, 2], dz, nTR);
      for (let j = 0; j < 3; j++) {
        const alone = bruteForce(seq, T1, [j], dz, nTR)[j], ref = all[j] / alone, got = ct.slices[j].factor[tissue];
        assert.ok(Math.abs(got - ref) < 0.01 * ref, `${kind} ${tissue} gap ${gapPct}% slice ${j}: crossTalk ${got.toFixed(4)}, Bloch ${ref.toFixed(4)}`);
      }
    }
  }
});

test("per-pass cross-talk: each pass has less neighbour interaction than the single pass", () => {
  const prm = { slices: 6, gapPct: 0, TR: 20000 };
  const one = crossTalk(build("SE", { ...prm, concatenations: 1, overflow: "tr", TR: 600 }), TS);
  const base = Object.fromEntries(one.slices.map((s) => [s.index, s.factor.WM]));
  for (const pass of [0, 1]) {
    const seq = build("SE", { ...prm, TR: 600, concatenations: 2, pass });
    const ct = crossTalk(seq, TS);
    assert.equal(ct.slices.length, 3);
    for (const s of ct.slices) assert.ok(Math.abs(s.factor.WM - 1) < Math.abs(base[s.index] - 1), `pass ${pass} slice ${s.index}`);
  }
});
