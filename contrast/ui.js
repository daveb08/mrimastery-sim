import {
  computeModel, defaultParams, trRange, sequenceControls, SEQUENCES, FIELDS, TISSUE_NAMES,
  PARTIAL_FOURIER, PARTIAL_FOURIER_SEQUENCES, PROTOCOL_PRESETS, TISSUES_BASE, GRE_MIN_TE_MS,
} from "./physics.js";
import { meterFraction, formatTime, inPlanePixel, percentChange, formatPercent, meterValues, METERS } from "./meters.js";
import { sweepSpec, sweep } from "./curves.js";
import { draw, layout, axisStyle, textScale } from "../shared/plot.js";
import { createPhantom } from "../phantom/phantom.js";
import { drawPulseSequence, psdParams } from "./psd.js";
import { psdToSvg } from "./psd_svg.js";
import {
  PLANES, CENTER, POS_RANGE, normalAxis, patientToScreen, screenToPatient, clampPos, sampleSlice, renderPlane, autoWindowLevel,
  composeSignal, labelSignals, addGhost, toRgba,
} from "./image.js";
import {
  fillMask, partialFourierMask, partialFourierRows, combineMasks, kspaceOf, reconstruct, logMagnitude, toInferno, autoWindowLevelObject,
} from "./kspace.js";
import { acquisitionPlan, maskAt, progressLabel, stepProgress, trajectory } from "./acquisition.js";
import { explorerUrl } from "../kspace/settings.js";
import { PROTOCOL_DEFAULTS, protocolMode, protocolTiming, middleSliceFactors } from "./protocol.js";

const $ = (id) => document.getElementById(id);
const COLOR = Object.fromEntries(TISSUE_NAMES.map((n) => [n, TISSUES_BASE[n].color]));
const GEOMETRY_KEEP = ["freqMatrix", "phaseMatrix", "fovRead", "fovPhase", "sliceMm", "NEX", "BW", "fatSat", "pfFraction",
  ...Object.keys(PROTOCOL_DEFAULTS)];

let p = { ...PROTOCOL_DEFAULTS, ...freshStart(defaultParams("FSE", "3.0T")) };
p.fovRead = p.fovPhase = 280; // a head-sized FOV; the original default (400 mm) shows the whole upper body
let baseline = null; // pinned meter values
let model = null;
let timing = null; // the latest protocolTiming(p)

// Parameters that follow from others, applied before every computation.
function normalize(q) {
  if (q.seq === "EPI (single-shot)") q.ETL = q.phaseMatrix;
  if (q.seq === "bSSFP") q.TE = q.TR / 2;
  if (q.seq === "DIR") q.TI = q.TI1;
  if (q.seq === "MPRAGE") q.sliceMm = 1.0; else q.nPartitions = 1;
  if (!PARTIAL_FOURIER_SEQUENCES.includes(q.seq)) q.pfFraction = 1.0;
  return q;
}

// ---- setup row ----
function fillSelect(el, options, value) {
  el.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  el.value = value;
}
fillSelect($("seq"), SEQUENCES.map((s) => ({ value: s, label: s })), p.seq);
fillSelect($("field"), FIELDS.map((f) => ({ value: f, label: f.replace("T", " T") })), p.field);
fillSelect($("preset"), [{ value: "", label: "Choose a protocol…" },
  ...Object.keys(PROTOCOL_PRESETS).filter((k) => k !== "Custom").map((k) => ({ value: k, label: k }))], "");

function clearPreset() { $("preset").value = ""; }

// The original's default GRE TE (5 ms) is below the 7 ms minimum, so a fresh GRE start would open with an error.
function freshStart(q) {
  if (q.seq === "GRE") q.TE = Math.max(q.TE, GRE_MIN_TE_MS);
  return q;
}

$("seq").addEventListener("change", () => {
  const keep = Object.fromEntries(GEOMETRY_KEEP.map((k) => [k, p[k]]));
  p = freshStart({ ...defaultParams($("seq").value, p.field), ...keep });
  if (p.seq === "MPRAGE") p.nPartitions = 176;
  clearPreset(); buildControls(); update();
});
$("field").addEventListener("change", () => {
  p.field = $("field").value;
  const r = trRange(p.seq, p.field);
  p.TR = Math.min(r.max, Math.max(r.min, p.TR));
  clearPreset(); buildControls(); update();
});
$("preset").addEventListener("change", () => {
  const key = $("preset").value;
  if (!key) return;
  p = { ...PROTOCOL_DEFAULTS, ...defaultParams(null, p.field, key) }; // protocol presets are single-slice
  $("seq").value = p.seq;
  buildControls(); update();
});

// ---- controls ----
function slider(key, label, min, max, step, fmt = (v) => v) {
  const id = `c_${key}`;
  const wrap = document.createElement("div");
  wrap.className = "ctl";
  wrap.innerHTML = `<label for="${id}">${label} <span class="v" id="${id}V"></span></label>`
    + `<input id="${id}" type="range" min="${min}" max="${max}" step="${step}">`;
  const input = wrap.querySelector("input");
  const out = wrap.querySelector(".v");
  input.value = p[key];
  out.textContent = fmt(Number(input.value));
  input.addEventListener("input", () => {
    p[key] = Number(input.value);
    out.textContent = fmt(p[key]);
    clearPreset(); update();
  });
  return wrap;
}

function checkbox(key, label) {
  const wrap = document.createElement("div");
  wrap.className = "check";
  wrap.innerHTML = `<input type="checkbox" id="c_${key}"><label for="c_${key}" style="margin:0;color:var(--text)">${label}</label>`;
  const input = wrap.querySelector("input");
  input.checked = !!p[key];
  input.addEventListener("change", () => { p[key] = input.checked; clearPreset(); update(); });
  return wrap;
}

const note = (id) => { const d = document.createElement("p"); d.className = "caption"; d.id = id; return d; };

function buildControls() {
  normalize(p);
  const contrast = $("paneContrast"), geometry = $("paneGeometry"), signal = $("paneSignal");
  [contrast, geometry, signal].forEach((el) => (el.innerHTML = ""));

  const r = trRange(p.seq, p.field);
  contrast.append(slider("TR", p.seq === "bSSFP" ? "TR (ms) — TE is fixed at TR/2" : "TR (ms)", r.min, r.max, r.step));
  for (const c of sequenceControls(p.seq)) {
    if (p.seq === "EPI (single-shot)" && c.key !== "TE") continue;
    contrast.append(slider(c.key, c.label, c.min, c.max, c.step));
  }
  if (p.seq === "DIR") p.TI = p.TI1;
  contrast.append(note("timingNote"));

  geometry.append(slider("freqMatrix", "Frequency matrix (px)", 64, 512, 32));
  geometry.append(slider("phaseMatrix", "Phase matrix (px)", 64, 512, 32));
  geometry.append(slider("fovRead", "FOV read (mm)", 180, 400, 10));
  geometry.append(slider("fovPhase", "FOV phase (mm)", 180, 400, 10));
  if (p.seq === "MPRAGE") geometry.append(slider("nPartitions", "Partitions (3D slab)", 32, 256, 8));
  else geometry.append(slider("sliceMm", "Slice thickness (mm)", 1, 10, 1));
  geometry.append(note("geomNote"));
  if (protocolMode(p.seq) !== "3d") buildSliceControls(geometry);

  signal.append(slider("NEX", "NEX (averages)", 1, 8, 1));
  signal.append(slider("BW", "Bandwidth (Hz/px)", 50, 500, 10));
  signal.append(checkbox("fatSat", "Fat saturation"));
  if (p.seq === "EPI (single-shot)") signal.append(slider("ghostPct", "N/2 ghost (%)", 0, 40, 1));
  if (PARTIAL_FOURIER_SEQUENCES.includes(p.seq)) {
    const wrap = document.createElement("div");
    wrap.className = "ctl";
    wrap.innerHTML = `<label for="c_pf">Partial Fourier</label><select id="c_pf"></select>`;
    const sel = wrap.querySelector("select");
    fillSelect(sel, Object.keys(PARTIAL_FOURIER).map((k) => ({ value: k, label: k })),
      Object.keys(PARTIAL_FOURIER).find((k) => Math.abs(PARTIAL_FOURIER[k] - p.pfFraction) < 1e-9) || "8/8 (Full)");
    sel.addEventListener("change", () => { p.pfFraction = PARTIAL_FOURIER[sel.value]; clearPreset(); update(); });
    signal.append(wrap);
  }
  signal.append(note("signalNote"));
}

// Slice controls. The ones the slice count hides are built hidden, so dragging Slices across 1 only toggles `hidden`
// (syncSliceControls) and the slider being dragged keeps focus.
function selectControl(key, label, options) {
  const wrap = document.createElement("div");
  wrap.className = "ctl";
  wrap.innerHTML = `<label for="c_${key}">${label}</label><select id="c_${key}">`
    + `${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`;
  const sel = wrap.querySelector("select");
  sel.value = String(p[key]);
  sel.addEventListener("change", () => { p[key] = sel.value === "auto" || isNaN(sel.value) ? sel.value : Number(sel.value); clearPreset(); update(); });
  return wrap;
}

function buildSliceControls(geometry) {
  const wraps = {
    slices: slider("slices", "Slices", 1, 32, 1),
    gapPct: slider("gapPct", "Slice gap (% of thickness)", 0, 100, 10),
    sliceOrder: selectControl("sliceOrder", "Order", [["interleaved", "Interleaved"], ["sequential", "Sequential"]]),
    concatenations: selectControl("concatenations", "Concatenations", [["auto", "Auto"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]]),
    crossTalkOn: checkbox("crossTalkOn", "Include cross-talk (Bloch-simulated slice profiles)"),
  };
  for (const [k, w] of Object.entries(wraps)) { w.dataset.key = k; geometry.append(w); }
  geometry.append(note("sliceNote"));
}

function syncSliceControls() {
  const g = $("paneGeometry");
  if (!g.querySelector('[data-key="slices"]')) return;
  const mode = protocolMode(p.seq), many = timing.N > 1;
  const show = {
    slices: true, gapPct: many, sliceOrder: many, concatenations: many && mode === "packed", crossTalkOn: many && mode === "packed",
  };
  for (const [k, on] of Object.entries(show)) g.querySelector(`[data-key="${k}"]`).hidden = !on;
  const sl = $("c_slices"), single = mode === "single";
  sl.disabled = single;
  sl.value = single ? 1 : p.slices;
  $("c_slicesV").textContent = sl.value;
  $("c_gapPctV").textContent = `${(p.gapPct * p.sliceMm / 100).toFixed(1)} mm`;
  $("sliceNote").textContent = single
    ? "Multi-slice inversion recovery (interleaved inversions, CSF nulling and concatenations) is coming next."
    : p.seq === "bSSFP" ? "bSSFP keeps one slice in steady state at a time, so slices are acquired one after another."
    : p.seq === "DWI" ? "Slice timing uses the EPI readout; the diffusion gradients are not timed here." : "";
}

// ---- tabs ----
function wireTabs(pairs) {
  for (const [btn, pane] of pairs) {
    $(btn).addEventListener("click", () => {
      for (const [b, pn] of pairs) { $(b).setAttribute("aria-selected", b === btn); $(pn).hidden = pn !== pane; }
      Plotly.Plots.resize($(pane)); // plots drawn while hidden have no width
      if (model) renderPlots(model); // draw the plots of a tab that was hidden
    });
  }
}
wireTabs([["tabBtnContrast", "paneContrast"], ["tabBtnGeometry", "paneGeometry"], ["tabBtnSignal", "paneSignal"]]);
wireTabs([["tabBtnBars", "tabBars"], ["tabBtnCurves", "tabCurves"]]);

// ---- rendering ----
function meterHtml(kind, big, sub, current) {
  const m = METERS[kind];
  const delta = baseline ? formatPercent(percentChange(current, baseline[kind])) : "";
  return `<div class="meter" title="${m.scaleNote}"><div class="label">${m.label}</div><div class="value">${big}</div>`
    + `<div class="sub">${sub}</div><div class="bar"><i style="width:${(meterFraction(kind, current) * 100).toFixed(1)}%"></i></div>`
    + `<div class="delta">${delta ? "vs pinned: " + delta : ""}</div></div>`;
}

function sliceMeterText() {
  if (timing.N <= 1) return "";
  const C = timing.concatenations;
  return timing.mode === "sequential" ? `Slices: ${timing.N} · one after another`
    : `Slices: ${timing.N} (max ${timing.maxSlices} per TR) · ${C} concatenation${C > 1 ? "s" : ""}`;
}

function renderMeters(m) {
  const v = meterValues(m);
  const [px, py] = m.pixelMm;
  $("meters").innerHTML =
    meterHtml("snr", v.snr.toFixed(1), `GM ${m.snrs.GM.toFixed(1)} · CSF ${m.snrs.CSF.toFixed(1)}`, v.snr)
    + meterHtml("resolution", `${v.resolution.toFixed(2)} mm`, `${px.toFixed(2)} × ${py.toFixed(2)} mm, voxel ${m.voxelVol.toFixed(1)} mm³`, v.resolution)
    + meterHtml("time", formatTime(m.scanSec), `${m.scanSec.toFixed(0)} s total${timing.N > 1 ? "<br>" + sliceMeterText() : ""}`, v.time)
    + `<div class="baseline-row"><button class="btn" id="pin">${baseline ? "Clear pinned baseline" : "Pin current as baseline"}</button>`
    + `<span>${baseline ? "Percent changes compare with the pinned settings." : "Pin a setting, then change others to see the trade-off."}</span></div>`;
  $("pin").addEventListener("click", () => { baseline = baseline ? null : meterValues(model); renderMeters(model); });
}

function renderChips(m) {
  const t = m.cnr;
  $("chips").innerHTML = [
    ["CNR WM–GM", t.wmGm.toFixed(1)], ["WM–CSF", t.wmCsf.toFixed(1)], ["GM–CSF", t.gmCsf.toFixed(1)],
    [m.keyMetric.label, m.keyMetric.value],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
}

function renderMessages(m) {
  $("messages").innerHTML = m.timing.messages
    .map((x) => `<div class="${x.level === "error" ? "alert" : "warn"}">${x.text}</div>`).join("")
    + timing.messages.map((x) => `<div class="info">${x}</div>`).join("");
}

function renderNotes(m) {
  const t = m.timing, parts = [];
  if (t.espMs !== undefined) parts.push(`Echo spacing ${t.espMs.toFixed(1)} ms`);
  if (t.minTR !== undefined) parts.push(`minimum TR ${Math.trunc(t.minTR)} ms`);
  if (t.minTE !== undefined) parts.push(`minimum TE ${t.minTE.toFixed(0)} ms`);
  if (t.fixedTE !== undefined) parts.push(`TE = ${t.fixedTE.toFixed(1)} ms`);
  if (t.readoutTrainMs !== undefined) parts.push(`readout train ${t.readoutTrainMs} ms`);
  if ($("timingNote")) $("timingNote").textContent = parts.join(" · ");
  const [px, py] = m.pixelMm;
  if ($("geomNote")) $("geomNote").textContent = `Pixel ${px.toFixed(2)} × ${py.toFixed(2)} mm, voxel ${m.voxelVol.toFixed(2)} mm³`
    + (p.seq === "EPI (single-shot)" ? ". Single-shot EPI: echo train length equals the phase matrix." : "")
    + (m.is3d ? ". For 3D MPRAGE the partitions set the voxel size, not the noise." : "");
  if ($("signalNote")) $("signalNote").textContent = "Noise depends only on bandwidth, NEX and field strength. "
    + `Noise floor ${m.noiseFloor.toFixed(5)}.`;
}

// Titles sit at the left, clear of the Plotly modebar at the top right.
const TITLE = (text) => ({ text, font: { size: 12 }, x: 0.01, xanchor: "left" });

const bar = (id, title, vals, fmt) => draw(id, [{
  type: "bar", x: TISSUE_NAMES, y: TISSUE_NAMES.map((n) => vals[n]),
  marker: { color: TISSUE_NAMES.map((n) => COLOR[n]) },
  text: TISSUE_NAMES.map((n) => fmt(vals[n])), textposition: "outside", cliponaxis: false,
  hovertemplate: "%{x}: %{y}<extra></extra>",
}], layout({ title: TITLE(title), showlegend: false, uirevision: undefined,
  yaxis: axisStyle({ rangemode: "tozero" }), xaxis: axisStyle(), margin: { l: 48, r: 10, t: 34, b: 30 } }));

function renderPlots(m) {
  if (!$("tabBars").hidden) {
    bar("plotSignal", "Signal (scaled by voxel volume)", m.signals, (v) => v.toFixed(2));
    bar("plotSnr", "SNR = signal / noise", m.snrs, (v) => v.toFixed(1));
  }
  if (!$("tabCurves").hidden) {
    const { first, second } = sweepSpec(p.seq, p);
    [["plotCurve1", first], ["plotCurve2", second]].forEach(([id, spec]) => {
      const { x, y } = sweep(p.seq, p, spec.key, spec.max);
      const now = spec.key === "TR" && p.seq === "bSSFP" ? p.TR : p[spec.key];
      draw(id, TISSUE_NAMES.map((n) => ({ type: "scatter", mode: "lines", x, y: y[n], name: n, line: { color: COLOR[n], width: 2 } })),
        layout({ title: TITLE(`Signal vs ${spec.label}`), xaxis: axisStyle({ title: spec.label }),
          yaxis: axisStyle({ title: "Relative signal", rangemode: "tozero" }), uirevision: undefined,
          margin: { l: 52, r: 10, t: 34, b: 42 },
          shapes: [{ type: "line", x0: now, x1: now, yref: "paper", y0: 0, y1: 1, line: { color: "#fff", dash: "dash", width: 1 } }] }));
    });
  }
}

function renderPsd(m) {
  const fig = drawPulseSequence(psdParams(p, m));
  $("psd").innerHTML = fig ? psdToSvg(fig, { fontScale: 1.25 * textScale() }) : "";
  $("psdNote").textContent = fig ? "Schematic: the spacing between events is illustrative; the labels give the real TR, TE and TI."
    : `${p.seq} has no pulse-sequence diagram yet.`;
}

function update() {
  normalize(p);
  timing = protocolTiming(p);
  model = computeModel(p, { scanFactor: timing.scanFactor, crossTalk: middleSliceFactors(p) });
  syncSliceControls();
  renderMeters(model); renderChips(model); renderMessages(model); renderNotes(model); renderPlots(model); renderPsd(model); scheduleImages();
}

// ---- phantom images ----
const ORIENT = {
  axial: { top: "A", bottom: "P", left: "R", right: "L", name: "Axial", axis: "z" },
  coronal: { top: "S", bottom: "I", left: "R", right: "L", name: "Coronal", axis: "y" },
  sagittal: { top: "S", bottom: "I", left: "A", right: "P", name: "Sagittal", axis: "x" },
};
const pos = { x: 5, y: 0, z: 14 };
let phantom = createPhantom({ seed: 1, sulcalDepthMm: 14, lesions: false });
const sampleCache = {}; // plane -> { key, sampled }
const wl = { window: 1, level: 0.5 };
const views = {};

for (const plane of PLANES) {
  const o = ORIENT[plane], ax = o.axis;
  const el = document.createElement("div");
  el.innerHTML = `<div class="vhead"><span>${o.name}</span><span id="vpos_${plane}"></span></div>`
    + `<div class="frame" id="frame_${plane}"><canvas id="cv_${plane}" width="1" height="1"></canvas>`
    + `<i class="xh v"></i><i class="xh h"></i>`
    + `<span class="ol" style="top:2px;left:50%;transform:translateX(-50%)">${o.top}</span>`
    + `<span class="ol" style="bottom:2px;left:50%;transform:translateX(-50%)">${o.bottom}</span>`
    + `<span class="ol" style="left:3px;top:50%">${o.left}</span><span class="ol" style="right:3px;top:50%">${o.right}</span></div>`
    + `<div class="vpos"><input type="range" id="slice_${plane}" min="${POS_RANGE[ax][0]}" max="${POS_RANGE[ax][1]}" step="1" aria-label="${o.name} slice position (mm)"></div>`;
  $("views").append(el);
  views[plane] = { canvas: $(`cv_${plane}`), frame: $(`frame_${plane}`), vline: el.querySelector(".xh.v"), hline: el.querySelector(".xh.h") };
  $(`slice_${plane}`).addEventListener("input", (e) => { pos[ax] = Number(e.target.value); scheduleImages(); });
  const pick = (e) => {
    const r = views[plane].frame.getBoundingClientRect();
    const [cr, cu] = CENTER[plane];
    const right = cr + ((e.clientX - r.left) / r.width - 0.5) * p.fovRead;
    const up = cu + (0.5 - (e.clientY - r.top) / r.height) * p.fovPhase;
    Object.assign(pos, clampPos(screenToPatient(plane, right, up)));
    scheduleImages();
  };
  let dragging = false;
  views[plane].frame.addEventListener("pointerdown", (e) => { dragging = true; views[plane].frame.setPointerCapture(e.pointerId); pick(e); });
  views[plane].frame.addEventListener("pointermove", (e) => { if (dragging) pick(e); });
  views[plane].frame.addEventListener("pointerup", () => { dragging = false; });
}

function syncWlControls(auto) {
  const w = $("wlWindow"), l = $("wlLevel");
  w.max = Math.max(2, 4 * auto.window).toFixed(2); l.max = Math.max(2, 3 * auto.level + 2 * auto.window).toFixed(2);
  w.value = wl.window; l.value = wl.level;
  $("wlWindowV").textContent = wl.window.toFixed(2); $("wlLevelV").textContent = wl.level.toFixed(2);
  w.disabled = l.disabled = $("autoWl").checked;
}
$("autoWl").addEventListener("change", scheduleImages);
for (const id of ["wlWindow", "wlLevel"]) $(id).addEventListener("input", () => {
  $("autoWl").checked = false; wl.window = Number($("wlWindow").value); wl.level = Number($("wlLevel").value); scheduleImages();
});
$("lesions").addEventListener("change", () => {
  phantom = createPhantom({ seed: 1, sulcalDepthMm: 14, lesions: $("lesions").checked });
  for (const k of Object.keys(sampleCache)) delete sampleCache[k];
  scheduleImages();
});

let imagePending = false;
function scheduleImages() {
  if (imagePending) return;
  imagePending = true;
  requestAnimationFrame(() => { imagePending = false; renderImages(); });
}

function renderImages() {
  if (!model) return;
  const auto = autoWindowLevel(p, model);
  if ($("autoWl").checked) { wl.window = auto.window; wl.level = auto.level; }
  syncWlControls(auto);
  const t0 = performance.now();
  for (const plane of PLANES) {
    const ax = normalAxis(plane), v = views[plane];
    const spec = { nx: p.freqMatrix, ny: p.phaseMatrix, fovRead: p.fovRead, fovPhase: p.fovPhase, thicknessMm: p.sliceMm };
    const key = [pos[ax], spec.nx, spec.ny, spec.fovRead, spec.fovPhase, spec.thicknessMm].join("|");
    if (sampleCache[plane]?.key !== key) sampleCache[plane] = { key, sampled: sampleSlice(phantom, plane, pos[ax], spec) };
    const rgba = renderPlane(sampleCache[plane].sampled, model, p, { window: wl.window, level: wl.level, noiseSeed: 12345 });
    v.canvas.width = spec.nx; v.canvas.height = spec.ny;
    v.canvas.getContext("2d").putImageData(new ImageData(rgba, spec.nx, spec.ny), 0, 0);
    v.frame.style.aspectRatio = `${p.fovRead} / ${p.fovPhase}`;
    const [cr, cu] = CENTER[plane], [r, u] = patientToScreen(plane, pos);
    v.vline.style.left = `${((r - (cr - p.fovRead / 2)) / p.fovRead) * 100}%`;
    v.hline.style.top = `${((cu + p.fovPhase / 2 - u) / p.fovPhase) * 100}%`;
    $(`slice_${plane}`).value = pos[ax];
    $(`vpos_${plane}`).textContent = `${ax} = ${pos[ax]} mm`;
  }
  $("viewNote").textContent = `${p.freqMatrix} × ${p.phaseMatrix} matrix over ${p.fovRead} × ${p.fovPhase} mm, ${p.seq === "MPRAGE" ? "1" : p.sliceMm} mm slices. `
    + "Click or drag an image to move the other two slices. Muscle and lesion signals use illustrative tissue values. "
    + `Rendered in ${(performance.now() - t0).toFixed(0)} ms.`;
  renderKspace();
}

// ---- k-space tab: the axial slice's k-space at the acquired matrix, and the image rebuilt from the filled part ----
const kwl = { window: 1, level: 0.5 };

function showViewerTab(which) {
  const k = which === "kspace";
  $("tabBtnImages").setAttribute("aria-selected", !k); $("tabBtnKspace").setAttribute("aria-selected", k);
  $("tabImages").hidden = k; $("tabKspace").hidden = !k;
  if (k) renderKspace();
}
$("tabBtnImages").addEventListener("click", () => showViewerTab("images"));
$("tabBtnKspace").addEventListener("click", () => showViewerTab("kspace"));

let kPending = false;
function scheduleKspace() {
  if (kPending) return;
  kPending = true;
  requestAnimationFrame(() => { kPending = false; renderKspace(); });
}
for (const el of document.querySelectorAll("input[name=kRegion]")) el.addEventListener("change", scheduleKspace);
for (const id of ["kKy", "kKx"]) $(id).addEventListener("input", scheduleKspace);
$("kAutoWl").addEventListener("change", scheduleKspace);
for (const id of ["kWindow", "kLevel"]) $(id).addEventListener("input", () => {
  $("kAutoWl").checked = false; kwl.window = Number($("kWindow").value); kwl.level = Number($("kLevel").value); scheduleKspace();
});

function paint(canvas, rgba, nx, ny) {
  canvas.width = nx; canvas.height = ny;
  canvas.getContext("2d").putImageData(new ImageData(rgba, nx, ny), 0, 0);
}

// Current k-space of the noise-free axial image (including the EPI ghost), cached while nothing that shapes it changes.
let kCache = { key: "", K: null };
function currentKspace() {
  const { sampled, key: sKey } = sampleCache.axial, { nx, ny } = sampled;
  const lut = labelSignals(model, p);
  const key = [sKey, Array.from(lut).join(","), p.seq, p.ghostPct].join("|");
  if (kCache.key !== key) {
    let v = composeSignal(sampled, lut);
    if (p.seq === "EPI (single-shot)") v = addGhost(v, nx, ny, (p.ghostPct ?? 0) / 100);
    kCache = { key, K: kspaceOf(v, nx, ny) };
  }
  return { K: kCache.K, nx, ny };
}

// ---- acquisition animation: fill k-space in the sequence's own order ----
// anim.view is the plan whose trajectory is drawn (the simplified 16-line one, or the real one); anim.full always drives
// the k-space fill and the reconstruction, at the same fraction of the scan.
const ANIM_SECONDS = 9; // one pass at 1x speed
const anim = { active: false, playing: false, full: null, view: null, key: "", t: 0, lastT: 0 };
const planKey = () => [p.seq, p.freqMatrix, p.phaseMatrix, p.pfFraction, p.ETL, model?.timing?.effIdx, p.TR, p.NEX].join("|");
const viewLength = () => anim.view.readouts.length;

function buildPlans() {
  const { nx, ny } = sampleCache.axial.sampled;
  const opts = { effIdx: model.timing.effIdx ?? 0, scanSec: model.scanSec };
  anim.full = acquisitionPlan(p, nx, ny, opts);
  anim.view = $("kSimple").checked ? acquisitionPlan(p, nx, ny, { ...opts, simple: true }) : anim.full;
}

function setAnimControls() {
  const locked = anim.active;
  for (const el of document.querySelectorAll("input[name=kRegion]")) el.disabled = locked;
  $("kKy").disabled = $("kKx").disabled = locked;
  const midway = anim.active && anim.t > 0 && anim.t < viewLength();
  $("kPlay").textContent = anim.playing ? "❚❚ Pause" : midway ? "▶ Resume" : "▶ Play acquisition";
  $("kReset").disabled = $("kProgress").disabled = !locked;
  $("kBack").disabled = !locked || anim.t <= 0;
  $("kFwd").disabled = locked && anim.t >= viewLength();
}

function startAnim() {
  buildPlans();
  anim.key = planKey();
  anim.active = true;
  anim.t = 0;
}

function stopAnim() {
  anim.active = anim.playing = false;
  anim.full = anim.view = null;
  setAnimControls();
}

function tick(time) {
  if (!anim.playing) return;
  const dt = anim.lastT ? (time - anim.lastT) / 1000 : 0;
  anim.lastT = time;
  const n = viewLength();
  anim.t = Math.min(n, anim.t + (dt * n * Number($("kSpeed").value)) / ANIM_SECONDS);
  if (anim.t >= n) anim.playing = false;
  renderKspace();
  if (anim.playing) requestAnimationFrame(tick);
  else setAnimControls();
}

$("kPlay").addEventListener("click", () => {
  if (anim.playing) { anim.playing = false; setAnimControls(); return; }
  if (!anim.active || anim.t >= viewLength()) startAnim();
  anim.playing = true; anim.lastT = 0;
  setAnimControls();
  requestAnimationFrame(tick);
});
$("kReset").addEventListener("click", () => { stopAnim(); renderKspace(); });
$("kProgress").addEventListener("input", () => {
  anim.playing = false; anim.t = (Number($("kProgress").value) / 1000) * viewLength(); renderKspace();
});
for (const [id, dir] of [["kBack", -1], ["kFwd", 1]]) {
  $(id).addEventListener("click", () => {
    if (!anim.active) startAnim();
    anim.playing = false;
    anim.t = stepProgress(anim.view, anim.t, dir);
    renderKspace();
  });
}
$("kSimple").addEventListener("change", () => {
  if (!anim.active) return;
  const frac = anim.t / viewLength();
  buildPlans();
  anim.t = frac * viewLength();
  renderKspace();
});

// Draw the trajectory over the k-space panel: readouts so far, EPI blips (solid) or jumps between lines (dashed),
// the line being read (bright) and a cursor with an arrowhead pointing along the read direction.
function drawTrajectory(plan, t) {
  const svg = $("kTraj");
  if (!plan) { svg.innerHTML = ""; return; }
  const W = svg.clientWidth || 1, H = svg.clientHeight || 1;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const { segments, dot } = trajectory(plan, t);
  const d = { readout: "", current: "", blip: "", jump: "" };
  for (const s of segments) d[s.kind] += `M${(s.x0 * W).toFixed(1)},${(s.y0 * H).toFixed(1)}L${(s.x1 * W).toFixed(1)},${(s.y1 * H).toFixed(1)}`;
  // a coarse (simplified) path is drawn bold, with an arrowhead mid-way along every finished line to show its direction
  const coarse = plan.ny <= 64;
  const w = coarse ? 2.2 : 0.8, path = coarse ? "#d6f1ff" : "rgba(120,205,255,.55)";
  let out = `<path d="${d.readout}" stroke="${path}" stroke-width="${w}" fill="none"/>`
    + `<path d="${d.blip}" stroke="${path}" stroke-width="${w}" fill="none"/>`
    + `<path d="${d.jump}" stroke="rgba(220,220,220,${coarse ? 0.55 : 0.4})" stroke-width="${coarse ? 1.3 : 0.8}" stroke-dasharray="5 4" fill="none"/>`
    + `<path d="${d.current}" stroke="#7fd8ff" stroke-width="${coarse ? 3.5 : 2.5}" fill="none"/>`;
  if (coarse) {
    for (const s of segments) {
      if (s.kind !== "readout") continue;
      const dir = Math.sign(s.x1 - s.x0), x = ((s.x0 + s.x1) / 2) * W, y = s.y0 * H, a = 7 * dir;
      out += `<polygon points="${(x + a).toFixed(1)},${y.toFixed(1)} ${(x - a).toFixed(1)},${(y - 5).toFixed(1)} ${(x - a).toFixed(1)},${(y + 5).toFixed(1)}" fill="#d6f1ff"/>`;
    }
  }
  if (dot) {
    const x = dot.x * W, y = dot.y * H, a = 9 * dot.dir;
    out += `<polygon points="${(x + a).toFixed(1)},${y.toFixed(1)} ${(x - a * 0.2).toFixed(1)},${(y - 6).toFixed(1)} ${(x - a * 0.2).toFixed(1)},${(y + 6).toFixed(1)}" fill="#ffffff" stroke="#1a1a1a" stroke-width="1"/>`
      + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#7fd8ff" stroke="#ffffff" stroke-width="1.2"/>`;
  }
  svg.innerHTML = out;
}

function renderKspace() {
  if (!model || $("tabKspace").hidden || !sampleCache.axial) return;
  const t0 = performance.now();
  if (anim.active && anim.key !== planKey()) stopAnim(); // the scan changed: back to the slider view
  const { K, nx, ny } = currentKspace();
  let mask, note;
  const opts = { region: document.querySelector("input[name=kRegion]:checked").value, kyPct: +$("kKy").value, kxPct: +$("kKx").value,
    centric: p.seq === "FSE" };
  const { first } = partialFourierRows(ny, p.pfFraction);
  if (anim.active) {
    const n = viewLength(), frac = anim.t / n, full = anim.full, tFull = frac * full.readouts.length;
    mask = maskAt(full, tFull);
    $("kProgress").value = Math.round(frac * 1000);
    $("kClock").textContent = `${formatTime(frac * full.passSec)} of ${formatTime(full.passSec)}`
      + (full.nex > 1 ? ` (one of ${full.nex} averages)` : "") + ` · ${progressLabel(full, tFull)}`;
    $("kOrder").textContent = anim.view.label + "."
      + (anim.view !== full ? ` The trajectory is drawn on a simplified ${anim.view.ny}-line grid; k-space and the image use the full ${full.ny} lines.` : "");
    note = (first > 0 ? `Partial Fourier: the top ${first} ky rows are never acquired. ` : "")
      + (tFull < full.readouts.length ? "The line being read is highlighted in blue. " : "Acquisition complete. ")
      + "Press Reset to return to the fill sliders.";
    drawTrajectory(anim.view, anim.t);
    $("kCanvas").style.filter = anim.view !== full ? "brightness(.45)" : ""; // let the simplified path stand out
  } else {
    const fill = fillMask(nx, ny, opts);
    mask = combineMasks(fill.mask, partialFourierMask(nx, ny, p.pfFraction));
    $("kClock").textContent = "";
    $("kOrder").textContent = "";
    drawTrajectory(null);
    $("kCanvas").style.filter = "";
    note = `${fill.rows.length} of ${ny} ky rows and ${fill.cols.length} of ${nx} kx columns selected. `
      + (first > 0 ? `Partial Fourier: the top ${first} ky rows are never acquired and are zero-filled. ` : "")
      + "Noise is added at the filled points only, scaled so a full acquisition matches the images. "
      + (opts.region === "Edges" ? "With edges only, the image is faint; adjust window/level if needed. " : "");
  }
  const rec = reconstruct(K, mask, nx, ny, model.noiseFloor);
  const auto = autoWindowLevelObject(rec);
  if ($("kAutoWl").checked) { kwl.window = auto.window; kwl.level = auto.level; }
  const w = $("kWindow"), l = $("kLevel");
  w.max = Math.max(0.5, 4 * auto.window).toFixed(3); l.max = Math.max(0.5, 3 * auto.level + 2 * auto.window).toFixed(3);
  w.value = kwl.window; l.value = kwl.level; w.disabled = l.disabled = $("kAutoWl").checked;
  $("kWindowV").textContent = kwl.window.toFixed(3); $("kLevelV").textContent = kwl.level.toFixed(3);
  $("kKyV").textContent = `${opts.kyPct}%`; $("kKxV").textContent = `${opts.kxPct}%`;
  $("kKyLabel").textContent = opts.centric ? "ky fill (rows, phase), centric order (FSE)" : "ky fill (rows, phase)";
  const kRgba = toInferno(logMagnitude(K, mask));
  for (let i = 0; i < mask.length; i++) if (mask[i] === 2) { kRgba[4 * i] = 110; kRgba[4 * i + 1] = 200; kRgba[4 * i + 2] = 255; }
  paint($("kCanvas"), kRgba, nx, ny);
  paint($("rCanvas"), toRgba(rec, kwl.window, kwl.level), nx, ny);
  // one square per k-space sample; both panels are capped at about half the window height so the controls stay in view
  const fit = (el, aspect) => { el.style.aspectRatio = `${aspect}`; el.style.width = `min(100%, ${(42 * aspect).toFixed(2)}vh)`; el.style.margin = "0 auto"; };
  fit($("kCanvas").parentElement, nx / ny);
  fit($("rCanvas").parentElement, p.fovRead / p.fovPhase);
  $("kSize").textContent = `${nx} kx × ${ny} ky`;
  $("kExplorer").href = explorerUrl("../kspace/", p);
  $("kNote").textContent = note + ` Rendered in ${(performance.now() - t0).toFixed(0)} ms.`;
  setAnimControls();
}

// Text drawn by this page (pulse-sequence labels) follows the A / A+ / A++ control; Plotly plots redraw themselves.
window.addEventListener("textsizechange", () => { if (model) renderPsd(model); });

buildControls();
update();
