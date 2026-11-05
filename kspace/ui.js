import { DEFAULTS, gradEnd } from "../shared/sequence.js";
import { sampleTrajectory } from "../shared/ktraj.js";
import { diagramSvg, diagramGeometry } from "../shared/seqdiagram.js";
import { textScale, draw, layout, axisStyle, COLORS } from "../shared/plot.js";
import { defaultParams, computeModel, tissuesAt, csfNullTi, dirNullTi2 } from "../contrast/physics.js";
import { sampleSlice, composeSignal, labelSignals, toRgba } from "../contrast/image.js";
import { kspaceOf, reconstruct, toInferno, autoWindowLevelObject } from "../contrast/kspace.js";
import { thumbMatrix, thumbRow, createSampleCache, pump } from "./strip.js";
import { labelFactors, TISSUE_T1 } from "../shared/crosstalk.js";
import { createPhantom } from "../phantom/phantom.js";
import { buildShots, stackCrossTalk } from "./scan.js";
import { toQuery, contrastNote, applies, clampSel, initialState, explorerParams, SEQ_DEFAULTS, RANGES, INVERSION_SEQS } from "./settings.js";

const $ = (id) => document.getElementById(id);

const NAMES = { SE: "Spin echo", GRE: "Gradient echo (spoiled)", FSE: "Fast spin echo", EPI: "Single-shot EPI" };
const CONTRAST_SEQ = { SE: "FSE", GRE: "GRE", FSE: "FSE", EPI: "EPI (single-shot)" }; // tissue signal model to use
const INVERSION_MODEL = { IR: "FLAIR", DIR: "DIR" }; // ... or with an inversion (FLAIR's equation is the same as STIR's)
const INVERSION_TR = { IR: 9000, DIR: 8000 }; // TR raised to at least this when an inversion is switched on

// settings given in the page address (a shared link, or the contrast simulator's "Open in k-space explorer" button)
let state = initialState(location.search);

const CONTROLS = [
  { key: "seq", label: "Sequence", type: "select", options: Object.entries(NAMES) },
  { key: "TE", label: "TE (ms)", min: 1, max: 200, step: 0.5 },
  { key: "TR", label: "TR (ms)", min: RANGES.TR[0], max: RANGES.TR[1], step: 10 },
  { key: "flip", label: "Flip angle (°)", min: 5, max: 90, step: 1 },
  { key: "ETL", label: "Echo train length", min: 2, max: 32, step: 1 },
  { key: "inversion", label: "Inversion", type: "select", when: INVERSION_SEQS,
    options: [["none", "None"], ["IR", "One inversion (FLAIR, STIR)"], ["DIR", "Two inversions (DIR)"]] },
  { key: "TI", label: "TI (ms)", min: RANGES.TI[0], max: RANGES.TI[1], step: 10 },
  { key: "TI1", label: "TI1: first inversion (ms)", min: RANGES.TI1[0], max: RANGES.TI1[1], step: 10 },
  { key: "TI2", label: "TI2: second inversion (ms)", min: RANGES.TI2[0], max: RANGES.TI2[1], step: 10 },
  { key: "matrix", label: "Matrix (square)", type: "select", options: [[32, "32 × 32"], [64, "64 × 64"], [128, "128 × 128"], [256, "256 × 256"]] },
  { key: "fov", label: "FOV (mm)", min: 120, max: 400, step: 10 },
  { key: "bw", label: "Bandwidth (Hz/pixel)", min: 50, max: 3000, step: 10 },
  { key: "sliceMm", label: "Slice (mm)", min: 1, max: 10, step: 0.5 },
  { key: "slices", label: "Slices", min: RANGES.slices[0], max: RANGES.slices[1], step: 1, always: true },
  { key: "gapPct", label: "Slice gap (% of thickness)", min: RANGES.gapPct[0], max: RANGES.gapPct[1], step: 10 },
  { key: "sliceOrder", label: "Slice order", type: "select", options: [["sequential", "Sequential"], ["interleaved", "Interleaved"]] },
  // Auto, 1-4, and a linked protocol's value when it is above 4
  { key: "conc", label: "Concatenations", type: "select", options: (s) => [["auto", "Auto"], ...[1, 2, 3, 4].map((c) => [c, `${c}`]),
    ...(Number.isInteger(s.conc) && s.conc > 4 ? [[s.conc, `${s.conc}`]] : [])] },
  { key: "gMax", label: "Max gradient (mT/m)", type: "select", options: [[20, "20"], [40, "40"], [80, "80"]] },
  { key: "slew", label: "Max slew rate (T/m/s)", type: "select", options: [[70, "70"], [150, "150"], [200, "200"]] },
];

const params = () => explorerParams(state);

// ---- the scan: one sequence per TR, with its k-space samples and path ----
let scan = null;

// Cross-talk of the whole stack, one crossTalk per pass. It does not depend on which pass is shown, so selecting a
// slice in another pass reuses it.
const xtCache = new Map();
function stackXt(P) {
  const key = JSON.stringify([state.seq, { ...P, sel: undefined, pass: undefined, from: undefined }]);
  if (!xtCache.has(key)) {
    if (xtCache.size > 4) xtCache.clear();
    xtCache.set(key, stackCrossTalk(state.seq, P, TISSUE_T1()));
  }
  return xtCache.get(key);
}

function buildScan() {
  const P = params();
  state.sel = clampSel(state.sel, P.slices);
  // single-slice shots for every TR of the pass that holds the selected slice; the full N-block sequence of a TR
  // only when it is shown (kspace/scan.js)
  const { first, eff, N, C, pass, shots, offset, full, scanMs } = buildShots(state.seq, P, state.sel);
  // FSE: the effective TE is the echo that crosses ky = 0 (the same echo number in every train)
  const te = state.seq === "FSE" ? first.info.esp * (eff + 1) : first.te;
  scan = { P, N, C, pass, shots, full, offset, eff, scanMs, nx: P.nx, ny: P.ny, errors: first.errors, info: first.info, te, tr: first.tr };
  scan.xt = N > 1 ? stackXt(P) : null; // steady-state cross-talk between the slices of each pass
  scan.K = phantomKspace(P, { tr: first.tr, te, ti: first.info.ti }); // the inversion times actually played
  // largest gradient on each axis over the whole scan, so every TR's diagram uses the same heights
  // (every slice block repeats the single-slice gradients, so the single-slice shots give the same peaks)
  scan.peaks = { x: 0, y: 0, z: 0 };
  for (const s of shots) for (const g of s.seq.events) if (g.kind === "grad") scan.peaks[g.axis] = Math.max(scan.peaks[g.axis], Math.abs(g.amp));
}

// k-space of the noise-free phantom slice with this sequence's contrast
const phantom = createPhantom({ seed: 1, sulcalDepthMm: 14 });
const kCache = new Map();
// the contrast model's parameters for this scan (shared by the main image and the strip thumbnails)
function modelParams(P, seq) {
  const name = INVERSION_MODEL[P.inversion] ?? CONTRAST_SEQ[state.seq];
  const [ti1, ti2] = seq.ti ?? [];
  const p = { ...defaultParams(name, "3.0T"), TR: seq.tr, TE: seq.te ?? P.TE, FA: P.flip ?? 90, freqMatrix: P.nx, phaseMatrix: P.ny,
    fovRead: P.fovRead, fovPhase: P.fovPhase, sliceMm: P.sliceMm, ETL: P.ETL ?? 1, TI: ti1 ?? 0, TI1: ti1 ?? 0, TI2: ti2 ?? 0 };
  return { name, p };
}
function phantomKspace(P, seq) {
  const z = scan.xt ? scan.xt.slices[state.sel].zMm : 14;
  const factors = scan.xt ? labelFactors(scan.xt.slices[state.sel].factor) : null;
  const { name, p } = modelParams(P, seq);
  const key = [name, p.TR.toFixed(1), p.TE.toFixed(2), p.FA, p.TI1.toFixed(1), p.TI2.toFixed(1), P.nx, P.fovRead, P.sliceMm, z.toFixed(4), factors ? Array.from(factors, (f) => f.toFixed(4)).join(",") : "-"].join("|");
  if (!kCache.has(key)) {
    const sampled = sampleSlice(phantom, "axial", z, { nx: P.nx, ny: P.ny, fovRead: P.fovRead, fovPhase: P.fovPhase, thicknessMm: P.sliceMm });
    const lut = labelSignals(computeModel(p), p);
    if (factors) for (let i = 0; i < lut.length; i++) lut[i] *= factors[i]; // slices excited by their neighbours' pulses
    const v = composeSignal(sampled, lut);
    const K = kspaceOf(v, P.nx, P.ny);
    let max = 0;
    for (let i = 0; i < K.re.length; i++) max = Math.max(max, Math.hypot(K.re[i], K.im[i]));
    if (kCache.size > 6) kCache.clear();
    kCache.set(key, { ...K, max });
  }
  return kCache.get(key);
}

// ---- playback state: TR index and time within that TR ----
const play = { shot: 0, t: 0, playing: false, lastT: 0 };
const shotNow = () => scan.full(play.shot); // this TR with every slice block

function pathOf(shot) {
  if (!shot.path) shot.path = sampleTrajectory(shot.seq, 0, shot.activeEnd, 2500, shot.prep);
  return shot.path;
}

// the selected slice's samples taken so far: the single-slice samples, offset to the slice's block in the current TR
function mask() {
  const m = new Uint8Array(scan.nx * scan.ny), dt = scan.offset(state.sel);
  for (let s = 0; s < play.shot; s++) for (const p of scan.shots[s].samples) m[p.row * scan.nx + p.col] = 1;
  for (const p of scan.shots[play.shot].samples) if (p.t + dt <= play.t) m[p.row * scan.nx + p.col] = 1;
  return m;
}

// ---- controls ----
// whether control c is shown for settings s
const shown = (c, s) => (c.when ? c.when.includes(s.seq) && (s.slices ?? 1) <= 1 : c.always || applies(c.key, s));
// settings s with the slice count on the other side of 1 (the controls the Slices slider can show or hide)
const otherSide = (s) => ({ ...s, slices: (s.slices ?? 1) > 1 ? 1 : 2 });

// Controls that only the slice count hides are built too, hidden, so that dragging the Slices slider across 1 can
// show or hide them (syncControls) without rebuilding the slider being dragged.
function buildControls() {
  const box = $("controls");
  box.innerHTML = "";
  for (const c of CONTROLS) {
    if (!shown(c, state) && !shown(c, otherSide(state))) continue;
    const wrap = document.createElement("div"), id = `k_${c.key}`;
    wrap.dataset.key = c.key;
    wrap.hidden = !shown(c, state);
    const value = c.key === "matrix" ? state.ny : c.key === "conc" ? state.conc ?? "auto" : state[c.key] ?? 0;
    if (c.type === "select") {
      const options = typeof c.options === "function" ? c.options(state) : c.options;
      wrap.innerHTML = `<label for="${id}">${c.label}</label><select id="${id}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`;
      wrap.querySelector("select").value = value;
      wrap.querySelector("select").addEventListener("change", (e) => set(c.key, e.target.value));
    } else {
      wrap.innerHTML = `<label for="${id}">${c.label} <span class="v" id="${id}V">${value}</span></label>`
        + `<input id="${id}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${value}">`;
      wrap.querySelector("input").addEventListener("input", (e) => { $(`${id}V`).textContent = e.target.value; set(c.key, Number(e.target.value), false); });
    }
    box.append(wrap);
  }
}

function syncControls() {
  for (const wrap of $("controls").children) wrap.hidden = !shown(CONTROLS.find((c) => c.key === wrap.dataset.key), state);
}

function set(key, value, rebuildControls = true) {
  if (key === "seq") state = { ...state, ...DEFAULTS, ...SEQ_DEFAULTS[value], seq: value, slices: state.slices, gapPct: state.gapPct, sliceOrder: state.sliceOrder, conc: state.conc, sel: state.sel, fov: state.fov, gMax: state.gMax, slew: state.slew, from: undefined };
  else if (key === "matrix") state.nx = state.ny = Number(value);
  else if (key === "inversion") { state.inversion = value; if (value !== "none") state.TR = Math.max(state.TR, INVERSION_TR[value]); }
  else if (key === "slices") state.slices = Math.max(RANGES.slices[0], Math.min(RANGES.slices[1], Math.round(Number(value))));
  else if (key === "gapPct") state.gapPct = Math.round(Number(value) / 10) * 10;
  else state[key] = typeof value === "string" && !isNaN(value) ? Number(value) : value;
  if (rebuildControls) buildControls();
  else syncControls(); // a slider: only the slice count changes which controls are shown
  history.replaceState(null, "", `?${toQuery(state)}`); // the address always describes what is shown, so it can be shared
  stop();
  buildScan();
  play.shot = 0; play.t = 0;
  renderAll();
}

// ---- drawing ----
let geom = null;
function diagramWindow() {
  const seq = shotNow().seq;
  if (document.querySelector("input[name=view]:checked").value !== "echo") return { window: [0, seq.tr], note: "" };
  const adcs = seq.events.filter((e) => e.kind === "adc");
  const mine = adcs.filter((a) => (a.slice ?? 0) === state.sel);
  const c = mine.find((a) => a.row === scan.ny / 2) ?? mine[Math.floor(mine.length / 2)];
  const w = Math.max(4 * (c.n / 2 + 1) * c.dwell, 4);
  const window = [Math.max(0, c.tc - w), Math.min(seq.tr, c.tc + w)];
  return { window, note: `Showing ${window[0].toFixed(1)}–${window[1].toFixed(1)} ms around the echo of line ${c.row}${scan.xt ? ` of slice ${state.sel + 1}` : ""}.` };
}

function renderDiagram() {
  const shot = shotNow(), seq = shot.seq;
  const { window, note } = diagramWindow();
  $("viewNote").textContent = note;
  // received signal: |S| at each sample, from the phantom's k-space (square root so weak echoes stay visible)
  const signal = shot.samples.map((p) => {
    const i = p.row * scan.nx + p.col;
    return { t: p.t, v: Math.sqrt(Math.hypot(scan.K.re[i], scan.K.im[i]) / (scan.K.max || 1)) }; // max is 0 for a slice in air
  });
  const width = Math.max(700, $("diagram").clientWidth || 1000);
  const opts = { width, rowHeight: 42, window, fontScale: textScale(), scale: $("scale").value, signal, peaks: scan.peaks };
  $("diagram").innerHTML = diagramSvg(seq, opts);
  geom = diagramGeometry(seq, opts);
  $("cursor").setAttribute("viewBox", `0 0 ${geom.W} ${geom.H}`);
}

function renderCursor() {
  if (!geom) return;
  const t = play.t;
  $("cursor").innerHTML = t >= geom.t0 && t <= geom.t1
    ? `<line x1="${geom.X(t).toFixed(1)}" y1="${geom.top - 6}" x2="${geom.X(t).toFixed(1)}" y2="${geom.top + 5 * geom.rowH}" stroke="#7fd8ff" stroke-width="2.5"/>` : "";
}

function drawKspace() {
  const cv = $("kCanvas"), ctx = cv.getContext("2d"), S = cv.width;
  const { nx, ny } = scan, shot = shotNow(), path = pathOf(shot);
  // scale: the grid plus any excursion of this TR's path (prephasers reach a little past the edge)
  let ext = Math.max(nx, ny) / 2;
  for (let i = 0; i < path.t.length; i++) ext = Math.max(ext, Math.abs(path.kx[i] / scan.info.dkx), Math.abs(path.ky[i] / scan.info.dky));
  const px = (S * 0.46) / ext, c = S / 2;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, S, S);
  // filled k-space (log magnitude), drawn into the grid square
  const m = mask(), logs = new Float32Array(nx * ny);
  for (let i = 0; i < m.length; i++) if (m[i]) logs[i] = Math.log1p(Math.hypot(scan.K.re[i], scan.K.im[i]));
  const img = toInferno(logs);
  const off = new OffscreenCanvas(nx, ny);
  off.getContext("2d").putImageData(new ImageData(img, nx, ny), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, c - (nx / 2) * px, c - (ny / 2) * px, nx * px, ny * px);
  ctx.strokeStyle = "#555"; ctx.lineWidth = 1;
  ctx.strokeRect(c - (nx / 2) * px, c - (ny / 2) * px, nx * px, ny * px);
  ctx.strokeStyle = "#333"; ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, S); ctx.moveTo(0, c); ctx.lineTo(S, c); ctx.stroke();
  ctx.fillStyle = "#888"; ctx.font = `${Math.round(12 * textScale())}px system-ui`;
  ctx.fillText("kx →", S - 44, c - 6); ctx.fillText("ky ↓", c + 6, 16);
  // this TR's path up to now (points are sample positions are in units of the grid spacing)
  const X = (k) => c + (k / scan.info.dkx) * px, Y = (k) => c + (k / scan.info.dky) * px;
  // a refocusing pulse moves k instantly from k to -k: draw that as a dashed jump, not as part of the path
  const jumps = shot.seq.events.filter((e) => e.kind === "rf" && e.role === "refocus").map((e) => e.center);
  const dashed = [];
  ctx.strokeStyle = "rgba(127,216,255,.9)"; ctx.lineWidth = 1.6; ctx.beginPath();
  let last = null;
  for (let i = 0; i < path.t.length && path.t[i] <= play.t; i++) {
    const x = X(path.kx[i]), y = Y(path.ky[i]);
    const jumped = i > 0 && jumps.some((tj) => path.t[i - 1] < tj && path.t[i] >= tj);
    if (!last || jumped) { if (last) dashed.push([last, [x, y]]); ctx.moveTo(x, y); } else ctx.lineTo(x, y);
    last = [x, y];
  }
  ctx.stroke();
  ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 1.2;
  for (const [a, b] of dashed) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
  ctx.restore();
  const k = shot.prep.kAt(play.t);
  const [dx, dy] = last && play.t > 0 ? [X(k[0]), Y(k[1])] : [c, c];
  ctx.fillStyle = "#7fd8ff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(dx, dy, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
}

let lastRecon = 0, reconCount = -1;
function drawRecon(force = false) {
  const m = mask(), count = m.reduce((s, v) => s + v, 0);
  const now = performance.now();
  if (!force && (count === reconCount || now - lastRecon < 120)) return;
  lastRecon = now; reconCount = count;
  const cv = $("rCanvas");
  cv.width = scan.nx; cv.height = scan.ny;
  const ctx = cv.getContext("2d");
  if (count === 0) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, scan.nx, scan.ny); return; } // nothing acquired yet
  const rec = reconstruct(scan.K, m, scan.nx, scan.ny, 0);
  ctx.putImageData(new ImageData(imageRgba(rec, autoWindowLevelObject(rec)), scan.nx, scan.ny), 0, 0);
}

function renderStatus() {
  const shot = shotNow(), n = scan.shots.length;
  $("time").value = Math.round((play.t / shot.seq.tr) * 1000);
  const k = shot.prep.kAt(play.t);
  $("clock").textContent = `TR ${play.shot + 1} of ${n} · t = ${play.t.toFixed(2)} ms · k = (${(k[0] / scan.info.dkx).toFixed(1)}, ${(k[1] / scan.info.dky).toFixed(1)}) Δk`;
  $("play").textContent = play.playing ? "❚❚ Pause" : "▶ Play";
  $("prevTr").disabled = play.shot === 0;
  $("nextTr").disabled = play.shot >= n - 1;
  // what the gradients are doing at this moment
  const g = shot.prep.gAt(play.t);
  const active = shot.seq.events.filter((e) => e.kind === "grad" && play.t > e.start && play.t < gradEnd(e)).map((e) => e.label);
  const rf = shot.seq.events.find((e) => e.kind === "rf" && Math.abs(play.t - e.center) <= e.duration / 2);
  const adc = shot.seq.events.find((e) => e.kind === "adc" && Math.abs(play.t - e.tc) <= (e.n / 2 + 0.5) * e.dwell);
  const parts = [];
  if (rf) {
    const where = rf.slice !== undefined ? ` of slice ${rf.slice + 1} (offset ${rf.freqHz.toFixed(0)} Hz)` : "";
    parts.push(rf.role === "excite" ? `RF excitation${where} (${rf.flip}°): k is set to 0`
      : rf.role === "invert" ? "180° inversion pulse: Mz is flipped to −Mz; there is no transverse signal yet, so k is not involved"
        : `180° refocusing pulse${where}: k jumps to −k`);
  }
  if (active.length) parts.push(`gradients on: ${[...new Set(active)].join(", ")} (Gx ${g[0].toFixed(1)}, Gy ${g[1].toFixed(1)}, Gz ${g[2].toFixed(1)} mT/m)`);
  if (adc) parts.push(`ADC sampling line ${adc.row}${adc.slice !== undefined ? ` of slice ${adc.slice + 1}` : ""}`);
  $("kNote").textContent = parts.length ? parts.join(" · ") : "No gradients or RF at this moment.";
}

function renderInfo() {
  const i = scan.info, scanSec = scan.scanMs / 1000; // TR x TRs x concatenations
  const items = [
    ["TE", scan.te !== null ? `${scan.te.toFixed(2)} ms` : "—"], ["TR", `${scan.tr.toFixed(0)} ms`],
    ["Readout gradient", `${i.gRead.toFixed(2)} mT/m`], ["Sample spacing", `${(i.dwell * 1000).toFixed(1)} µs`],
    ["Readout duration", `${(i.dwell * i.nx).toFixed(2)} ms`],
  ];
  if (i.ti) {
    // inversion times that null a tissue at this TR (3 T relaxation times, as in the contrast simulator)
    const T = tissuesAt("3.0T");
    if (i.ti.length === 1) {
      items.splice(1, 0, ["TI", `${i.ti[0].toFixed(0)} ms`]);
      items.push(["CSF null TI", `${csfNullTi(scan.tr, T.CSF.T1).toFixed(0)} ms`], ["Fat null TI", `${csfNullTi(scan.tr, T.Fat.T1).toFixed(0)} ms`]);
    } else {
      items.splice(1, 0, ["TI1", `${i.ti[0].toFixed(0)} ms`], ["TI2", `${i.ti[1].toFixed(0)} ms`]);
      const wm = dirNullTi2(scan.tr, i.ti[0], T.WM.T1);
      items.push(["WM null TI2", wm ? `${wm.toFixed(0)} ms` : "n/a"]);
    }
    items.push(["Minimum TI", `${i.minTI.toFixed(1)} ms`]);
  }
  if (scan.xt) {
    const N = scan.N, sl = scan.xt.slices[state.sel], th = i.sliceMm, gap = state.gapPct * th / 100;
    const pct = (t) => { const d = (sl.factor[t] - 1) * 100; return `${Math.abs(d) < 0.05 ? "" : d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} %`; };
    items.push(["Slices", `${N} · max ${i.maxSlices} slices per TR`], ["Concatenations", scan.C > 1 ? `${scan.C} (showing pass ${scan.pass + 1})` : "1"],
      ["Slice spacing", `${(th + gap).toFixed(1)} mm`],
      ["Coverage", `${(N * th + (N - 1) * gap).toFixed(1)} mm`], ["Selected slice", `${state.sel + 1}`],
      ["RF offset", `${sl.freqHz.toFixed(0)} Hz`]);
    for (const t of ["WM", "GM", "CSF"]) items.push([`Cross-talk signal change, ${t}`, pct(t)]);
  }
  if (i.minTE !== undefined) items.push(["Minimum TE", `${i.minTE.toFixed(2)} ms`]);
  if (i.esp !== undefined) items.push(["Echo spacing", `${i.esp.toFixed(2)} ms`]);
  if (scan.eff !== undefined) items.push(["Effective echo", `${scan.eff + 1} of ${state.ETL}`]);
  items.push(["TRs to fill k-space", `${scan.shots.length}`], ["Scan time", `${Math.floor(scanSec / 60)}:${String(Math.round(scanSec % 60)).padStart(2, "0")}${scan.C > 1 ? ` (TR × TRs × ${scan.C} concatenations)` : ""}`]);
  $("info").innerHTML = items.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
  const note = (state.slices ?? 1) > 1 && INVERSION_SEQS.includes(state.seq)
    ? `<div class="info">Inversion is off with more than one slice: interleaving inversions across slices is not modelled yet.</div>` : "";
  const from = state.from ? `<div class="info">Opened from the contrast simulator (${state.from}) with its settings. ${contrastNote(state.from)}</div>` : "";
  const passes = (i.messages ?? []).map((m) => `<div class="info">${m}.</div>`).join("");
  $("passNote").textContent = scan.C > 1 ? `Pass ${scan.pass + 1} of ${scan.C} (slices ${i.slices.map((s) => s.index + 1).sort((a, b) => a - b).join(", ")})` : "";
  $("passNote").hidden = scan.C <= 1;
  $("messages").innerHTML = note + from + passes + scan.errors.map((e) => `<div class="alert">${e}. The sequence is drawn at the nearest possible value.</div>`).join("");
}

function renderFrame(forceRecon = false) {
  renderCursor(); drawKspace(); drawRecon(forceRecon); renderStatus(); refreshStrip();
}
function renderAll() { renderInfo(); renderDiagram(); renderFrame(true); drawProfiles(); buildStrip(); }
// ---- slice-profile panel (only with more than one slice) ----
function drawProfiles() {
  const panel = $("profilePanel");
  panel.hidden = !scan.xt || typeof Plotly === "undefined"; // without Plotly (CDN down) the strip still works
  if (panel.hidden) return;
  // the shown pass: its slices' profiles and the selected slice's Mz (slices in other passes do not act on it)
  const px = scan.xt.passes[scan.pass], members = px.slices, N = members.length, sel = state.sel, th = scan.info.sliceMm, tissue = $("profileTissue").value;
  const me = members.findIndex((s) => s.index === sel), other = scan.C > 1 ? "Other slices in this pass" : "Other slices";
  const traces = [];
  // legend: the selected slice, one entry for the other slices, one for the refocusing profiles, and Mz
  const firstOther = me === 0 ? 1 : 0;
  for (let j = 0; j < N; j++) {
    const n = members[j].index + 1;
    traces.push({ x: px.z, y: px.profiles.excite[j], mode: "lines", name: j === me ? `Slice ${n} (selected)` : other,
      legendgroup: j === me ? "sel" : "other", showlegend: j === me || j === firstOther,
      line: { color: COLORS.gold, width: j === me ? 3 : 1 }, opacity: j === me ? 1 : 0.7, hovertemplate: `Slice ${n}: |Mxy| %{y:.2f} at %{x:.1f} mm<extra></extra>` });
  }
  const refocus = px.profiles.refocus;
  for (let j = 0; j < refocus.length; j++) {
    traces.push({ x: px.z, y: Array.from(refocus[j], (zz) => (1 - zz) / 2), mode: "lines", name: "Refocusing", legendgroup: "refocus", showlegend: j === 0,
      line: { color: COLORS.red, width: j === me ? 2 : 1, dash: "dash" }, opacity: j === me ? 1 : 0.6, hovertemplate: `Slice ${members[j].index + 1} refocusing: %{y:.2f} at %{x:.1f} mm<extra></extra>` });
  }
  traces.push({ x: px.z, y: members[me].mzBefore[tissue], mode: "lines", name: `Mz just before slice ${sel + 1}'s excitation`,
    line: { color: COLORS.blue, width: 2.5 }, hovertemplate: "Mz %{y:.2f} at %{x:.1f} mm<extra></extra>" });
  // every slice of the stack as a band; those in other passes fainter
  const shapes = scan.xt.slices.filter((s) => s.zMm >= px.z[0] && s.zMm <= px.z[px.z.length - 1]).map((s) => ({ type: "rect", xref: "x", yref: "paper",
    x0: s.zMm - th / 2, x1: s.zMm + th / 2, y0: 0, y1: 1, line: { width: 0 }, layer: "below",
    fillcolor: s.index === sel ? "rgba(255,215,0,0.12)" : s.pass === scan.pass ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)" }));
  draw("profilePlot", traces, layout({
    xaxis: axisStyle({ title: { text: "Position along the slice direction (mm)" } }),
    yaxis: axisStyle({ title: { text: "Mz, or |Mxy| after the pulse" }, range: [-0.05, 1.1] }),
    shapes, legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", bgcolor: "rgba(26,26,26,0.85)", font: { size: 10 } },
    margin: { l: 56, r: 14, t: 56, b: 44 },
  }));
  const el = $("profilePlot");
  if (!el._clickWired) {
    el._clickWired = true;
    el.on("plotly_click", (e) => {
      const p = e.points?.[0], px = scan.xt?.passes[scan.pass];
      if (!px || !p || p.curveNumber >= px.profiles.excite.length + px.profiles.refocus.length) return;
      const N2 = px.slices.length;
      selectSlice(px.slices[p.curveNumber < N2 ? p.curveNumber : p.curveNumber - N2].index);
    });
  }
}
$("profileTissue").addEventListener("change", drawProfiles);


// ---- slice strip (only with more than one slice): every slice's image, filled in a few thumbnails per frame ----
const strip = { queue: [], key: null, K: [], mask: null, lut: null, wl: null, refP99: -1, drawn: new Set(), m: 0, raf: 0, cache: createSampleCache((z, th, fov, m) =>
  sampleSlice(phantom, "axial", z, { nx: m, ny: m, fovRead: fov[0], fovPhase: fov[1], thicknessMm: th })) };

function buildStrip() {
  const el = $("strip");
  $("stripPanel").hidden = !scan.xt;
  strip.queue = []; strip.key = null; strip.K = []; strip.mask = null; strip.wl = null; strip.refP99 = -1; strip.drawn.clear();
  if (!scan.xt) { el.innerHTML = ""; return; }
  const P = scan.P, N = scan.xt.slices.length, m = thumbMatrix(P.ny);
  const { p } = modelParams(P, { tr: scan.tr, te: scan.te, ti: scan.info.ti });
  strip.m = m;
  strip.lut = labelSignals(computeModel(p), p);
  if (strip.cache.size > 80) strip.cache.clear();
  // One window/level for every thumbnail, so a slice that loses signal looks dimmer. It comes from the brightest
  // slice without cross-talk (highest 99th percentile), found as the thumbnails are sampled (renderThumb).
  el.innerHTML = "";
  for (let j = 0; j < N; j++) {
    const fig = document.createElement("figure");
    fig.dataset.j = j;
    fig.innerHTML = `<canvas width="${m}" height="${m}"></canvas><figcaption></figcaption>`;
    fig.addEventListener("click", () => selectSlice(j));
    el.appendChild(fig);
  }
  markStrip();
  refreshStrip(true);
}

// signed WM change and acquisition order under each thumbnail; outline the selected slice
function markStrip() {
  if (!scan.xt) return;
  for (const fig of $("strip").children) {
    const j = Number(fig.dataset.j), sl = scan.xt.slices[j], d = (sl.factor.WM - 1) * 100;
    const sign = Math.abs(d) < 0.05 ? "" : d > 0 ? "+" : "−";
    const where = scan.C > 1 ? `P${sl.pass + 1} #${sl.acq + 1}` : `#${sl.acq + 1}`;
    fig.querySelector("figcaption").textContent = `S${j + 1} · ${where} · WM ${sign}${Math.abs(d).toFixed(1)} %`;
    fig.classList.toggle("sel", j === state.sel);
    fig.classList.toggle("other", sl.pass !== scan.pass); // in another pass: not played in the TRs shown
    fig.title = sl.pass === scan.pass ? "" : sl.pass < scan.pass ? `Pass ${sl.pass + 1}: acquired before this pass` : `Pass ${sl.pass + 1}: acquired after this pass`;
  }
}

// queue every thumbnail again when the acquired rows have changed (a TR boundary, Fill all, Reset)
function refreshStrip(force = false) {
  if (!scan.xt) return;
  const key = play.shot * 2 + (play.t >= shotNow().seq.tr ? 1 : 0);
  if (!force && key === strip.key) return;
  strip.key = key;
  strip.mask = thumbMask();
  // slices in other passes: an earlier pass is finished, a later one not started
  strip.done = new Uint8Array(strip.m * strip.m).fill(1); strip.none = new Uint8Array(strip.m * strip.m);
  // the selected slice first: usually inside the head, so the window rarely has to change during the fill
  strip.queue = [state.sel, ...Array.from({ length: scan.xt.slices.length }, (_, j) => j).filter((j) => j !== state.sel)];
  if (!strip.raf) strip.raf = requestAnimationFrame(stripFrame);
}

function stripFrame() {
  strip.raf = 0;
  pump(strip.queue, renderThumb, 40);
  if (strip.queue.length) strip.raf = requestAnimationFrame(stripFrame);
}

// rows taken so far, as thumbnail rows (every slice is read on the same phase-encode rows each TR)
function thumbMask() {
  const ny = scan.ny, m = strip.m, out = new Uint8Array(m * m), taken = new Uint8Array(ny);
  // (the first block is at offset 0, so the single-slice times are the earliest any slice takes each row)
  for (let s = 0; s < play.shot; s++) for (const p of scan.shots[s].samples) taken[p.row] = 1;
  for (const p of scan.shots[play.shot].samples) if (p.t <= play.t) taken[p.row] = 1;
  for (let r = 0; r < ny; r++) {
    const t = taken[r] ? thumbRow(r, ny, m) : -1;
    if (t >= 0) out.fill(1, t * m, (t + 1) * m);
  }
  return out;
}

function renderThumb(j) {
  const fig = $("strip").children[j];
  if (!fig || !strip.lut) return;
  const P = scan.P, m = strip.m, sl = scan.xt.slices[j], factors = labelFactors(sl.factor);
  if (!strip.K[j]) { // the thumbnail's k-space does not depend on how much has been acquired
    const sampled = strip.cache.get(sl.zMm, P.sliceMm, [P.fovRead, P.fovPhase], m);
    const lut = Float32Array.from(strip.lut, (v, i) => v * factors[i]);
    strip.K[j] = kspaceOf(composeSignal(sampled, lut), m, m);
    // a brighter isolated slice than any so far sets the shared window; redraw the thumbnails drawn with the old one
    const alone = composeSignal(sampled, strip.lut), p99 = percentile99(alone);
    if (p99 > strip.refP99) {
      strip.refP99 = p99;
      const wl = autoWindowLevelObject(alone);
      strip.wl = { window: Math.max(wl.window, 0.25 * p99, 1e-6), level: wl.level }; // floor: never a near-zero window
      for (const k of strip.drawn) if (!strip.queue.includes(k)) strip.queue.push(k);
      strip.drawn.clear();
    }
  }
  const mk = sl.pass === scan.pass ? strip.mask : sl.pass < scan.pass ? strip.done : strip.none;
  const rec = reconstruct(strip.K[j], mk, m, m, 0);
  fig.querySelector("canvas").getContext("2d").putImageData(new ImageData(imageRgba(rec, strip.wl), m, m), 0, 0);
  strip.drawn.add(j);
}

function percentile99(values) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))];
}

// grey levels of a reconstruction; all black when it is all zero (a slice in air, or nothing acquired)
function imageRgba(rec, wl) {
  let max = 0;
  for (const v of rec) if (v > max) max = v;
  if (!(max > 0)) { const out = new Uint8ClampedArray(rec.length * 4); for (let i = 3; i < out.length; i += 4) out[i] = 255; return out; }
  return toRgba(rec, wl.window, wl.level);
}

// choose which slice's k-space and image are shown (no new sequence or cross-talk calculation)
function selectSlice(j) {
  state.sel = clampSel(j, scan.N);
  history.replaceState(null, "", `?${toQuery(state)}`);
  stop();
  if (scan.xt && scan.xt.slices[state.sel].pass !== scan.pass) { // another pass: its own sequence (cross-talk is cached)
    buildScan(); play.shot = 0; play.t = 0; renderAll(); return;
  }
  scan.K = phantomKspace(scan.P, { tr: scan.tr, te: scan.te, ti: scan.info.ti });
  renderInfo(); renderDiagram(); renderFrame(true); drawProfiles(); markStrip();
}

// ---- playback ----
function skipIdle(shot, t) {
  if (!geom || geom.t0 !== 0) return t; // only in the whole-TR view, where the breaks are known
  const seg = geom.axis.segments.find((s) => s.compressed && t >= s.t0 && t < s.t1);
  return seg ? seg.t1 : t;
}

// ms of this TR that playback actually shows: the skipped breaks do not count
function playedMs(shot) {
  if (!geom || geom.t0 !== 0) return shot.activeEnd;
  return geom.axis.segments.filter((s) => !s.compressed && s.t0 < shot.activeEnd)
    .reduce((sum, s) => sum + Math.min(s.t1, shot.activeEnd) - s.t0, 0) || shot.activeEnd;
}

function advance(dtSec) {
  const sp = $("speed").value, shot = shotNow();
  if (sp === "real") play.t += dtSec * 1000; // every millisecond, waits included
  else {
    const rate = sp === "tr1" ? playedMs(shot) : sp === "tr10" ? 10 * playedMs(shot) : Number(sp); // ms of sequence per second
    play.t = skipIdle(shot, play.t + dtSec * rate);
    if (play.t >= shot.activeEnd) play.t = shot.seq.tr; // nothing else happens in this TR
  }
  if (play.t >= shot.seq.tr) {
    if (play.shot < scan.shots.length - 1) { play.shot++; play.t = 0; renderDiagram(); }
    else { play.t = shot.seq.tr; play.playing = false; }
  }
}

function tick(time) {
  if (!play.playing) return;
  const dt = play.lastT ? Math.min(0.1, (time - play.lastT) / 1000) : 0;
  play.lastT = time;
  advance(dt);
  renderFrame();
  if (play.playing) requestAnimationFrame(tick);
  else renderFrame(true);
}

function stop() { play.playing = false; }

$("play").addEventListener("click", () => {
  if (play.playing) { stop(); renderStatus(); return; }
  if (play.shot >= scan.shots.length - 1 && play.t >= shotNow().seq.tr) { play.shot = 0; play.t = 0; renderDiagram(); }
  play.playing = true; play.lastT = 0;
  requestAnimationFrame(tick);
});
$("reset").addEventListener("click", () => { stop(); play.shot = 0; play.t = 0; renderDiagram(); renderFrame(true); });
$("prevTr").addEventListener("click", () => { stop(); play.shot = Math.max(0, play.shot - 1); play.t = 0; renderDiagram(); renderFrame(true); });
$("nextTr").addEventListener("click", () => { stop(); play.shot = Math.min(scan.shots.length - 1, play.shot + 1); play.t = 0; renderDiagram(); renderFrame(true); });
$("fillAll").addEventListener("click", () => { stop(); play.shot = scan.shots.length - 1; play.t = shotNow().seq.tr; renderDiagram(); renderFrame(true); });
$("time").addEventListener("input", () => { stop(); play.t = (Number($("time").value) / 1000) * shotNow().seq.tr; renderFrame(true); });
for (const el of document.querySelectorAll("input[name=view]")) el.addEventListener("change", () => { renderDiagram(); renderCursor(); });
$("scale").addEventListener("change", () => { renderDiagram(); renderCursor(); });
window.addEventListener("resize", () => { renderDiagram(); renderCursor(); });
window.addEventListener("textsizechange", () => { renderDiagram(); renderFrame(true); });

buildControls();
buildScan();
renderAll();
