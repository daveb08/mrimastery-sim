import { BUILDERS, DEFAULTS, DEFAULT_LIMITS, gradEnd } from "../shared/sequence.js";
import { prepare, adcSamples, sampleTrajectory } from "../shared/ktraj.js";
import { diagramSvg, diagramGeometry } from "../shared/seqdiagram.js";
import { textScale } from "../shared/plot.js";
import { echoTrainReadouts, acquiredRows } from "../contrast/acquisition.js";
import { defaultParams, computeModel } from "../contrast/physics.js";
import { sampleSlice, composeSignal, labelSignals, toRgba } from "../contrast/image.js";
import { kspaceOf, reconstruct, toInferno, autoWindowLevelObject } from "../contrast/kspace.js";
import { createPhantom } from "../phantom/phantom.js";

const $ = (id) => document.getElementById(id);

const SEQ_DEFAULTS = {
  SE: { TE: 20, TR: 500, nx: 128, ny: 128 },
  GRE: { TE: 5, TR: 50, flip: 30, nx: 128, ny: 128 },
  FSE: { TE: 80, TR: 3000, ETL: 8, nx: 128, ny: 128 },
  EPI: { TE: 40, TR: 3000, bw: 1500, nx: 64, ny: 64 },
};
const NAMES = { SE: "Spin echo", GRE: "Gradient echo (spoiled)", FSE: "Fast spin echo", EPI: "Single-shot EPI" };
const CONTRAST_SEQ = { SE: "FSE", GRE: "GRE", FSE: "FSE", EPI: "EPI (single-shot)" }; // tissue signal model to use

let state = { seq: "SE", ...DEFAULTS, ...SEQ_DEFAULTS.SE, fov: 240, gMax: DEFAULT_LIMITS.gMax, slew: DEFAULT_LIMITS.slew };

const CONTROLS = [
  { key: "seq", label: "Sequence", type: "select", options: Object.entries(NAMES) },
  { key: "TE", label: "TE (ms)", min: 1, max: 200, step: 0.5 },
  { key: "TR", label: "TR (ms)", min: 10, max: 5000, step: 10 },
  { key: "flip", label: "Flip angle (°)", min: 5, max: 90, step: 1, when: ["GRE"] },
  { key: "ETL", label: "Echo train length", min: 2, max: 32, step: 1, when: ["FSE"] },
  { key: "matrix", label: "Matrix (square)", type: "select", options: [[32, "32 × 32"], [64, "64 × 64"], [128, "128 × 128"], [256, "256 × 256"]] },
  { key: "fov", label: "FOV (mm)", min: 120, max: 400, step: 10 },
  { key: "bw", label: "Bandwidth (Hz/pixel)", min: 50, max: 3000, step: 10 },
  { key: "sliceMm", label: "Slice (mm)", min: 1, max: 10, step: 0.5 },
  { key: "gMax", label: "Max gradient (mT/m)", type: "select", options: [[20, "20"], [40, "40"], [80, "80"]] },
  { key: "slew", label: "Max slew rate (T/m/s)", type: "select", options: [[70, "70"], [150, "150"], [200, "200"]] },
];

const params = () => ({ ...state, nx: state.ny, fovRead: state.fov, fovPhase: state.fov, limits: { gMax: +state.gMax, slew: +state.slew } });

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
    const samples = adcSamples(seq, prep).map((s) => ({ t: s.t, col: Math.round(s.colExact), row: Math.round(s.rowExact) }));
    const activeEnd = Math.max(...seq.events.filter((e) => e.kind === "grad").map(gradEnd));
    return { seq, prep, samples, activeEnd, path: null };
  });
  const first = shots[0].seq;
  // FSE: the effective TE is the echo that crosses ky = 0 (the same echo number in every train)
  const te = state.seq === "FSE" ? first.info.esp * (eff + 1) : first.te;
  scan = { P, shots, eff, nx: P.nx, ny: P.ny, errors: first.errors, info: first.info, te, tr: first.tr };
  scan.K = phantomKspace(P, { tr: first.tr, te });
  // largest gradient on each axis over the whole scan, so every TR's diagram uses the same heights
  scan.peaks = { x: 0, y: 0, z: 0 };
  for (const s of shots) for (const g of s.seq.events) if (g.kind === "grad") scan.peaks[g.axis] = Math.max(scan.peaks[g.axis], Math.abs(g.amp));
}

// k-space of the noise-free phantom slice with this sequence's contrast
const phantom = createPhantom({ seed: 1, sulcalDepthMm: 14 });
const kCache = new Map();
function phantomKspace(P, seq) {
  const name = CONTRAST_SEQ[state.seq];
  const p = { ...defaultParams(name, "3.0T"), TR: seq.tr, TE: seq.te ?? P.TE, FA: P.flip ?? 90, freqMatrix: P.nx, phaseMatrix: P.ny,
    fovRead: P.fovRead, fovPhase: P.fovPhase, sliceMm: P.sliceMm, ETL: P.ETL ?? 1 };
  const key = [name, p.TR.toFixed(1), p.TE.toFixed(2), p.FA, P.nx, P.fovRead, P.sliceMm].join("|");
  if (!kCache.has(key)) {
    const sampled = sampleSlice(phantom, "axial", 14, { nx: P.nx, ny: P.ny, fovRead: P.fovRead, fovPhase: P.fovPhase, thicknessMm: P.sliceMm });
    const v = composeSignal(sampled, labelSignals(computeModel(p), p));
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
  for (let s = 0; s < play.shot; s++) for (const p of scan.shots[s].samples) m[p.row * scan.nx + p.col] = 1;
  for (const p of shotNow().samples) if (p.t <= play.t) m[p.row * scan.nx + p.col] = 1;
  return m;
}

// ---- controls ----
function buildControls() {
  const box = $("controls");
  box.innerHTML = "";
  for (const c of CONTROLS) {
    if (c.when && !c.when.includes(state.seq)) continue;
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
  if (key === "seq") state = { ...state, ...DEFAULTS, ...SEQ_DEFAULTS[value], seq: value, fov: state.fov, gMax: state.gMax, slew: state.slew };
  else if (key === "matrix") state.nx = state.ny = Number(value);
  else state[key] = typeof value === "string" && !isNaN(value) ? Number(value) : value;
  if (rebuildControls) buildControls();
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
  const c = adcs.find((a) => a.row === scan.ny / 2) ?? adcs[Math.floor(adcs.length / 2)];
  const w = Math.max(4 * (c.n / 2 + 1) * c.dwell, 4);
  const window = [Math.max(0, c.tc - w), Math.min(seq.tr, c.tc + w)];
  return { window, note: `Showing ${window[0].toFixed(1)}–${window[1].toFixed(1)} ms around the echo of line ${c.row}.` };
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
  const rec = reconstruct(scan.K, m, scan.nx, scan.ny, 0);
  const wl = autoWindowLevelObject(rec);
  const cv = $("rCanvas");
  cv.width = scan.nx; cv.height = scan.ny;
  cv.getContext("2d").putImageData(new ImageData(toRgba(rec, wl.window, wl.level), scan.nx, scan.ny), 0, 0);
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
  const active = shot.seq.events.filter((e) => e.kind === "grad" && play.t >= e.start && play.t <= gradEnd(e)).map((e) => e.label);
  const rf = shot.seq.events.find((e) => e.kind === "rf" && Math.abs(play.t - e.center) <= e.duration / 2);
  const adc = shot.seq.events.find((e) => e.kind === "adc" && Math.abs(play.t - e.tc) <= (e.n / 2 + 0.5) * e.dwell);
  const parts = [];
  if (rf) parts.push(rf.role === "excite" ? `RF excitation (${rf.flip}°): k is set to 0` : "180° refocusing pulse: k jumps to −k");
  if (active.length) parts.push(`gradients on: ${[...new Set(active)].join(", ")} (Gx ${g[0].toFixed(1)}, Gy ${g[1].toFixed(1)}, Gz ${g[2].toFixed(1)} mT/m)`);
  if (adc) parts.push(`ADC sampling line ${adc.row}`);
  $("kNote").textContent = parts.length ? parts.join(" · ") : "No gradients or RF at this moment.";
}

function renderInfo() {
  const i = scan.info, scanSec = (scan.tr * scan.shots.length) / 1000;
  const items = [
    ["TE", scan.te !== null ? `${scan.te.toFixed(2)} ms` : "—"], ["TR", `${scan.tr.toFixed(0)} ms`],
    ["Readout gradient", `${i.gRead.toFixed(2)} mT/m`], ["Sample spacing", `${(i.dwell * 1000).toFixed(1)} µs`],
    ["Readout duration", `${(i.dwell * i.nx).toFixed(2)} ms`],
  ];
  if (i.minTE !== undefined) items.push(["Minimum TE", `${i.minTE.toFixed(2)} ms`]);
  if (i.esp !== undefined) items.push(["Echo spacing", `${i.esp.toFixed(2)} ms`]);
  if (scan.eff !== undefined) items.push(["Effective echo", `${scan.eff + 1} of ${state.ETL}`]);
  items.push(["TRs to fill k-space", `${scan.shots.length}`], ["Scan time", `${Math.floor(scanSec / 60)}:${String(Math.round(scanSec % 60)).padStart(2, "0")}`]);
  $("info").innerHTML = items.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
  $("messages").innerHTML = scan.errors.map((e) => `<div class="alert">${e}. The sequence is drawn at the nearest possible value.</div>`).join("");
}

function renderFrame(forceRecon = false) {
  renderCursor(); drawKspace(); drawRecon(forceRecon); renderStatus();
}
function renderAll() { renderInfo(); renderDiagram(); renderFrame(true); }

// ---- playback ----
function skipIdle(shot, t) {
  if (!geom || geom.t0 !== 0) return t; // only in the whole-TR view, where the breaks are known
  const seg = geom.axis.segments.find((s) => s.compressed && t >= s.t0 && t < s.t1);
  return seg ? seg.t1 : t;
}

function advance(dtSec) {
  const sp = $("speed").value, shot = shotNow();
  const activeMs = shot.activeEnd;
  const rate = sp === "tr1" ? activeMs : sp === "tr10" ? 10 * activeMs : Number(sp); // ms of sequence per second
  play.t = skipIdle(shot, play.t + dtSec * rate);
  if (play.t >= shot.activeEnd) play.t = shot.seq.tr; // nothing else happens in this TR
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
