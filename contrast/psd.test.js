import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawPulseSequence, PSD_SEQUENCES } from "./psd.js";

const golden = JSON.parse(readFileSync(new URL("./psd_golden.json", import.meta.url), "utf8"));
const TOL = 1e-8;

function toParams(a) {
  return { seq: a.seq, TR: a.TR, TE: a.TE, TI: a.TI, FA: a.FA, ETL: a.ETL, sliceMm: a.slice_mm, BW: a.BW, fovRead: a.FOV_read,
    epiEffIdx: a.epi_eff_idx, epiReadouts: a.epi_n_readouts, TI2: a.TI2, nPartitions: a.Npartitions };
}

// Compare a JS record against the matplotlib record, returning the first difference or null.
function diff(a, b, path = "") {
  if (typeof b === "number") {
    if (typeof a !== "number" || !(Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b)))) return `${path}: ${a} vs ${b}`;
    return null;
  }
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) return `${path}: length ${a?.length} vs ${b.length}`;
    for (let i = 0; i < b.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (b && typeof b === "object") {
    for (const k of Object.keys(b)) { const d = diff(a?.[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

const comparable = (fig) => ({
  figTexts: fig.figTexts, rects: fig.rects,
  axes: fig.axes.map((ax) => ({ visible: ax.visible, ylim: ax.ylim, ...(ax.visible ? { xlim: ax.xlim } : {}), lines: ax.lines, texts: ax.texts })),
});

test("golden set covers every diagram sequence and the no-diagram case", () => {
  const seqs = new Set(golden.map((g) => g.args.seq));
  for (const s of PSD_SEQUENCES) assert.ok(seqs.has(s), s);
  assert.ok(golden.some((g) => g.figure === null));
});

for (const [i, g] of golden.entries()) {
  const a = g.args;
  test(`#${i} ${a.seq} TR ${a.TR} TE ${a.TE} TI ${a.TI} TI2 ${a.TI2} ETL ${a.ETL} FA ${a.FA}: lines, texts, arrows match matplotlib`, () => {
    const fig = drawPulseSequence(toParams(a));
    if (g.figure === null) { assert.equal(fig, null); return; }
    assert.ok(fig);
    // hidden axes of warning figures keep matplotlib's default limits, which are not part of the port
    const want = { ...g.figure, axes: g.figure.axes.map((ax) => (ax.visible ? ax : { ...ax, xlim: undefined })) };
    const d = diff(comparable(fig), JSON.parse(JSON.stringify(want)));
    assert.equal(d, null, d);
  });
}

test("the comparison detects a perturbed waveform and a changed label", () => {
  const g = golden.find((x) => x.args.seq === "GRE");
  const fig = drawPulseSequence(toParams(g.args));
  assert.equal(diff(comparable(fig), g.figure), null);
  fig.axes[1].lines[1].y[1] += 0.01;
  assert.notEqual(diff(comparable(fig), g.figure), null);
  fig.axes[1].lines[1].y[1] -= 0.01;
  fig.axes[0].texts[0].s += "x";
  assert.notEqual(diff(comparable(fig), g.figure), null);
});

// ---- timing handed over from the model (2026-11-17): the diagram no longer derives its own echo spacing ----
test("FSE diagram follows the model's echo timing: it draws when the model allows the TR, and names an effective echo beyond the six shown", async () => {
  const { computeModel, defaultParams } = await import("./physics.js");
  const { psdParams } = await import("./psd.js");
  const texts = (fig) => JSON.stringify(fig);
  // 16 echoes at 10 ms need 160 ms; the diagram's own rule (20 ms spacing) would have refused a TR of 200 ms
  const p = { ...defaultParams("FSE", "3.0T"), TR: 200, TE: 80, ETL: 16 };
  const ok = texts(drawPulseSequence(psdParams(p, computeModel(p))));
  assert.ok(!ok.includes("TR too short"), "drawn, not refused");
  assert.ok(ok.includes("Showing 6 of 16 echoes; TEeff is echo 8"));
  const q = { ...p, TR: 150 };
  assert.ok(texts(drawPulseSequence(psdParams(q, computeModel(q)))).includes("minimum TR for current ETL and TEeff is 160 ms"));
  const r = { ...defaultParams("FSE", "3.0T"), TE: 30, ETL: 8 }; // third echo: inside the six shown, so it is marked as before
  const shown = texts(drawPulseSequence(psdParams(r, computeModel(r))));
  assert.ok(shown.includes("TEeff = 30 ms") && !shown.includes("TEeff is echo"));
});
