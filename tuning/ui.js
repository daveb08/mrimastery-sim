import { coil, tuneAndMatch, excitation, sweep } from "./tuning.js";
import { draw, config, textScale } from "../shared/plot.js";

const $ = (id) => document.getElementById(id);
const POWER = 100; // W from the amplifier
const STEP = 1.005; // one press of - or +

const state = { b0: 3, radius: 0.05, qUnloaded: 250, loading: 0, ct: 0, cm: 0 };
const coilNow = () => coil(state);

// capacitors live on log sliders (log10 of farads)
const setCap = (key, farads) => { state[key] = farads; $(key).value = Math.log10(farads); };
const pF = (f) => { const p = f * 1e12; return `${p < 1 ? p.toFixed(3) : p < 10 ? p.toFixed(2) : p.toFixed(1)} pF`; };
const loadingName = (x) => (x === 0 ? "none" : x < 0.3 ? "light" : x < 0.7 ? "typical" : "heavy");

function autoTune() {
  const m = tuneAndMatch(coilNow());
  if (!m) return false;
  setCap("ct", m.ct); setCap("cm", m.cm);
  return true;
}

let unmatchable = false;
function render() {
  const c = coilNow();
  $("radiusV").textContent = `${(state.radius * 100).toFixed(1)}`;
  $("quV").textContent = `${state.qUnloaded}`;
  $("loadingV").textContent = `${Math.round(state.loading * 100)}% (${loadingName(state.loading)})`;
  $("ctV").textContent = pF(state.ct);
  $("cmV").textContent = pF(state.cm);

  const s = sweep(c, state.ct, state.cm);
  const e = excitation(c, state.ct, state.cm, state.radius, POWER);
  const fL = c.f / 1e6, refl = e.reflected * 100;

  // status: matched, or what is wrong
  let status;
  if (unmatchable) {
    status = `<div class="alert">This loop cannot be matched to 50 Ω with one tuning and one matching capacitor: its loss
      (${(c.rCoil + c.rSample).toFixed(0)} Ω) is above 50 Ω. Real coils this size at this field are split into segments
      joined by capacitors. Try a smaller loop or less loading.</div>`;
  } else if (refl < 1) {
    status = `<div class="ok">Tuned and matched at ${fL.toFixed(2)} MHz: ${refl.toFixed(2)}% of the power is reflected.</div>`;
  } else {
    status = `<div class="warn">The coil's dip is at ${(s.fDip / 1e6).toFixed(2)} MHz but the protons are at
      ${fL.toFixed(2)} MHz: ${refl.toFixed(0)}% of the power is reflected back toward the amplifier.</div>`;
  }
  $("status").innerHTML = status;

  const items = [
    ["Larmor frequency", `${fL.toFixed(2)} MHz`],
    ["Coil resonance (dip)", `${(s.fDip / 1e6).toFixed(2)} MHz`],
    ["Reflected power", `${refl.toFixed(refl < 1 ? 2 : 0)}%`],
    ["Q unloaded / loaded", `${c.qUnloaded.toFixed(0)} / ${c.qLoaded.toFixed(0)}`],
    ["Q ratio", `${c.qRatio.toFixed(2)}`],
    ["Power into patient", `${e.toPatient.toFixed(0)} W of ${POWER}`],
    ["B1+ at loop centre", `${(e.b1Plus * 1e6).toFixed(1)} µT`],
    ["90° pulse length", !Number.isFinite(e.t90) || e.t90 > 0.1 ? "—" : e.t90 < 1e-3 ? `${(e.t90 * 1e6).toFixed(0)} µs` : `${(e.t90 * 1e3).toFixed(1)} ms`],
  ];
  $("readouts").innerHTML = items.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("");

  drawS11(c, s);
  drawSmith(c, s, e);
  $("circuit").innerHTML = circuitSvg(c);
}

function drawS11(c, s) {
  const f = Array.from(s.f, (v) => v / 1e6), fL = c.f / 1e6;
  draw("s11", [
    { x: f, y: Array.from(s.db), mode: "lines", line: { color: "#6699FF", width: 2.5 }, name: "|S11|", hovertemplate: "%{x:.2f} MHz<br>%{y:.1f} dB<extra></extra>" },
    { x: [s.fDip / 1e6], y: [s.dipDb], mode: "markers", marker: { color: "#6699FF", size: 9 }, name: "dip", hoverinfo: "skip" },
  ], {
    paper_bgcolor: "#242424", plot_bgcolor: "#1a1a1a", font: { color: "#ccc", size: 12 },
    title: { text: "Reflection |S11| — what a network analyzer shows", x: 0.02, font: { size: 14 } },
    margin: { l: 56, r: 14, t: 40, b: 46 }, showlegend: false, uirevision: `${state.b0}`,
    xaxis: { title: "Frequency (MHz)", gridcolor: "#333" },
    yaxis: { title: "|S11| (dB)", range: [-40, 1], gridcolor: "#333", zeroline: false },
    shapes: [
      { type: "line", x0: fL, x1: fL, yref: "paper", y0: 0, y1: 1, line: { color: "#FFD700", width: 2, dash: "dash" } },
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: -20, y1: -20, line: { color: "#555", width: 1, dash: "dot" } },
    ],
    annotations: [
      { x: fL, yref: "paper", y: 0.02, text: `Larmor ${fL.toFixed(2)} MHz`, showarrow: false, xanchor: "left", xshift: 4, font: { color: "#FFD700", size: 12 } },
      { xref: "paper", x: 0.99, y: -20, text: "−20 dB: 1% reflected", showarrow: false, xanchor: "right", yshift: 9, font: { color: "#888", size: 11 } },
    ],
  }, config);
}

function drawSmith(c, s, e) {
  draw("smith", [
    { type: "scattersmith", real: Array.from(s.zr), imag: Array.from(s.zi), mode: "lines", line: { color: "#6699FF", width: 2 }, hoverinfo: "skip", name: "sweep" },
    { type: "scattersmith", real: [e.z[0] / 50], imag: [e.z[1] / 50], mode: "markers", marker: { color: "#FFD700", size: 12 },
      name: "at the Larmor frequency", hovertemplate: `z = %{real:.2f} + j%{imag:.2f}<extra>at ${(c.f / 1e6).toFixed(2)} MHz</extra>` },
  ], {
    paper_bgcolor: "#242424", font: { color: "#ccc", size: 12 },
    title: { text: "Smith chart — the centre is a perfect 50 Ω match", x: 0.02, font: { size: 14 } },
    margin: { l: 30, r: 30, t: 48, b: 30 }, showlegend: false,
    smith: { bgcolor: "#1a1a1a", realaxis: { gridcolor: "#444", tickfont: { color: "#999" } }, imaginaryaxis: { gridcolor: "#444", tickfont: { color: "#999" } } },
  }, config);
}

// Schematic: amplifier and 50-ohm line -> series Cm -> Ct across the loop (L, its loss, the patient's loss).
function circuitSvg(c) {
  const fs = 13 * textScale(), col = "#ccc", y0 = 50, y1 = 170;
  const cap = (x, y, vertical, label, color = col) => vertical
    ? `<path d="M${x},${y - 30}V${y - 5}M${x - 14},${y - 5}H${x + 14}M${x - 14},${y + 5}H${x + 14}M${x},${y + 5}V${y + 30}" stroke="${color}" stroke-width="2" fill="none"/>
       <text x="${x + 20}" y="${y + 4}" fill="${color}" font-size="${fs}">${label}</text>`
    : `<path d="M${x - 30},${y}H${x - 5}M${x - 5},${y - 14}V${y + 14}M${x + 5},${y - 14}V${y + 14}M${x + 5},${y}H${x + 30}" stroke="${color}" stroke-width="2" fill="none"/>
       <text x="${x}" y="${y - 22}" fill="${color}" font-size="${fs}" text-anchor="middle">${label}</text>`;
  const res = (x, ya, yb, label, color) => {
    const n = 6, h = (yb - ya) / n;
    let d = `M${x},${ya}`;
    for (let i = 0; i < n; i++) d += `L${x + (i % 2 ? -8 : 8)},${ya + h * (i + 0.5)}`;
    return `<path d="${d}L${x},${yb}" stroke="${color}" stroke-width="2" fill="none"/>
      <text x="${x + 16}" y="${(ya + yb) / 2 + 4}" fill="${color}" font-size="${fs}">${label}</text>`;
  };
  const ind = (x, ya, yb, label) => {
    const n = 4, h = (yb - ya) / n;
    let d = `M${x},${ya}`;
    for (let i = 0; i < n; i++) d += `a${h / 2},${h / 2} 0 0 1 0,${h}`;
    return `<path d="${d}" stroke="#66DD66" stroke-width="2" fill="none"/>
      <text x="${x + 22}" y="${(ya + yb) / 2 + 4}" fill="#66DD66" font-size="${fs}">${label}</text>`;
  };
  const xs = 60, xm = 210, xt = 360, xl = 540;
  return `<svg viewBox="0 0 760 210" role="img" aria-label="Circuit: amplifier, matching capacitor, tuning capacitor and loop">
    <rect width="760" height="210" fill="#242424"/>
    <circle cx="${xs}" cy="${(y0 + y1) / 2}" r="18" stroke="${col}" stroke-width="2" fill="none"/>
    <path d="M${xs - 9},${(y0 + y1) / 2}q4.5,-9 9,0t9,0" stroke="${col}" stroke-width="2" fill="none"/>
    <text x="${xs}" y="${y1 + 30}" fill="${col}" font-size="${fs}" text-anchor="middle">amplifier, 50 Ω</text>
    <path d="M${xs},${(y0 + y1) / 2 - 18}V${y0}H${xm - 30}M${xm + 30},${y0}H${xl}V${y0 + 10}M${xs},${(y0 + y1) / 2 + 18}V${y1}H${xl}V${y1 - 10}" stroke="${col}" stroke-width="2" fill="none"/>
    ${cap(xm, y0, false, `Cm = ${pF(state.cm)}`, "#FFAA44")}
    <path d="M${xt},${y0}V${(y0 + y1) / 2 - 30}M${xt},${(y0 + y1) / 2 + 30}V${y1}" stroke="${col}" stroke-width="2"/>
    ${cap(xt, (y0 + y1) / 2, true, `Ct = ${pF(state.ct)}`, "#FFAA44")}
    ${ind(xl, y0 + 10, y0 + 58, `L = ${(c.L * 1e9).toFixed(0)} nH (loop)`)}
    ${res(xl, y0 + 62, y0 + 88, `coil loss ${c.rCoil.toFixed(2)} Ω`, col)}
    ${res(xl, y0 + 92, y1 - 10, `patient ${c.rSample.toFixed(2)} Ω`, "#FF6666")}
    <path d="M${xl},${y0 + 58}V${y0 + 62}M${xl},${y0 + 88}V${y0 + 92}" stroke="${col}" stroke-width="2"/>
  </svg>`;
}

// ---- controls ----
const num = (id, key, scale = 1) => $(id).addEventListener("input", () => { state[key] = Number($(id).value) * scale; unmatchable = false; render(); });
$("b0").addEventListener("change", () => { state.b0 = Number($("b0").value); unmatchable = false; render(); });
num("radius", "radius", 0.01);
num("qu", "qUnloaded");
num("loading", "loading");
for (const key of ["ct", "cm"]) {
  $(key).addEventListener("input", () => { state[key] = 10 ** Number($(key).value); unmatchable = false; render(); });
  $(`${key}Down`).addEventListener("click", () => { setCap(key, state[key] / STEP); render(); });
  $(`${key}Up`).addEventListener("click", () => { setCap(key, state[key] * STEP); render(); });
}
$("auto").addEventListener("click", () => { unmatchable = !autoTune(); render(); });
$("mistune").addEventListener("click", () => {
  if (!autoTune()) return;
  setCap("ct", state.ct * 1.04); setCap("cm", state.cm * 1.4);
  render();
});

// start on a mistuned coil, so the first thing to do is tune it
$("radius").value = state.radius * 100; $("qu").value = state.qUnloaded; $("loading").value = state.loading;
if (window.Plotly) { $("mistune").click(); }
else $("status").innerHTML = `<div class="alert">Plotly failed to load; check your network connection.</div>`;
