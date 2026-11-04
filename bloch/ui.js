import { runProgram, meanTransverse, flipFromB1, b1ForFlip, shapeFraction } from "./bloch.js";
import { draw } from "../shared/plot.js";

const $ = (id) => document.getElementById(id);
const SHOWN = 15;      // spins drawn as arrows
const STRIDE = 8;      // the signal averages SHOWN*STRIDE - 7 spins, so refocusing
const SPINS = (SHOWN - 1) * STRIDE + 1; // is not spoiled by false revivals
const COLORS = { x: "#ff6b6b", y: "#6bd66b", z: "#6ba6ff", mean: "#FFD700", spin: "#c77dff" };
const HEAD = { mean: 0.16, spin: 0.11 }; // arrowhead length (sphere radius = 1)
const SIDES = 10; // facets around each arrowhead
const FMT = {
  flip: (v) => `${v}°`, phase: (v) => `${v}°`, pdur: (v) => `${(+v).toFixed(2)} ms`,
  delay: (v) => `${v} ms`, off: (v) => `${v} Hz`, spread: (v) => `${v} Hz`,
  t1: (v) => `${v} ms`, t2: (v) => `${v} ms`,
};

let sim = null;       // {t, frames, offRes, total}
let playing = false;
let raf = 0;
let lastStamp = 0;

function readParams() {
  const v = Object.fromEntries(
    ["flip", "b1", "phase", "pdur", "delay", "off", "spread", "t1", "t2"].map((k) => [k, +$(k).value]));
  // B1 and duration come from the exact-entry boxes (the sliders snap to their steps)
  v.b1 = +$("b1Num").value;
  v.pdur = +$("pdurNum").value;
  v.program = $("program").value;
  v.shape = $("shape").value;
  for (const k of Object.keys(FMT)) $(k + "V").textContent = FMT[k](v[k]);
  // The pulse is set either by its flip angle (B1 follows) or by its B1 amplitude (the flip angle follows); the
  // follower's slider is disabled and shows the value the pulse actually uses.
  const byB1 = $("pmode").value === "b1";
  if (byB1) v.flip = flipFromB1(v.b1, v.pdur, v.shape);
  else v.b1 = b1ForFlip(v.flip, v.pdur, v.shape);
  $("flip").disabled = byB1;
  $("b1").disabled = $("b1Num").disabled = !byB1;
  if (byB1) $("flip").value = Math.min(360, v.flip);
  else { $("b1").value = v.b1; $("b1Num").value = v.b1.toFixed(2); }
  $("flipV").textContent = `${Math.round(v.flip)}°`;
  $("b1V").textContent = `${v.b1.toFixed(2)} µT`;
  const frac = shapeFraction(v.shape);
  $("flipEq").innerHTML = `θ = 360° × γ̄ × B1 × τ${v.shape === "rect" ? "" : " × shape"} = 360° × 42.58 Hz/µT × `
    + `${v.b1.toFixed(2)} µT × ${v.pdur.toFixed(2)} ms${v.shape === "rect" ? "" : ` × ${frac.toFixed(2)}`} = <b>${Math.round(v.flip)}°</b>`
    + (byB1 && v.flip > 360 ? " (more than a full turn)" : "");
  return v;
}

function buildEvents(p) {
  const rf = (flipDeg, phaseDeg) => ({
    type: "rf", label: `${Math.round(flipDeg)}° RF pulse`, flipDeg, phaseDeg, durMs: p.pdur, shape: p.shape,
    tbw: 4, dtMs: p.pdur / 80,
  });
  const wait = (durMs) => ({ type: "delay", label: "free precession", durMs, dtMs: Math.max(0.1, durMs / 300) });
  if (p.program === "se") return [rf(p.flip, p.phase), wait(p.delay), rf(180, p.phase + 90), wait(p.delay),
      { ...wait(p.delay), label: "after the echo" }];
  if (p.program === "ir") return [rf(180, p.phase), wait(p.delay), rf(p.flip, p.phase)];
  return [rf(p.flip, p.phase), wait(p.delay)];
}

function simulate(p) {
  const count = p.spread === 0 ? 1 : SPINS;
  const offRes = Array.from({ length: count }, (_, i) =>
    p.off + (count === 1 ? 0 : -p.spread + (2 * p.spread * i) / (count - 1)));
  const run = runProgram(buildEvents(p), { T1: p.t1, T2: p.t2, offResHz: offRes });
  const total = run.t[run.t.length - 1];
  const events = buildEvents(p);
  const starts = [0, ...run.eventEnds.slice(0, -1)];
  return { ...run, offRes, total, count, events, starts, program: p.program, T2: p.t2 };
}

// Event containing frame i (frame 0 is the initial state, before any event).
function eventAt(i) {
  if (i === 0) return null;
  return sim.events.findIndex((_, k) => i <= sim.eventEnds[k]);
}

// Arrows from the origin to each vector: shafts (one line trace, broken by nulls) that stop at the base of an
// arrowhead, and the heads as one triangle mesh (a tip plus a ring of SIDES base points each). Plotly's own cone
// traces size themselves from the spacing between cones, so they balloon when the spin tips bunch together.
// Heads shrink with short vectors so a decayed vector does not become all head.
function arrows(vecs, head) {
  const shaft = { x: [], y: [], z: [] }, mesh = { x: [], y: [], z: [], i: [], j: [], k: [] };
  for (const [vx, vy, vz] of vecs) {
    const n = Math.hypot(vx, vy, vz);
    const h = head * Math.min(1, n / (2.5 * head));
    const s = n > 1e-9 ? (n - h) / n : 0;
    shaft.x.push(0, vx * s, null); shaft.y.push(0, vy * s, null); shaft.z.push(0, vz * s, null);
    // unit direction d and two unit vectors a, b across it
    const d = n > 1e-9 ? [vx / n, vy / n, vz / n] : [0, 0, 1];
    const ref = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let a = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
    const an = Math.hypot(...a); a = a.map((c) => c / an);
    const b = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const r = 0.38 * h, base = [vx * s, vy * s, vz * s], tip = mesh.x.length;
    mesh.x.push(vx); mesh.y.push(vy); mesh.z.push(vz);
    for (let m = 0; m < SIDES; m++) {
      const t = (2 * Math.PI * m) / SIDES, c = Math.cos(t) * r, sn = Math.sin(t) * r;
      mesh.x.push(base[0] + a[0] * c + b[0] * sn); mesh.y.push(base[1] + a[1] * c + b[1] * sn); mesh.z.push(base[2] + a[2] * c + b[2] * sn);
      const p = tip + 1 + m, q = tip + 1 + ((m + 1) % SIDES);
      mesh.i.push(tip); mesh.j.push(p); mesh.k.push(q); // side facet
      if (m > 0 && m < SIDES - 1) { mesh.i.push(tip + 1); mesh.j.push(q); mesh.k.push(p); } // base cap (fan)
    }
  }
  return { shaft, mesh };
}

function spinVectors(frame) {
  const out = [];
  for (let i = 0; i < sim.count; i += sim.count === 1 ? 1 : STRIDE) out.push([frame[3 * i], frame[3 * i + 1], frame[3 * i + 2]]);
  return out;
}

const headTrace = (color, mesh) => ({
  type: "mesh3d", ...mesh, color, flatshading: true, hoverinfo: "skip", showlegend: false,
  lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.1 },
});

function sphereTraces() {
  const ring = (fn) => {
    const x = [], y = [], z = [];
    for (let a = 0; a <= 360; a += 6) { const [px, py, pz] = fn((a * Math.PI) / 180); x.push(px); y.push(py); z.push(pz); }
    return { x, y, z };
  };
  const line = (d, color, name, w = 2) => ({
    type: "scatter3d", mode: "lines", ...d, line: { color, width: w }, name, hoverinfo: "skip", showlegend: false,
  });
  const faint = "rgba(160,160,160,0.35)";
  const axis = (a, c, n) => line({ x: a[0], y: a[1], z: a[2] }, c, n, 4);
  // Faint disc in the transverse (xy) plane, where the MR signal lives.
  const sides = 72;
  const disc = {
    type: "mesh3d", name: "transverse plane", hoverinfo: "skip", showlegend: false,
    x: [0], y: [0], z: [0], i: [], j: [], k: [],
    color: "#4fd1c5", opacity: 0.1, flatshading: true, lighting: { ambient: 1, diffuse: 0 },
  };
  for (let n = 0; n < sides; n++) {
    const a = (2 * Math.PI * n) / sides;
    disc.x.push(Math.cos(a)); disc.y.push(Math.sin(a)); disc.z.push(0);
    disc.i.push(0); disc.j.push(n + 1); disc.k.push(((n + 1) % sides) + 1);
  }
  return [
    disc,
    line(ring((a) => [Math.cos(a), Math.sin(a), 0]), "rgba(79,209,197,0.6)", "equator", 2),
    line(ring((a) => [Math.cos(a), 0, Math.sin(a)]), faint, "xz", 1),
    line(ring((a) => [0, Math.cos(a), Math.sin(a)]), faint, "yz", 1),
    axis([[-1.1, 1.1], [0, 0], [0, 0]], COLORS.x, "x"),
    axis([[0, 0], [-1.1, 1.1], [0, 0]], COLORS.y, "y"),
    axis([[0, 0], [0, 0], [-1.1, 1.1]], COLORS.z, "z"),
    {
      type: "scatter3d", mode: "text", x: [1.22, 0, 0], y: [0, 1.22, 0], z: [0, 0, 1.22],
      text: ["x", "y", "z"], textfont: { color: [COLORS.x, COLORS.y, COLORS.z], size: 14 },
      hoverinfo: "skip", showlegend: false,
    },
  ];
}

const DYNAMIC = sphereTraces().length; // then: spin shafts, mean shaft, mean trail, spin heads, mean head

function drawScene() {
  const spins = arrows(spinVectors(sim.frames[0]), HEAD.spin), mean = arrows([[0, 0, 1]], HEAD.mean);
  const line = (d, color, width) => ({ type: "scatter3d", mode: "lines", ...d, line: { color, width }, hoverinfo: "skip", showlegend: false });
  const traces = [
    ...sphereTraces(),
    line(spins.shaft, COLORS.spin, 4),
    line(mean.shaft, COLORS.mean, 8),
    line({ x: [], y: [], z: [] }, "rgba(255,215,0,0.45)", 3),
    { ...headTrace(COLORS.spin, spins.mesh), visible: sim.count > 1 }, // one spin: it is the mean vector
    headTrace(COLORS.mean, mean.mesh),
  ];
  const ax = { range: [-1.25, 1.25], showticklabels: false, title: "", showbackground: false,
               gridcolor: "#333", zerolinecolor: "#333" };
  draw("scene", traces, {
    paper_bgcolor: "#242424", margin: { l: 0, r: 0, t: 0, b: 0 },
    uirevision: "scene", // same sphere in every experiment: keep the camera/zoom
    scene: { uirevision: "scene", xaxis: ax, yaxis: ax, zaxis: ax, aspectmode: "cube", bgcolor: "#242424",
             camera: { eye: { x: 1.05, y: -1.05, z: 0.63 } } }, // close in: the sphere fills the view
  });
}

function drawTraces() {
  const n = sim.frames.length;
  const mx = new Float64Array(n), my = new Float64Array(n), mz = new Float64Array(n), mxy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = meanTransverse(sim.frames[i]);
    mx[i] = m.mx; my[i] = m.my; mz[i] = m.mz; mxy[i] = m.mxy;
  }
  sim.mean = { mx, my, mz, mxy };
  const stride = Math.max(1, Math.floor(n / 800));
  const pick = (a) => Array.from(a).filter((_, i) => i % stride === 0);
  const t = pick(sim.t);
  const tr = (y, name, color, dash, width = 2) => ({ x: t, y: pick(y), name, mode: "lines", line: { color, width, dash } });
  const curves = [tr(mx, "Mx", COLORS.x), tr(my, "My", COLORS.y), tr(mz, "Mz", COLORS.z),
                  tr(mxy, "|Mxy| signal envelope", COLORS.mean, "solid", 3)];
  if (sim.program !== "ir") {
    // Pure T2 decay from the end of the first pulse: spin-echo peaks sit on it,
    // while the free induction decay falls below it.
    const k0 = sim.eventEnds[0], t0 = sim.t[k0], a0 = mxy[k0];
    curves.push({ x: t, y: t.map((tt) => (tt < t0 ? null : a0 * Math.exp(-(tt - t0) / sim.T2))),
                  name: "T2 decay", mode: "lines", line: { color: "#ffffff", width: 1, dash: "dash" } });
  }
  draw("traces", curves, {
    paper_bgcolor: "#242424", plot_bgcolor: "#242424", font: { color: "#ccc", size: 11 },
    uirevision: "traces", // keep the user's zoom/pan across redraws
    margin: { l: 44, r: 12, t: 8, b: 36 }, legend: { orientation: "h", y: 1.18 },
    // Only the time range changes between experiments, so reset just that axis.
    xaxis: { title: "Time (ms)", gridcolor: "#333", zeroline: false, uirevision: sim.program },
    yaxis: { range: [-1.05, 1.05], gridcolor: "#333", zerolinecolor: "#555" },
    shapes: [
      { type: "line", x0: 0, x1: 0, yref: "paper", y0: 0, y1: 1, line: { color: "#888", width: 1 } },
      ...sim.events.map((ev, k) => ev.type !== "rf" ? null : {
        type: "rect", yref: "paper", y0: 0, y1: 1, line: { width: 0 },
        fillcolor: "rgba(255,215,0,0.3)",
        x0: sim.t[sim.starts[k]], x1: Math.max(sim.t[sim.eventEnds[k]], sim.t[sim.starts[k]] + sim.total * 0.006),
      }).filter(Boolean),
    ],
  });
}

function showFrame(i) {
  i = Math.max(0, Math.min(sim.frames.length - 1, Math.round(i)));
  const f = sim.frames[i];
  const m = sim.mean;
  const s = arrows(spinVectors(f), HEAD.spin), a = arrows([[m.mx[i], m.my[i], m.mz[i]]], HEAD.mean);
  Plotly.restyle("scene", { x: [s.shaft.x, a.shaft.x], y: [s.shaft.y, a.shaft.y], z: [s.shaft.z, a.shaft.z] }, [DYNAMIC, DYNAMIC + 1]);
  Plotly.restyle("scene", { x: [s.mesh.x, a.mesh.x], y: [s.mesh.y, a.mesh.y], z: [s.mesh.z, a.mesh.z] }, [DYNAMIC + 3, DYNAMIC + 4]);
  const j = i + 1;
  Plotly.restyle("scene", { x: [Array.from(m.mx.subarray(0, j))], y: [Array.from(m.my.subarray(0, j))],
                            z: [Array.from(m.mz.subarray(0, j))] }, [DYNAMIC + 2]);
  Plotly.relayout("traces", { "shapes[0].x0": sim.t[i], "shapes[0].x1": sim.t[i] });
  const k = eventAt(i);
  $("readout").textContent = `${sim.t[i].toFixed(2)} ms · ${k === null ? "start" : sim.events[k].label}`;
}

// The slider steps through simulation frames, not time, so a short RF pulse
// gets a share of the slider and of playback comparable to a long delay.
function currentFrame() { return +$("time").value; }

function setPlaying(on) {
  playing = on;
  $("play").textContent = on ? "Pause" : "Play";
  cancelAnimationFrame(raf);
  if (!on) return;
  const last = sim.frames.length - 1;
  if (currentFrame() >= last) $("time").value = 0;
  lastStamp = performance.now();
  const tick = (now) => {
    // The whole program plays in about 12 s regardless of its length.
    const dv = ((now - lastStamp) / 12000) * last;
    lastStamp = now;
    const next = Math.min(last, currentFrame() + dv);
    $("time").value = next;
    showFrame(next);
    if (next >= last) { setPlaying(false); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function refresh() {
  const p = readParams();
  const fraction = sim ? currentFrame() / (sim.frames.length - 1) : 0;
  sim = simulate(p);
  $("time").max = sim.frames.length - 1;
  $("time").step = "any";
  $("time").value = fraction * (sim.frames.length - 1);
  drawScene();
  drawTraces();
  showFrame(currentFrame());
}

// Each slider with an exact-entry box: the slider fills the box; a typed value within the box's limits moves the slider
// (to its nearest step) and is used exactly. Registered before the refresh listeners so the box is current first.
for (const [slider, box] of [["b1", "b1Num"], ["pdur", "pdurNum"]]) {
  $(slider).addEventListener("input", () => { $(box).value = $(slider).value; });
  const valid = () => {
    const v = +$(box).value, b = $(box);
    return $(box).value !== "" && Number.isFinite(v) && v >= +b.min && v <= +b.max;
  };
  $(box).addEventListener("input", () => {
    if (!valid()) return;
    $(slider).value = $(box).value;
    setPlaying(false); refresh();
  });
  $(box).addEventListener("change", () => { // on leaving the box: pull an out-of-range entry back inside the limits
    const b = $(box), v = Math.min(+b.max, Math.max(+b.min, +b.value || +$(slider).value));
    b.value = v; $(slider).value = v;
    setPlaying(false); refresh();
  });
}
for (const id of ["program", "pmode", "flip", "b1", "phase", "shape", "pdur", "delay", "off", "spread", "t1", "t2"]) {
  $(id).addEventListener("input", () => { setPlaying(false); refresh(); });
}
$("time").addEventListener("input", () => { setPlaying(false); showFrame(currentFrame()); });
$("play").addEventListener("click", () => setPlaying(!playing));

if (window.Plotly) refresh();
else $("scene").textContent = "Plotly failed to load; check your network connection.";
