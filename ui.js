import { runProgram, meanTransverse } from "./bloch.js";

const $ = (id) => document.getElementById(id);
const SHOWN = 15;      // spins drawn as arrows
const STRIDE = 8;      // the signal averages SHOWN*STRIDE - 7 spins, so refocusing
const SPINS = (SHOWN - 1) * STRIDE + 1; // is not spoiled by false revivals
const COLORS = { x: "#ff6b6b", y: "#6bd66b", z: "#6ba6ff", mean: "#FFD700", spin: "#9fb4cc" };
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
    ["flip", "phase", "pdur", "delay", "off", "spread", "t1", "t2"].map((k) => [k, +$(k).value]));
  v.program = $("program").value;
  v.shape = $("shape").value;
  for (const k of Object.keys(FMT)) $(k + "V").textContent = FMT[k](v[k]);
  return v;
}

function buildEvents(p) {
  const rf = (flipDeg, phaseDeg) => ({
    type: "rf", label: `${flipDeg}° RF pulse`, flipDeg, phaseDeg, durMs: p.pdur, shape: p.shape,
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

function vectorLines(frame) {
  const x = [], y = [], z = [];
  for (let i = 0; i < sim.count; i += sim.count === 1 ? 1 : STRIDE) {
    x.push(0, frame[3 * i], null); y.push(0, frame[3 * i + 1], null); z.push(0, frame[3 * i + 2], null);
  }
  return { x, y, z };
}

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

const DYNAMIC = sphereTraces().length; // then: spin arrows, mean vector, mean trail

function drawScene() {
  const f = sim.frames[0];
  const spins = vectorLines(f);
  const traces = [
    ...sphereTraces(),
    { type: "scatter3d", mode: "lines", ...spins, line: { color: COLORS.spin, width: 4 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter3d", mode: "lines", x: [0, 0], y: [0, 0], z: [0, 1], line: { color: COLORS.mean, width: 8 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter3d", mode: "lines", x: [], y: [], z: [], line: { color: "rgba(255,215,0,0.45)", width: 3 }, hoverinfo: "skip", showlegend: false },
  ];
  const ax = { range: [-1.25, 1.25], showticklabels: false, title: "", showbackground: false,
               gridcolor: "#333", zerolinecolor: "#333" };
  Plotly.react("scene", traces, {
    paper_bgcolor: "#242424", margin: { l: 0, r: 0, t: 0, b: 0 },
    uirevision: "scene", // same sphere in every experiment: keep the camera/zoom
    scene: { uirevision: "scene", xaxis: ax, yaxis: ax, zaxis: ax, aspectmode: "cube", bgcolor: "#242424",
             camera: { eye: { x: 1.5, y: -1.5, z: 0.9 } } },
  }, { responsive: true, displaylogo: false, scrollZoom: true });
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
  Plotly.react("traces", curves, {
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
  }, { responsive: true, displaylogo: false, scrollZoom: true });
}

function showFrame(i) {
  i = Math.max(0, Math.min(sim.frames.length - 1, Math.round(i)));
  const f = sim.frames[i];
  const s = vectorLines(f);
  const m = sim.mean;
  Plotly.restyle("scene", { x: [s.x], y: [s.y], z: [s.z] }, [DYNAMIC]);
  Plotly.restyle("scene", { x: [[0, m.mx[i]]], y: [[0, m.my[i]]], z: [[0, m.mz[i]]] }, [DYNAMIC + 1]);
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

for (const id of ["program", "flip", "phase", "shape", "pdur", "delay", "off", "spread", "t1", "t2"]) {
  $(id).addEventListener("input", () => { setPlaying(false); refresh(); });
}
$("time").addEventListener("input", () => { setPlaying(false); showFrame(currentFrame()); });
$("play").addEventListener("click", () => setPlaying(!playing));

if (window.Plotly) refresh();
else $("scene").textContent = "Plotly failed to load; check your network connection.";
