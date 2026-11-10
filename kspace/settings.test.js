import test from "node:test";
import assert from "node:assert/strict";
import { fromQuery, toQuery, fromContrast, contrastNote, nearestMatrix, explorerUrl, clampSel, initialState, explorerParams } from "./settings.js";
import { defaultParams } from "../contrast/physics.js";
import { protocolTiming, PROTOCOL_DEFAULTS } from "../contrast/protocol.js";

test("settings round-trip through the page address", () => {
  const s = { seq: "GRE", TE: 6, TR: 40, flip: 25, ny: 128, fov: 260, bw: 400, sliceMm: 3, gMax: 80, slew: 200 };
  assert.deepEqual(fromQuery(toQuery(s)), { seq: "GRE", TE: 6, TR: 40, flip: 25, nx: 128, ny: 128, fov: 260, bw: 400, sliceMm: 3, gMax: 80, slew: 200 });
});

test("bad or out-of-range values in the address are ignored or clamped", () => {
  const s = fromQuery("seq=MRA&te=-5&tr=99999&matrix=100&gmax=999&bw=abc&inv=TRIPLE");
  assert.equal(s.seq, undefined);
  assert.equal(s.TE, 1);
  assert.equal(s.TR, 12000);
  assert.equal(s.inversion, undefined);
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
  for (const seq of ["bSSFP", "MPRAGE", "DWI"]) {
    const s = fromContrast(defaultParams(seq, "3.0T"));
    assert.ok(["SE", "GRE", "FSE", "EPI"].includes(s.seq), seq);
    assert.ok(contrastNote(s.from).length > 10, seq);
  }
  assert.equal(contrastNote("GRE"), "");
});

test("FLAIR, STIR and DIR carry their inversion times over, with a TR range wide enough for them", () => {
  const flair = fromContrast(defaultParams("FLAIR", "3.0T"));
  assert.deepEqual([flair.seq, flair.inversion, flair.TI, flair.TR], ["FSE", "IR", 2500, 9000]);
  assert.equal(fromContrast(defaultParams("STIR", "3.0T")).TI, 210);
  const dir = fromContrast(defaultParams("DIR", "3.0T"));
  assert.deepEqual([dir.inversion, dir.TI1, dir.TI2, dir.TR], ["DIR", 3400, 800, defaultParams("DIR", "3.0T").TR]);
  for (const seq of ["FLAIR", "STIR", "DIR"]) assert.equal(contrastNote(seq), "");
  // through the address and back
  const back = fromQuery(toQuery(dir));
  assert.deepEqual([back.inversion, back.TI1, back.TI2, back.TI], ["DIR", 3400, 800, undefined]);
  assert.equal(fromQuery("tr=11000").TR, 11000);
  // inversion settings are dropped where they do not apply
  assert.ok(!toQuery({ seq: "GRE", inversion: "IR", TI: 500 }).includes("ti"));
  assert.ok(!toQuery({ seq: "FSE", inversion: "none", TI: 500 }).includes("ti"));
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

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

test("multi-slice settings round-trip and vanish when there is one slice", () => {
  const s = { seq: "SE", slices: 7, gapPct: 30, sliceOrder: "sequential", sel: 2 };
  assert.deepEqual(pick(fromQuery(`?${toQuery(s)}`), ["slices", "gapPct", "sliceOrder", "sel"]), pick(s, ["slices", "gapPct", "sliceOrder", "sel"]));
  assert.equal(toQuery({ seq: "SE", slices: 1, gapPct: 30, sliceOrder: "sequential", sel: 0 }), "seq=SE");
  assert.equal(fromQuery("?slices=99").slices, 32);
});

test("clampSel", () => {
  assert.equal(clampSel(7, 5), 2);
  assert.equal(clampSel(undefined, 4), 1);
  assert.equal(clampSel(3, 5), 3);
});

test("conc round-trips, is absent at N = 1, and takes any integer from the address", () => {
  for (const conc of ["auto", 1, 3]) assert.equal(fromQuery(`?${toQuery({ seq: "GRE", slices: 6, conc })}`).conc, conc);
  assert.ok(!toQuery({ seq: "GRE", slices: 1, conc: 2 }).includes("conc"));
  assert.equal(fromQuery("?conc=7").conc, 7);
  assert.equal(fromQuery("?conc=0").conc, undefined);
  assert.equal(fromQuery("?conc=two").conc, undefined);
});

test("fromContrast carries the slice settings and the resolved concatenations of a packed protocol", () => {
  const p = { ...defaultParams("GRE", "3.0T"), ...PROTOCOL_DEFAULTS, freqMatrix: 128, phaseMatrix: 128, fovRead: 240, fovPhase: 240,
    BW: 260, TR: 500, TE: 100, slices: 20, gapPct: 30, sliceOrder: "sequential" };
  const timing = protocolTiming(p);
  assert.ok(timing.concatenations > 1);
  const s = fromContrast(p, timing);
  assert.deepEqual([s.slices, s.gapPct, s.sliceOrder, s.conc, s.sel], [20, 30, "sequential", timing.concatenations, 9]);
  const back = fromQuery(explorerUrl("../kspace/", p, timing).split("?")[1]);
  assert.deepEqual([back.slices, back.conc, back.sel], [20, timing.concatenations, 9]);
  // one slice, or no timing, or an inversion protocol: one slice as before
  assert.equal(fromContrast(p).slices, undefined);
  assert.equal(fromContrast({ ...p, slices: 1 }, protocolTiming({ ...p, slices: 1 })).slices, undefined);
  const flair = { ...defaultParams("FLAIR", "3.0T"), ...PROTOCOL_DEFAULTS, slices: 20 };
  assert.equal(fromContrast(flair, protocolTiming(flair)).slices, undefined);
});

test("explorerParams: concatenation 1 raises TR, anything else makes passes", () => {
  const st = initialState("?seq=GRE&slices=6&conc=1");
  assert.deepEqual([explorerParams(st).concatenations, explorerParams(st).overflow], [1, "tr"]);
  const auto = explorerParams(initialState("?seq=GRE&slices=6"));
  assert.deepEqual([auto.concatenations, auto.overflow], ["auto", "passes"]);
  assert.deepEqual([explorerParams(initialState("?seq=GRE&slices=6&conc=2")).overflow], ["passes"]);
});

test("fromQuery reads phantom=brainweb and ignores other values", () => {
  assert.equal(fromQuery("phantom=brainweb").phantom, "brainweb");
  assert.equal(fromQuery("phantom=generated").phantom, "generated");
  assert.ok(!("phantom" in fromQuery("phantom=xyz")));
  assert.equal(toQuery({ seq: "GRE", phantom: "brainweb" }).includes("phantom=brainweb"), true);
});

test("fromContrast carries phantom brainweb into the explorer URL", () => {
  const p = defaultParams("GRE", "3.0T"), timing = protocolTiming(p, PROTOCOL_DEFAULTS);
  assert.ok(explorerUrl("../kspace/", { ...p, phantom: "brainweb" }, timing).includes("phantom=brainweb"));
  assert.ok(!explorerUrl("../kspace/", p, timing).includes("phantom="));
  assert.ok(!explorerUrl("../kspace/", { ...p, phantom: "generated" }, timing).includes("phantom="));
});
