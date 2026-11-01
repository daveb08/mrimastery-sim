import { BUILDERS, DEFAULTS, DEFAULT_LIMITS } from "../shared/sequence.js";
import { diagramSvg } from "../shared/seqdiagram.js";
import { textScale } from "../shared/plot.js";
import { echoTrainReadouts, acquiredRows } from "../contrast/acquisition.js";

const $ = (id) => document.getElementById(id);

const SEQ_DEFAULTS = {
  SE: { TE: 20, TR: 500 },
  GRE: { TE: 5, TR: 50, flip: 30 },
  FSE: { TE: 80, TR: 3000, ETL: 8 },
  EPI: { TE: 40, TR: 3000, bw: 1500, nx: 64, ny: 64 },
};
const NAMES = { SE: "Spin echo", GRE: "Gradient echo (spoiled)", FSE: "Fast spin echo", EPI: "Single-shot EPI" };

let state = { seq: "SE", ...DEFAULTS, ...SEQ_DEFAULTS.SE, line: 0, gMax: DEFAULT_LIMITS.gMax, slew: DEFAULT_LIMITS.slew };
state.line = state.ny / 2;

// Control definitions; `when` limits a control to some sequences.
const CONTROLS = [
  { key: "seq", label: "Sequence", type: "select", options: Object.entries(NAMES) },
  { key: "TE", label: "TE (ms)", min: 1, max: 200, step: 0.5, when: ["SE", "GRE", "EPI", "FSE"] },
  { key: "TR", label: "TR (ms)", min: 10, max: 5000, step: 10 },
  { key: "flip", label: "Flip angle (°)", min: 5, max: 90, step: 1, when: ["GRE"] },
  { key: "ETL", label: "Echo train length", min: 2, max: 32, step: 1, when: ["FSE"] },
  { key: "matrix", label: "Matrix (square)", type: "select", options: [[64, "64 × 64"], [128, "128 × 128"], [256, "256 × 256"]] },
  { key: "fov", label: "FOV (mm)", min: 120, max: 400, step: 10 },
  { key: "bw", label: "Bandwidth (Hz/pixel)", min: 50, max: 3000, step: 10 },
  { key: "sliceMm", label: "Slice (mm)", min: 1, max: 10, step: 0.5 },
  { key: "line", label: "Phase-encode line shown", min: 0, max: 255, step: 1, when: ["SE", "GRE"] },
  { key: "shot", label: "Echo train (TR) shown", min: 0, max: 63, step: 1, when: ["FSE"] },
  { key: "gMax", label: "Max gradient (mT/m)", type: "select", options: [[20, "20"], [40, "40"], [80, "80"]] },
  { key: "slew", label: "Max slew rate (T/m/s)", type: "select", options: [[70, "70"], [150, "150"], [200, "200"]] },
];

function params() {
  return { ...state, nx: state.ny, fovRead: state.fov ?? 240, fovPhase: state.fov ?? 240, limits: { gMax: +state.gMax, slew: +state.slew } };
}

// FSE: which rows each echo train acquires (the effective echo set from TE, as on the scanner).
function fseShots(P) {
  const probe = BUILDERS.FSE(P, Array.from({ length: P.ETL }, (_, i) => i));
  const esp = probe.info.esp;
  const eff = Math.max(0, Math.min(P.ETL - 1, Math.round(P.TE / esp) - 1));
  const ro = echoTrainReadouts(acquiredRows(P.ny, 1), P.ETL, eff);
  const shots = [...new Set(ro.map((r) => r.group))].map((g) => ro.filter((r) => r.group === g).map((r) => r.row));
  return { shots, esp, eff };
}

function build() {
  const P = params();
  if (state.seq === "SE") return { seq: BUILDERS.SE(P, state.line), shots: P.ny };
  if (state.seq === "GRE") return { seq: BUILDERS.GRE(P, state.line), shots: P.ny };
  if (state.seq === "EPI") return { seq: BUILDERS.EPI(P, acquiredRows(P.ny, 1)), shots: 1 };
  const { shots, eff } = fseShots(P);
  const shot = Math.min(state.shot ?? 0, shots.length - 1);
  return { seq: BUILDERS.FSE(P, shots[shot]), shots: shots.length, eff };
}

function buildControls() {
  const box = $("controls");
  box.innerHTML = "";
  for (const c of CONTROLS) {
    if (c.when && !c.when.includes(state.seq)) continue;
    const wrap = document.createElement("div");
    const id = `k_${c.key}`;
    const value = c.key === "matrix" ? state.ny : c.key === "fov" ? (state.fov ?? 240) : state[c.key] ?? 0;
    if (c.type === "select") {
      wrap.innerHTML = `<label for="${id}">${c.label}</label><select id="${id}">${c.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`;
      wrap.querySelector("select").value = value;
      wrap.querySelector("select").addEventListener("change", (e) => set(c.key, e.target.value));
    } else {
      const max = c.key === "line" ? state.ny - 1 : c.max;
      wrap.innerHTML = `<label for="${id}">${c.label} <span class="v" id="${id}V">${value}</span></label>`
        + `<input id="${id}" type="range" min="${c.min}" max="${max}" step="${c.step}" value="${value}">`;
      wrap.querySelector("input").addEventListener("input", (e) => { $(`${id}V`).textContent = e.target.value; set(c.key, Number(e.target.value), false); });
    }
    box.append(wrap);
  }
}

function set(key, value, rebuild = true) {
  if (key === "seq") {
    state = { ...state, ...DEFAULTS, ...SEQ_DEFAULTS[value], seq: value, fov: state.fov, gMax: state.gMax, slew: state.slew, shot: 0 };
    state.line = state.ny / 2;
  } else if (key === "matrix") {
    state.nx = state.ny = Number(value);
    state.line = Math.min(state.line, state.ny - 1);
  } else state[key] = typeof value === "string" && !isNaN(value) ? Number(value) : value;
  if (rebuild) buildControls();
  render();
}

function render() {
  const { seq, shots, eff } = build();
  const view = document.querySelector("input[name=view]:checked").value;
  let window = [0, seq.tr], note = "";
  const adcs = seq.events.filter((e) => e.kind === "adc");
  if (view === "echo" && adcs.length) {
    const centre = adcs.find((a) => a.row === state.ny / 2) ?? adcs[Math.floor(adcs.length / 2)];
    const half = (centre.n / 2 + 1) * centre.dwell;
    const w = Math.max(4 * half, 4);
    window = [Math.max(0, centre.tc - w), Math.min(seq.tr, centre.tc + w)];
    note = `Showing ${window[0].toFixed(1)}–${window[1].toFixed(1)} ms around the echo of line ${centre.row}.`;
  }
  $("viewNote").textContent = note;
  $("diagram").innerHTML = diagramSvg(seq, { width: Math.max(700, $("diagram").clientWidth || 1000), window, fontScale: textScale(), scale: $("scale").value });
  $("messages").innerHTML = seq.errors.map((e) => `<div class="alert">${e}. The diagram is drawn at the nearest possible value.</div>`).join("");
  const i = seq.info, scanSec = (seq.tr * shots) / 1000;
  const items = [
    ["TE", seq.te !== null ? `${seq.te.toFixed(2)} ms` : "—"],
    ["TR", `${seq.tr.toFixed(0)} ms`],
    ["Readout gradient", `${i.gRead.toFixed(2)} mT/m`],
    ["Sample spacing (dwell)", `${(i.dwell * 1000).toFixed(1)} µs`],
    ["Readout duration", `${(i.dwell * i.nx).toFixed(2)} ms`],
  ];
  if (i.minTE !== undefined) items.push(["Minimum TE", `${i.minTE.toFixed(2)} ms`]);
  if (i.esp !== undefined) items.push([state.seq === "EPI" ? "Echo spacing" : "Echo spacing (ESP)", `${i.esp.toFixed(2)} ms`]);
  if (eff !== undefined) items.push(["Effective echo", `${eff + 1} of ${state.ETL}`]);
  items.push(["TRs to fill k-space", `${shots}`], ["Scan time", `${Math.floor(scanSec / 60)}:${String(Math.round(scanSec % 60)).padStart(2, "0")}`]);
  $("info").innerHTML = items.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
}

for (const el of document.querySelectorAll("input[name=view]")) el.addEventListener("change", render);
$("scale").addEventListener("change", render);
window.addEventListener("resize", render);
window.addEventListener("textsizechange", render);
buildControls();
render();
