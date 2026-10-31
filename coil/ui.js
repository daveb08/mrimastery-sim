import { coilField, fieldMap, axialField, rotationY } from "./coilfields.js";
import { b1plusLinear, hardPulseResponse, larmorHz, durationFor90Ms } from "./rfexcitation.js";
import { COLORS, axisStyle, layout, draw } from "../shared/plot.js";

const $ = (id) => document.getElementById(id);
const g4 = (x) => String(+x.toPrecision(4));
const g6 = (x) => +x.toPrecision(6);
const DIRECTIONS = { "+z": [0, 0, 1], "+x": [1, 0, 0], "+y": [0, 1, 0] };
const ORANGE = "#ff8c42";

let pending = false;
let tab = "coil";
let mapCache = { key: "", value: null };
const wl = { b1: { auto: true, width: null, level: null, stats: null },
             flip: { auto: true, width: null, level: null, stats: null } };

const cachedMap = (radius, separation, tilt) => {
  const key = `${radius}|${separation}|${tilt}`;
  if (mapCache.key !== key) mapCache = { key, value: fieldMap(radius, separation, tilt) };
  return mapCache.value;
};

function percentile(sorted, q) { // numpy linear interpolation
  const pos = (q / 100) * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const rows = (flat, n) => Array.from({ length: n }, (_, i) =>
  Array.from({ length: n }, (_, j) => (Number.isFinite(flat[i * n + j]) ? flat[i * n + j] : null)));

// World-frame position of a local point (rotation about y): R @ p.
const rotatePoint = (R, p) => [0, 1, 2].map((k) => R[k][0] * p[0] + R[k][1] * p[1] + R[k][2] * p[2]);

function readControls() {
  const v = {
    pair: $("geometry").value === "pair",
    radiusCm: +$("radius").value, current: +$("current").value, turns: +$("turns").value,
    ratio: +$("spacing").value, tilt: +$("tilt").value, roiRatio: +$("roi").value,
    arrows: $("arrows").checked,
  };
  $("spacingWrap").hidden = !v.pair;
  $("radiusV").textContent = v.radiusCm; $("currentV").textContent = v.current.toFixed(1);
  $("turnsV").textContent = v.turns; $("spacingV").textContent = v.ratio.toFixed(2);
  $("tiltV").textContent = v.tilt; $("roiV").textContent = v.roiRatio.toFixed(2);
  v.radius = v.radiusCm / 100;
  v.separation = v.pair ? v.ratio * v.radius : null;
  v.centers = v.pair ? [-v.separation / 2, v.separation / 2] : [0];
  return v;
}

function physics(v) {
  const { axis, gridSize, field: unit } = cachedMap(v.radius, v.separation, v.tilt);
  const scale = v.current * v.turns;
  const field = unit.map((x) => x * scale);
  const magnitude = new Float64Array(gridSize * gridSize);
  for (let k = 0; k < magnitude.length; k++) {
    magnitude[k] = Math.hypot(field[3 * k], field[3 * k + 1], field[3 * k + 2]) * 1e6;
  }
  const center = axialField(0, v.radius, v.current, v.turns, v.separation);
  // ROI is evaluated independently of the display grid for stable metrics.
  const a = v.roiRatio * v.radius, pts = [];
  for (let i = 0; i < 41; i++) for (let j = 0; j < 41; j++) {
    const x = -a + (2 * a * j) / 40, z = -a + (2 * a * i) / 40;
    if (x * x + z * z <= a * a * (1 + 1e-12)) pts.push(x, 0, z);
  }
  const roiVectors = coilField(Float64Array.from(pts), v.radius, v.current, v.turns, v.separation, v.tilt);
  let variation = null;
  if (v.current !== 0) {
    variation = 0;
    for (let k = 0; k < roiVectors.length / 3; k++) {
      const b = Math.hypot(roiVectors[3 * k], roiVectors[3 * k + 1], roiVectors[3 * k + 2]);
      variation = Math.max(variation, Math.abs(b / Math.abs(center) - 1));
    }
    variation *= 100;
  }
  return { axis, gridSize, field, magnitude, center, roiVectors, variation, rot: rotationY(v.tilt) };
}

const wireOverlay = (v, rot, size, fill, line) => v.centers.flatMap((c) => {
  const e = [rotatePoint(rot, [-v.radius, 0, c]), rotatePoint(rot, [v.radius, 0, c])];
  const x = e.map((p) => p[0] * 100), y = e.map((p) => p[2] * 100);
  return [
    { x, y, mode: "lines", line: { color: ORANGE, dash: "dash", width: 1 }, opacity: 0.8, showlegend: false, hoverinfo: "skip" },
    { x, y, mode: "markers", marker: { color: fill, size, line: { color: line, width: 1 } }, showlegend: false, hoverinfo: "skip" },
  ];
});

const roiCircle = (v) => ({
  type: "circle", xref: "x", yref: "y", line: { color: "#fff", width: 2, dash: "dash" },
  x0: -v.roiRatio * v.radiusCm, x1: v.roiRatio * v.radiusCm, y0: -v.roiRatio * v.radiusCm, y1: v.roiRatio * v.radiusCm,
});

function mapLayout(v, title, extra = {}) {
  const extent = 2.2 * v.radiusCm;
  return layout({
    title: title ? { text: title, font: { size: 13 } } : undefined,
    xaxis: axisStyle({ title: "x (cm)", range: [-extent, extent], constrain: "domain" }),
    yaxis: axisStyle({ title: "z (cm)", range: [-extent, extent], scaleanchor: "x", scaleratio: 1 }),
    shapes: [roiCircle(v)], ...extra,
  });
}

function drawCoilTab(v, p) {
  const centerUT = Math.abs(p.center) * 1e6;
  $("mCenter").textContent = `${centerUT.toFixed(3)} µT`;
  $("mVar").textContent = p.variation == null ? "N/A (zero current)" : `${p.variation.toFixed(2)}%`;
  $("mRoi").textContent = `${(v.roiRatio * v.radiusCm).toFixed(1)} cm`;

  const axisCm = Array.from(p.axis, (a) => a * 100);
  const limit = Math.max(centerUT * 3, 0.001);
  const traces = [{
    type: "heatmap", x: axisCm, y: axisCm, z: rows(p.magnitude, p.gridSize), zmin: 0, zmax: limit,
    colorscale: "Viridis", zsmooth: false, hoverongaps: false,
    colorbar: { title: { text: "|B| (µT)", side: "right" }, thickness: 12, len: 0.85 },
  }];
  if (v.arrows && v.current !== 0) {
    const L = (4.4 * v.radiusCm) / 24; // same on-screen length as the original quiver scale
    const sx = [], sy = [], hx = [], hy = [], ang = [];
    for (let i = 0; i < p.gridSize; i += 7) for (let j = 0; j < p.gridSize; j += 7) {
      const k = 3 * (i * p.gridSize + j), bx = p.field[k], bz = p.field[k + 2], n = Math.hypot(bx, bz);
      if (!(n > 0)) continue;
      const ux = bx / n, uz = bz / n, x = axisCm[j], z = axisCm[i];
      sx.push(x - (ux * L) / 2, x + (ux * L) / 2, null); sy.push(z - (uz * L) / 2, z + (uz * L) / 2, null);
      hx.push(x + (ux * L) / 2); hy.push(z + (uz * L) / 2); ang.push((Math.atan2(ux, uz) * 180) / Math.PI);
    }
    traces.push({ x: sx, y: sy, mode: "lines", line: { color: "#fff", width: 1.5 }, showlegend: false, hoverinfo: "skip" },
      { x: hx, y: hy, mode: "markers", marker: { symbol: "arrow", size: 8, color: "#fff", angleref: "up", angle: ang },
        showlegend: false, hoverinfo: "skip" });
  }
  traces.push(...wireOverlay(v, p.rot, 9, ORANGE, "#000"));
  draw("fieldMap", traces, mapLayout(v, null));

  // 3D geometry
  const dir = [p.rot[0][2], p.rot[1][2], p.rot[2][2]];
  const loops = v.centers.map((c) => {
    const pts = Array.from({ length: 101 }, (_, k) => {
      const phi = (2 * Math.PI * k) / 100;
      return rotatePoint(p.rot, [v.radius * Math.cos(phi), v.radius * Math.sin(phi), c]).map((q) => q * 100);
    });
    return { type: "scatter3d", mode: "lines", x: pts.map((q) => q[0]), y: pts.map((q) => q[1]), z: pts.map((q) => q[2]),
             line: { color: "#d05b12", width: 7 }, showlegend: false, hoverinfo: "skip" };
  });
  const tip = dir.map((d) => d * v.radiusCm * 1.3), label = dir.map((d) => d * v.radiusCm * 1.5);
  const r3 = [-1.6 * v.radiusCm, 1.6 * v.radiusCm];
  const ax3 = (title) => ({ title, range: r3, gridcolor: "#333", backgroundcolor: "#1a1a1a", showbackground: false, zerolinecolor: "#444" });
  draw("geom3d", [
    ...loops,
    { type: "scatter3d", mode: "lines", x: [0, tip[0]], y: [0, tip[1]], z: [0, tip[2]], line: { color: "#4a8fe0", width: 6 },
      showlegend: false, hoverinfo: "skip" },
    { type: "cone", x: [tip[0]], y: [tip[1]], z: [tip[2]], u: [dir[0]], v: [dir[1]], w: [dir[2]], anchor: "tip",
      sizemode: "absolute", sizeref: v.radiusCm * 0.35, showscale: false, colorscale: [[0, "#4a8fe0"], [1, "#4a8fe0"]],
      hoverinfo: "skip" },
    { type: "scatter3d", mode: "text", x: [label[0]], y: [label[1]], z: [label[2]], text: ["+axis"],
      textfont: { color: "#4a8fe0", size: 12 }, showlegend: false, hoverinfo: "skip" },
  ], layout({
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: { xaxis: ax3("x (cm)"), yaxis: ax3("y (cm)"), zaxis: ax3("z (cm)"), aspectmode: "cube", uirevision: "geom",
             camera: { eye: { x: 1.4, y: -1.6, z: 0.9 } } },
  }));

  // Axial profile: analytic curve vs Biot-Savart samples along the coil axis.
  const distance = Array.from({ length: 301 }, (_, i) => -2 * v.radius + (4 * v.radius * i) / 300);
  const analytic = distance.map((s) => axialField(s, v.radius, v.current, v.turns, v.separation) * 1e6);
  const sampleS = distance.filter((_, i) => i % 15 === 0);
  const samplePts = Float64Array.from(sampleS.flatMap((s) => dir.map((d) => s * d)));
  const sampled = coilField(samplePts, v.radius, v.current, v.turns, v.separation, v.tilt);
  const along = sampleS.map((_, i) => (sampled[3 * i] * dir[0] + sampled[3 * i + 1] * dir[1] + sampled[3 * i + 2] * dir[2]) * 1e6);
  const roiCm = v.roiRatio * v.radiusCm;
  draw("axial", [
    { x: distance.map((s) => s * 100), y: analytic, mode: "lines", name: "Analytic field", line: { color: "#4a8fe0", width: 2 } },
    { x: sampleS.map((s) => s * 100), y: along, mode: "markers", name: "Biot–Savart samples", marker: { color: "#d05b12", size: 5 } },
  ], layout({
    xaxis: axisStyle({ title: "Distance along coil axis (cm)" }), yaxis: axisStyle({ title: "B along axis (µT)" }),
    shapes: [{ type: "rect", xref: "x", yref: "paper", x0: -roiCm, x1: roiCm, y0: 0, y1: 1, fillcolor: "rgba(0,160,0,0.15)", line: { width: 0 } }],
  }));
}

function windowLevel(key, values, units, locked) {
  const st = wl[key];
  const finite = Float64Array.from(values.filter(Number.isFinite)).sort();
  let low = 0, high = 0, fullLow = 0, fullHigh = 0;
  if (finite.length) { low = percentile(finite, 2); high = percentile(finite, 98); fullLow = finite[0]; fullHigh = finite[finite.length - 1]; }
  const minimum = units === "µT" ? 0.001 : 0.1;
  const autoWidth = Math.max(high - low, minimum);
  const autoLevel = high > low ? (high + low) / 2 : autoWidth / 2;
  st.stats = { fullLow, fullHigh, minimum };
  if ((st.auto && !locked) || st.width == null) { st.width = autoWidth; st.level = autoLevel; }
  const auto = $(`${key}_auto`), width = $(`${key}_window`), level = $(`${key}_level`);
  auto.checked = st.auto; auto.disabled = locked;
  if (+width.value !== st.width) width.value = g6(st.width);
  if (+level.value !== st.level) level.value = g6(st.level);
  width.disabled = level.disabled = st.auto || locked;
  for (const id of ["reset", "full", "standard"]) { const b = $(`${key}_${id}`); if (b) b.disabled = locked; }
  const lower = st.level - st.width / 2, upper = st.level + st.width / 2;
  $(`${key}_range`).textContent = `Displayed range: ${g4(lower)} to ${g4(upper)} ${units}. Window is the range width; `
    + "level is its midpoint. Manual settings persist when coil or pulse parameters change.";
  return [lower, upper];
}

function drawRfTab(v, p) {
  const b0 = Math.min(11.7, Math.max(0.001, +$("b0").value || 3));
  const axisKey = $("b0axis").value, direction = DIRECTIONS[axisKey];
  const duration = Math.min(10, Math.max(0, Number.isFinite(+$("duration").value) ? +$("duration").value : 1));
  const b1 = b1plusLinear(p.field, direction);
  const dir3 = [p.rot[0][2], p.rot[1][2], p.rot[2][2]];
  const centerVector = Float64Array.from(dir3, (d) => d * p.center);
  let centerB1 = b1plusLinear(centerVector, direction)[0];
  // A nominally parallel orientation can leave round-off-sized residuals.
  if (centerB1 < Math.hypot(...centerVector) * 1e-12) centerB1 = 0;
  const response = hardPulseResponse(b1, duration);
  const center = hardPulseResponse(centerB1, duration);
  const t90 = durationFor90Ms(centerB1);
  const frequency = larmorHz(b0);

  $("rFreq").textContent = `${(frequency / 1e6).toFixed(4)} MHz`;
  $("rB1").textContent = `${(centerB1 * 1e6).toFixed(3)} µT`;
  $("rRot").textContent = `${center.flipDeg.toFixed(2)}°`;
  $("rT90").textContent = t90 == null ? "Unavailable" : `${g4(t90)} ms`;
  $("rCenterNote").textContent = `At the center, immediately after this pulse: M∥/M₀ = ${center.mz.toFixed(3)}; `
    + `|M⊥|/M₀ = ${center.mxy.toFixed(3)}. Initially M is aligned with B₀. Rotation angle is unwrapped; `
    + "angles above 180° are allowed.";
  $("rNoField").hidden = centerB1 !== 0;
  $("rLowField").hidden = !(b0 < 0.5);

  const cycles = frequency * duration * 1e-3;
  let peak = 0;
  for (let k = 0; k < p.roiVectors.length / 3; k++) {
    const b = Math.hypot(p.roiVectors[3 * k], p.roiVectors[3 * k + 1], p.roiVectors[3 * k + 2]);
    if (b > peak) peak = b;
  }
  const ratio = peak / b0;
  const warn = $("rApprox");
  warn.hidden = !(duration > 0 && (cycles < 10 || ratio > 0.01));
  warn.textContent = `Approximation check in the ROI: ${cycles.toFixed(1)} carrier cycles in this pulse; peak |B_RF|/B₀ = `
    + `${+ratio.toPrecision(3)}. The rotating-wave approximation needs many cycles and RF fields small compared with B₀. `
    + "These are heuristic flags, not a validated full Bloch calculation.";

  const locked = $("lock").checked;
  $("lockNote").hidden = !locked;
  const side = document.querySelector('input[name="layout"]:checked').value === "side";
  $("maps").className = side ? "grid2" : "stack";

  const axisCm = Array.from(p.axis, (a) => a * 100);
  const orientation = axisKey === "+y" ? "B₀: +y (normal to section)" : `B₀: ${axisKey}`;
  const plots = [
    ["plotB1", "b1", Array.from(b1, (x) => x * 1e6), "|B₁⁺| (µT)", "µT", "Viridis"],
    ["plotFlip", "flip", Array.from(response.flipDeg), "Rotation angle (degrees)", "degrees", "Magma"],
  ];
  for (const [id, key, values, label, units, colorscale] of plots) {
    const [lower, upper] = windowLevel(key, values, units, locked);
    draw(id, [
      { type: "heatmap", x: axisCm, y: axisCm, z: rows(values, p.gridSize), zmin: lower, zmax: upper, colorscale,
        zsmooth: false, hoverongaps: false, colorbar: { title: { text: label, side: "right" }, thickness: 12, len: 0.85 } },
      ...wireOverlay(v, p.rot, 6, "#fff", "#000").filter((t) => t.mode === "markers"),
    ], mapLayout(v, null, {
      annotations: [{ xref: "x domain", yref: "y domain", x: 0.02, y: 0.98, xanchor: "left", yanchor: "top", showarrow: false,
                      text: orientation, font: { color: "#fff", size: 11 }, bgcolor: "rgba(0,0,0,0.65)", borderpad: 3 }],
    }));
  }
}

function update() {
  pending = false;
  const v = readControls();
  const p = physics(v);
  if (tab === "coil") drawCoilTab(v, p); else drawRfTab(v, p);
}

const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(update); } };

function setTab(name) {
  tab = name;
  $("tabCoil").hidden = name !== "coil"; $("tabRf").hidden = name !== "rf";
  $("tabBtnCoil").setAttribute("aria-selected", name === "coil");
  $("tabBtnRf").setAttribute("aria-selected", name === "rf");
  schedule();
}
$("tabBtnCoil").addEventListener("click", () => setTab("coil"));
$("tabBtnRf").addEventListener("click", () => setTab("rf"));

for (const id of ["geometry", "radius", "current", "turns", "spacing", "tilt", "roi", "arrows", "b0", "b0axis", "duration", "lock"]) {
  $(id).addEventListener("input", schedule);
}
document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener("input", schedule));

for (const key of ["b1", "flip"]) {
  const st = wl[key];
  $(`${key}_reset`).addEventListener("click", () => { st.auto = true; schedule(); });
  $(`${key}_full`).addEventListener("click", () => {
    if (!st.stats) return;
    const { fullLow, fullHigh, minimum } = st.stats;
    st.auto = false;
    st.width = Math.max(fullHigh - fullLow, minimum);
    st.level = fullHigh > fullLow ? (fullHigh + fullLow) / 2 : st.width / 2;
    schedule();
  });
  $(`${key}_auto`).addEventListener("input", (e) => { st.auto = e.target.checked; schedule(); });
  $(`${key}_window`).addEventListener("input", (e) => { if (+e.target.value > 0) { st.width = +e.target.value; schedule(); } });
  $(`${key}_level`).addEventListener("input", (e) => { if (+e.target.value >= 0 && e.target.value !== "") { st.level = +e.target.value; schedule(); } });
}
$("flip_standard").addEventListener("click", () => { wl.flip.auto = false; wl.flip.width = 180; wl.flip.level = 90; schedule(); });

if (window.Plotly) update();
else document.querySelector("main").insertAdjacentHTML("afterbegin",
  '<div class="alert" role="alert">Plotly failed to load; check your network connection.</div>');
