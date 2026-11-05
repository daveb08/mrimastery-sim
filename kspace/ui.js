import { BUILDERS, DEFAULTS, DEFAULT_LIMITS, gradEnd } from "../shared/sequence.js";
import { prepare, adcSamples, sampleTrajectory } from "../shared/ktraj.js";
import { diagramSvg, diagramGeometry } from "../shared/seqdiagram.js";
import { textScale, draw, layout, axisStyle, COLORS } from "../shared/plot.js";
import { echoTrainReadouts, acquiredRows } from "../contrast/acquisition.js";
import { defaultParams, computeModel, tissuesAt, csfNullTi, dirNullTi2 } from "../contrast/physics.js";
import { sampleSlice, composeSignal, labelSignals, toRgba } from "../contrast/image.js";
import { kspaceOf, reconstruct, toInferno, autoWindowLevelObject } from "../contrast/kspace.js";
import { crossTalk, labelFactors, TISSUE_T1 } from "../shared/crosstalk.js";
import { createPhantom } from "../phantom/phantom.js";
import { fromQuery, toQuery, contrastNote, applies, clampSel, RANGES, INVERSION_SEQS } from "./settings.js";

const $ = (id) => document.getElementById(id);

const SEQ_DEFAULTS = {
  SE: { TE: 20, TR: 500, nx: 128, ny: 128 },
  GRE: { TE: 5, TR: 50, flip: 30, nx: 128, ny: 128 },
  FSE: { TE: 80, TR: 3000, ETL: 8, nx: 128, ny: 128 },
  EPI: { TE: 40, TR: 3000, bw: 1500, nx: 64, ny: 64 },
};
const NAMES = { SE: "Spin echo", GRE: "Gradient echo (spoiled)", FSE: "Fast spin echo", EPI: "Single-shot EPI" };
const CONTRAST_SEQ = { SE: "FSE", GRE: "GRE", FSE: "FSE", EPI: "EPI (single-shot)" }; // tissue signal model to use
const INVERSION_MODEL = { IR: "FLAIR", DIR: "DIR" }; // ... or with an inversion (FLAIR's equation is the same as STIR's)
const INVERSION_TR = { IR: 9000, DIR: 8000 }; // TR raised to at least this when an inversion is switched on

let state = { seq: "SE", ...DEFAULTS, ...SEQ_DEFAULTS.SE, fov: 240, gMax: DEFAULT_LIMITS.gMax, slew: DEFAULT_LIMITS.slew };
// settings given in the page address (a shared link, or the contrast simulator's "Open in k-space explorer" button)
{
  const q = fromQuery(location.search);
  if (q.seq) state = { ...state, ...SEQ_DEFAULTS[q.seq], seq: q.seq };
  state = { ...state, ...q };
  if (state.slices !== undefined) state.slices = Math.round(state.slices);
  if (state.gapPct !== undefined) state.gapPct = Math.round(state.gapPct / 10) * 10;
}

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
  { key: "gMax", label: "Max gradient (mT/m)", type: "select", options: [[20, "20"], [40, "40"], [80, "80"]] },
  { key: "slew", label: "Max slew rate (T/m/s)", type: "select", options: [[70, "70"], [150, "150"], [200, "200"]] },
];

const inversionOf = (s) => ((s.slices ?? 1) <= 1 && INVERSION_SEQS.includes(s.seq) ? s.inversion ?? "none" : "none");
const params = () => ({ ...state, slices: state.slices ?? 1, gapPct: state.gapPct ?? 20, sliceOrder: state.sliceOrder ?? "interleaved",
  inversion: inversionOf(state), nx: state.ny, fovRead: state.fov, fovPhase: state.fov,
  limits: { gMax: +state.gMax, slew: +state.slew } });

// ---- the scan: one sequence per TR, with its k-space samples and path ----
let scan = null;

function fseShots(P) {
  const probe = BUILDERS.FSE(P, Array.from({ length: P.ETL }, (_, i) => i));
  const eff = Math.max(0, Math.min(P.ETL - 1, Math.round(P.TE / probe.info.esp) - 1));
  const ro = echoTrainReadouts(acquiredRows(P.ny, 1), P.ETL, eff);
  return { rows: [...new Set(ro.map((r) => r.group))].map((g) => ro.filter((r) => r.group === g).map((r) => r.row)), eff };
}

function buildScan() {
  const P = params();
  let rowsPerShot, eff;
  if (state.seq === "SE" || state.seq === "GRE") rowsPerShot = acquiredRows(P.ny, 1).map((r) => [r]);
  else if (state.seq === "EPI") rowsPerShot = [acquiredRows(P.ny, 1)];
  else ({ rows: rowsPerShot, eff } = fseShots(P));
  const build = (rows) => (state.seq === "SE" ? BUILDERS.SE(P, rows[0]) : state.seq === "GRE" ? BUILDERS.GRE(P, rows[0])
    : state.seq === "EPI" ? BUILDERS.EPI(P, rows) : BUILDERS.FSE(P, rows));
  const shots = rowsPerShot.map((rows) => {
    const seq = build(rows), prep = prepare(seq);
    const samples = adcSamples(seq, prep).map((s) => ({ t: s.t, col: Math.round(s.colExact), row: Math.round(s.rowExact), slice: s.slice ?? 0 }));
    const activeEnd = Math.max(...seq.events.filter((e) => e.kind === "grad").map(gradEnd));
    return { seq, prep, samples, activeEnd, path: null };
  });
  const first = shots[0].seq;
  // FSE: the effective TE is the echo that crosses ky = 0 (the same echo number in every train)
  const te = state.seq === "FSE" ? first.info.esp * (eff + 1) : first.te;
  scan = { P, shots, eff, nx: P.nx, ny: P.ny, errors: first.errors, info: first.info, te, tr: first.tr };
  const N = first.info.slices?.length ?? 1;
  state.sel = clampSel(state.sel, N);
  scan.xt = N > 1 ? crossTalk(first, TISSUE_T1()) : null; // steady-state cross-talk between the slices (once per rebuild)
  scan.K = phantomKspace(P, { tr: first.tr, te, ti: first.info.ti }); // the inversion times actually played
  // largest gradient on each axis over the whole scan, so every TR's diagram uses the same heights
  scan.peaks = { x: 0, y: 0, z: 0 };
  for (const s of shots) for (const g of s.seq.events) if (g.kind === "grad") scan.peaks[g.axis] = Math.max(scan.peaks[g.axis], Math.abs(g.amp));
}

// k-space of the noise-free phantom slice with this sequence's contrast
const phantom = createPhantom({ seed: 1, sulcalDepthMm: 14 });
const kCache = new Map();
function phantomKspace(P, seq) {
  const z = scan.xt ? scan.info.slices[state.sel].zMm : 14;
  const factors = scan.xt ? labelFactors(scan.xt.slices[state.sel].factor) : null;
  const name = INVERSION_MODEL[P.inversion] ?? CONTRAST_SEQ[state.seq];
  const [ti1, ti2] = seq.ti ?? [];
  const p = { ...defaultParams(name, "3.0T"), TR: seq.tr, TE: seq.te ?? P.TE, FA: P.flip ?? 90, freqMatrix: P.nx, phaseMatrix: P.ny,
    fovRead: P.fovRead, fovPhase: P.fovPhase, sliceMm: P.sliceMm, ETL: P.ETL ?? 1, TI: ti1 ?? 0, TI1: ti1 ?? 0, TI2: ti2 ?? 0 };
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
const shotNow = () => scan.shots[play.shot];

function pathOf(shot) {
  if (!shot.path) shot.path = sampleTrajectory(shot.seq, 0, shot.activeEnd, 2500, shot.prep);
  return shot.path;
}

function mask() {
  const m = new Uint8Array(scan.nx * scan.ny);
  for (let s = 0; s < play.shot; s++) for (const p of scan.shots[s].samples) if (p.slice === state.sel) m[p.row * scan.nx + p.col] = 1;
  for (const p of shotNow().samples) if (p.slice === state.sel && p.t <= play.t) m[p.row * scan.nx + p.col] = 1;
  return m;
}

// ---- controls ----
function buildControls() {
  const box = $("controls");
  box.innerHTML = "";
  for (const c of CONTROLS) {
    if (c.when ? !c.when.includes(state.seq) || (state.slices ?? 1) > 1 : !c.always && !applies(c.key, state)) continue;
    const wrap = document.createElement("div"), id = `k_${c.key}`;
    const value = c.key === "matrix" ? state.ny : state[c.key] ?? 0;
    if (c.type === "select") {
      wrap.innerHTML = `<label for="${id}">${c.label}</label><select id="${id}">${c.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`;
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

function set(key, value, rebuildControls = true) {
  if (key === "seq") state = { ...state, ...DEFAULTS, ...SEQ_DEFAULTS[value], seq: value, slices: state.slices, gapPct: state.gapPct, sliceOrder: state.sliceOrder, sel: state.sel, fov: state.fov, gMax: state.gMax, slew: state.slew, from: undefined };
  else if (key === "matrix") state.nx = state.ny = Number(value);
  else if (key === "inversion") { state.inversion = value; if (value !== "none") state.TR = Math.max(state.TR, INVERSION_TR[value]); }
  else if (key === "slices") state.slices = Math.max(RANGES.slices[0], Math.min(RANGES.slices[1], Math.round(Number(value))));
  else if (key === "gapPct") state.gapPct = Math.round(Number(value) / 10) * 10;
  else state[key] = typeof value === "string" && !isNaN(value) ? Number(value) : value;
  if (rebuildControls) buildControls();
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
    return { t: p.t, v: Math.sqrt(Math.hypot(scan.K.re[i], scan.K.im[i]) / scan.K.max) };
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
  const wl = autoWindowLevelObject(rec);
  ctx.putImageData(new ImageData(toRgba(rec, wl.window, wl.level), scan.nx, scan.ny), 0, 0);
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
  const i = scan.info, scanSec = (scan.tr * scan.shots.length) / 1000;
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
    const N = i.slices.length, sl = scan.xt.slices[state.sel], th = i.sliceMm, gap = state.gapPct * th / 100;
    const pct = (t) => { const d = (sl.factor[t] - 1) * 100; return `${Math.abs(d) < 0.05 ? "" : d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} %`; };
    items.push(["Slices", `${N} (max ${i.maxSlices} at TR ${i.requestedTR} ms)`], ["Slice spacing", `${(th + gap).toFixed(1)} mm`],
      ["Coverage", `${(N * th + (N - 1) * gap).toFixed(1)} mm`], ["Selected slice", `${state.sel + 1}`],
      ["RF offset", `${sl.freqHz.toFixed(0)} Hz`]);
    for (const t of ["WM", "GM", "CSF"]) items.push([`Cross-talk signal change, ${t}`, pct(t)]);
  }
  if (i.minTE !== undefined) items.push(["Minimum TE", `${i.minTE.toFixed(2)} ms`]);
  if (i.esp !== undefined) items.push(["Echo spacing", `${i.esp.toFixed(2)} ms`]);
  if (scan.eff !== undefined) items.push(["Effective echo", `${scan.eff + 1} of ${state.ETL}`]);
  items.push(["TRs to fill k-space", `${scan.shots.length}`], ["Scan time", `${Math.floor(scanSec / 60)}:${String(Math.round(scanSec % 60)).padStart(2, "0")}`]);
  $("info").innerHTML = items.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
  const note = (state.slices ?? 1) > 1 && INVERSION_SEQS.includes(state.seq)
    ? `<div class="info">Inversion is off with more than one slice: interleaving inversions across slices is not modelled yet.</div>` : "";
  const from = state.from ? `<div class="info">Opened from the contrast simulator (${state.from}) with its settings. ${contrastNote(state.from)}</div>` : "";
  $("messages").innerHTML = note + from + scan.errors.map((e) => `<div class="alert">${e}. The sequence is drawn at the nearest possible value.</div>`).join("");
}

function renderFrame(forceRecon = false) {
  renderCursor(); drawKspace(); drawRecon(forceRecon); renderStatus();
}
function renderAll() { renderInfo(); renderDiagram(); renderFrame(true); drawProfiles(); }
// ---- slice-profile panel (only with more than one slice) ----
function drawProfiles() {
  const panel = $("profilePanel");
  panel.hidden = !scan.xt;
  if (!scan.xt) return;
  const xt = scan.xt, N = xt.slices.length, sel = state.sel, th = scan.info.sliceMm, tissue = $("profileTissue").value;
  const traces = [];
  for (let j = 0; j < N; j++) {
    traces.push({ x: xt.z, y: xt.profiles.excite[j], mode: "lines", name: j === sel ? `Slice ${j + 1} (selected)` : `Slice ${j + 1}`,
      line: { color: COLORS.gold, width: j === sel ? 3 : 1 }, opacity: j === sel ? 1 : 0.7, hovertemplate: `Slice ${j + 1}: |Mxy| %{y:.2f} at %{x:.1f} mm<extra></extra>` });
  }
  const refocus = xt.profiles.refocus;
  for (let j = 0; j < refocus.length; j++) {
    traces.push({ x: xt.z, y: Array.from(refocus[j], (zz) => (1 - zz) / 2), mode: "lines", name: j === 0 ? "Refocusing profile" : `Refocusing, slice ${j + 1}`, showlegend: j === 0,
      line: { color: COLORS.red, width: j === sel ? 2 : 1, dash: "dash" }, opacity: j === sel ? 1 : 0.6, hovertemplate: `Slice ${j + 1} refocusing: %{y:.2f} at %{x:.1f} mm<extra></extra>` });
  }
  traces.push({ x: xt.z, y: xt.slices[sel].mzBefore[tissue], mode: "lines", name: `Mz just before slice ${sel + 1}'s excitation`,
    line: { color: COLORS.blue, width: 2.5 }, hovertemplate: "Mz %{y:.2f} at %{x:.1f} mm<extra></extra>" });
  const shapes = xt.slices.map((s, j) => ({ type: "rect", xref: "x", yref: "paper", x0: s.zMm - th / 2, x1: s.zMm + th / 2, y0: 0, y1: 1,
    fillcolor: j === sel ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.05)", line: { width: 0 }, layer: "below" }));
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
      const p = e.points?.[0];
      if (!scan.xt || !p || p.curveNumber >= scan.xt.profiles.excite.length + scan.xt.profiles.refocus.length) return;
      const N2 = scan.xt.slices.length;
      selectSlice(p.curveNumber < N2 ? p.curveNumber : p.curveNumber - N2);
    });
  }
}
$("profileTissue").addEventListener("change", drawProfiles);


// choose which slice's k-space and image are shown (no new sequence or cross-talk calculation)
function selectSlice(j) {
  state.sel = clampSel(j, scan.info.slices?.length ?? 1);
  history.replaceState(null, "", `?${toQuery(state)}`);
  stop();
  scan.K = phantomKspace(scan.P, { tr: scan.tr, te: scan.te, ti: scan.info.ti });
  renderInfo(); renderDiagram(); renderFrame(true); drawProfiles();
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
