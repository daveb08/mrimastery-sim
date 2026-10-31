import { transforms, aliasFrequency, magnitude, phase, twoDimensional, DEFAULT_WIDTH } from "./fourier.js";
import { simulateRfSlice } from "./rfslice.js";
import { COLORS, axisStyle, layout, draw } from "../shared/plot.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["0.064T", "0.5T", "1.0T", "1.5T", "3.0T", "4.7T", "7.0T", "9.4T", "11.7T"];
let manualRate = 256;
let pending = false;

$("field").innerHTML = FIELDS.map((f) => `<option${f === "3.0T" ? " selected" : ""}>${f}</option>`).join("");

const num = (id) => +$(id).value;
const g = (x) => String(+x.toPrecision(6)); // like Python's :g

function resetSignalParameters() {
  $("width").value = DEFAULT_WIDTH[$("kind").value];
  $("freq").value = 0;
  $("rate").value = manualRate = 256;
  $("samples").value = 256;
  $("auto").checked = false;
}

const hline = (name, x, y, color, dash, showlegend = true, width = 1.2, yaxis = "y") => ({
  x, y, name, mode: "lines", line: { color, dash, width }, showlegend, hoverinfo: "skip", yaxis,
});

function drawFourier(kind, width, frequency, rate, samples) {
  const r = transforms(kind, width, frequency, rate, samples);
  const aliasing = rate < 2 * frequency;
  const alias = aliasFrequency(frequency, rate);
  const nyq = rate / 2;

  draw("time1d", [
    { x: Array.from(r.denseT), y: Array.from(r.denseValues), name: "Continuous signal", mode: "lines",
      line: { color: COLORS.gold, width: 1 } },
    { x: Array.from(r.t), y: Array.from(r.values), name: "Samples", mode: "markers",
      marker: { color: COLORS.green, size: 4 } },
  ], layout({
    title: { text: `1D Time Domain ${kind} Signal`, font: { size: 13 } },
    xaxis: axisStyle({ title: "Time (s)" }), yaxis: axisStyle({ title: "Amplitude" }),
  }));

  const contMag = magnitude(r.continuous), discMag = magnitude(r.discrete);
  const contPh = phase(r.continuous), discPh = phase(r.discrete);
  const top = Math.max(...contMag, ...discMag) * 1.05;
  const traces = [
    { x: Array.from(r.frequencies), y: contMag, name: "Continuous FT approximation", mode: "lines",
      line: { color: COLORS.blue, width: 1.2 } },
    { x: Array.from(r.bins), y: discMag, name: "Discrete FT", mode: "markers", marker: { color: COLORS.gold, size: 4 } },
    hline(`Nyquist: ${g(nyq)} Hz`, [nyq, nyq], [0, top], COLORS.red, "dash"),
    { x: Array.from(r.frequencies), y: contPh, name: "Continuous FT", mode: "lines", yaxis: "y2",
      line: { color: COLORS.blue, width: 1.2 }, showlegend: false },
    { x: Array.from(r.bins), y: discPh, name: "Discrete FT", mode: "markers", yaxis: "y2",
      marker: { color: COLORS.gold, size: 4 }, showlegend: false },
    hline("Nyquist", [nyq, nyq], [-Math.PI, Math.PI], COLORS.red, "dash", false, 1.2, "y2"),
  ];
  if (aliasing) {
    for (const p of new Set([-alias, alias])) {
      traces.push(hline(`Aliased carrier: ${g(alias)} Hz`, [p, p], [0, top], COLORS.orange, "dot", p === alias));
    }
    traces.push(hline(`Original carrier: ${g(frequency)} Hz`, [frequency, frequency], [0, top], COLORS.green, "dot", true, 1));
  }
  const annotations = kind === "Sinc" ? [{
    xref: "paper", yref: "paper", x: 0.02, y: 0.57, xanchor: "left", yanchor: "bottom", showarrow: false,
    text: "Magnitude &#8776; slice profile<br>(small-tip approximation)", align: "left",
    font: { color: COLORS.green, size: 10 }, bgcolor: "#1a1a1a", bordercolor: COLORS.green, borderpad: 4,
  }] : [];
  draw("spec1d", traces, layout({
    title: { text: `1D Frequency Domain ${kind} Signal`, font: { size: 13 } },
    xaxis: axisStyle({ title: "Frequency (Hz)", anchor: "y2" }),
    yaxis: axisStyle({ title: "Magnitude (amplitude × s)", domain: [0.55, 1] }),
    yaxis2: axisStyle({ title: "Phase (rad)", domain: [0, 0.45], anchor: "x",
                        tickvals: [-Math.PI, 0, Math.PI], ticktext: ["−π", "0", "π"] }),
    annotations,
  }));

  $("hermitian").hidden = !(frequency > 0);
  const note = $("aliasNote");
  note.hidden = !aliasing;
  if (aliasing) {
    note.textContent = `The ${g(frequency)} Hz carrier folds to ${g(alias)} Hz in the sampled spectrum (orange `
      + "markers). The DFT includes this folding; the continuous FT retains the original frequency.";
  }
  $("obsNote").textContent = `Observation duration: ${(samples / rate).toFixed(3)} s · DFT bin spacing: `
    + `${(rate / samples).toFixed(3)} Hz · Nyquist: ${g(nyq)} Hz. The continuous FT is numerical integration over `
    + "the same finite window. Sampling can introduce aliasing; finite windows introduce leakage. Phase near "
    + "spectral zeros is hidden.";

  const d = twoDimensional(r.values, r.discrete);
  const tAxis = d.idx.map((i) => r.t[i]), fAxis = d.idx.map((i) => r.bins[i]);
  const heat = (z, x, title, xl, yl, zmin, zmax, cbTitle) => ({
    data: [{ type: "heatmap", z, x, y: x, zmin, zmax, zsmooth: false, hoverongaps: false,
             colorscale: [[0, "#000000"], [1, "#ffffff"]],
             colorbar: { title: { text: cbTitle, side: "right" }, thickness: 12, len: 0.8 } }],
    layout: layout({
      title: { text: title, font: { size: 13 } },
      xaxis: axisStyle({ title: xl }), yaxis: axisStyle({ title: yl, scaleanchor: "x", scaleratio: 1 }),
    }),
  });
  const minImage = Math.min(...d.image.map((row) => Math.min(...row)));
  const a = heat(d.image, tAxis, `2D Time Domain ${kind} Signal`, "x (s)", "y (s)", minImage < 0 ? -1 : 0, 1, "Amplitude");
  const b = heat(d.spectrumDb, fAxis, `2D Frequency Domain ${kind} Signal`, "fx (Hz)", "fy (Hz)", -80, 0,
                 "Magnitude (dB relative to peak)");
  draw("time2d", a.data, a.layout);
  draw("spec2d", b.data, b.layout);
}

function drawRf(kind) {
  const thickness = num("thick"), gradient = num("grad"), tbw = num("tbw");
  const r = simulateRfSlice(kind, thickness, gradient, tbw);
  $("rBw").textContent = r.bandwidth.toFixed(1);
  $("rDur").textContent = (r.duration * 1000).toFixed(3);
  $("rTbw").textContent = g(tbw);
  $("rAch").textContent = Number.isFinite(r.achievedMm) ? r.achievedMm.toFixed(2) : "n/a";

  const durMs = r.duration * 1000;
  draw("rfPulse", [{
    x: [-0.6 * durMs, -0.5 * durMs, ...Array.from(r.time, (t) => t * 1000), 0.5 * durMs, 0.6 * durMs],
    y: [0, 0, ...r.pulse, 0, 0], mode: "lines", line: { color: COLORS.gold }, name: kind, showlegend: false,
  }], layout({
    title: { text: `${kind} RF Pulse`, font: { size: 13 } },
    xaxis: axisStyle({ title: "Time (ms)" }), yaxis: axisStyle({ title: "Relative RF amplitude" }),
  }));

  const limit = Math.max(2 * r.bandwidth, 1.5 * (Number.isFinite(r.achievedMm) ? r.achievedMm : thickness) * r.hzPerMm);
  const f = [], m = [];
  for (let i = 0; i < r.frequencies.length; i++) {
    if (Math.abs(r.frequencies[i]) <= limit) { f.push(r.frequencies[i]); m.push(r.magnitude[i]); }
  }
  const limitMm = limit / r.hzPerMm;
  draw("rfProfile", [
    { x: [-limitMm, -thickness / 2, -thickness / 2, thickness / 2, thickness / 2, limitMm], y: [0, 0, 1, 1, 0, 0],
      mode: "lines", line: { color: COLORS.green, dash: "dash" }, name: "Ideal target" },
    { x: f.map((v) => v / r.hzPerMm), y: m, mode: "lines", line: { color: COLORS.blue }, name: "Simulated |FT(RF)|" },
  ], layout({
    title: { text: "Slice Profile", font: { size: 13 } },
    xaxis: axisStyle({ title: "Position (mm)" }), yaxis: axisStyle({ title: "Normalized magnitude" }),
    legend: { x: 0.99, xanchor: "right", y: 0.99, bgcolor: "rgba(26,26,26,0.85)", font: { size: 10 } },
  }));
  draw("rfSpectrum", [
    { x: f, y: m, mode: "lines", line: { color: COLORS.blue }, name: "RF magnitude spectrum" },
    hline("Required bandwidth edges", [r.bandwidth / 2, r.bandwidth / 2], [0, 1.05], "#FF6666", "dash"),
    hline("Required bandwidth edges", [-r.bandwidth / 2, -r.bandwidth / 2], [0, 1.05], "#FF6666", "dash", false),
  ], layout({
    title: { text: "RF Frequency Spectrum", font: { size: 13 } },
    xaxis: axisStyle({ title: "Frequency offset (Hz)" }), yaxis: axisStyle({ title: "Normalized magnitude" }),
    legend: { x: 0.99, xanchor: "right", y: 0.99, bgcolor: "rgba(26,26,26,0.85)", font: { size: 10 } },
  }));
}

function update() {
  pending = false;
  const kind = $("kind").value;
  const auto = $("auto").checked;
  const frequency = num("freq"), width = num("width"), samples = num("samples");
  if (!auto) manualRate = num("rate");
  const rate = auto ? 2 * frequency : manualRate;
  $("rate").disabled = auto;
  if (auto) $("rate").value = Math.min(1024, Math.max(1, rate));

  const b0 = parseFloat($("field").value);
  $("larmor").textContent = `${(42.577 * b0).toFixed(3)} MHz`;
  $("widthV").textContent = width.toFixed(2);
  $("freqV").textContent = `${frequency}`;
  $("rateV").textContent = auto ? `${g(rate)} (auto)` : `${rate}`;
  $("samplesV").textContent = `${samples}`;
  $("thickV").textContent = num("thick").toFixed(1);
  $("gradV").textContent = num("grad").toFixed(1);
  $("tbwV").textContent = num("tbw").toFixed(1);

  const aliasing = rate < 2 * frequency;
  $("mNyq").textContent = `${g(rate / 2)} Hz`;
  $("mCar").textContent = `${g(frequency)} Hz`;
  $("mAlias").textContent = aliasing ? "Yes" : "No";
  $("aliasAlert").hidden = !aliasing;
  const zero = rate === 0;
  $("zeroRate").hidden = !zero;
  $("fourier").hidden = zero;
  if (!zero) drawFourier(kind, width, frequency, rate, samples);
  drawRf(kind);
}

function schedule() {
  if (!pending) { pending = true; requestAnimationFrame(update); }
}

$("kind").addEventListener("input", () => { resetSignalParameters(); schedule(); });
for (const id of ["field", "auto", "width", "freq", "rate", "samples", "thick", "grad", "tbw"]) {
  $(id).addEventListener("input", schedule);
}

if (window.Plotly) update();
else document.querySelector("main").insertAdjacentHTML("afterbegin",
  '<div class="alert" role="alert">Plotly failed to load; check your network connection.</div>');
