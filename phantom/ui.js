import { createPhantom, sliceLabels, LABELS } from "./phantom.js";
import { tissuesAt } from "../contrast/physics.js";

const $ = (id) => document.getElementById(id);
const FOV = 250;
// View centre [screen-right, screen-up] in mm: shifts the frame to include the face and neck.
const CENTER = { axial: [0, 8], coronal: [0, -25], sagittal: [-8, -25] };

// WM, GM, CSF and fat come from the contrast simulator's 3.0 T table (T1/T2 in ms, PD 0-1).
// Bone is treated as signal void; lesion and muscle rows are illustrative.
const T3 = tissuesAt("3.0T");
const TISSUE = {
  [LABELS.AIR]:    { name: "Air",         color: [0, 0, 0],       PD: 0,    T1: 1000, T2: 1 },
  [LABELS.WM]:     { name: "White matter", color: [68, 114, 196],  PD: T3.WM.PD,  T1: T3.WM.T1,  T2: T3.WM.T2 },
  [LABELS.GM]:     { name: "Gray matter",  color: [237, 125, 49],  PD: T3.GM.PD,  T1: T3.GM.T1,  T2: T3.GM.T2 },
  [LABELS.CSF]:    { name: "CSF",          color: [169, 209, 142], PD: T3.CSF.PD, T1: T3.CSF.T1, T2: T3.CSF.T2 },
  [LABELS.FAT]:    { name: "Fat",          color: [255, 217, 102], PD: T3.Fat.PD, T1: T3.Fat.T1, T2: T3.Fat.T2 },
  [LABELS.BONE]:   { name: "Cortical bone", color: [140, 140, 140], PD: 0.0, T1: 300,  T2: 1 },
  [LABELS.LESION]: { name: "Lesion",       color: [235, 70, 70],   PD: 0.85, T1: 1400, T2: 140 },
  // Illustrative skeletal-muscle values at 3 T (not in the contrast simulator's tissue table).
  [LABELS.MUSCLE]: { name: "Muscle / soft tissue", color: [176, 112, 128], PD: 0.80, T1: 1420, T2: 32 },
};
const PROTOCOL = {
  T1w: { TR: 500, TE: 15 }, T2w: { TR: 4000, TE: 100 }, PD: { TR: 4000, TE: 15 },
  FLAIR: { TR: 9000, TE: 100, TI: 2500 },
};

$("legend").innerHTML = Object.entries(TISSUE).filter(([k]) => +k !== LABELS.AIR).map(([k, t]) =>
  `<span><span class="sw" style="background:rgb(${t.color})"></span>${t.name}</span>`).join("");

function signal(label, mode) {
  const t = TISSUE[label];
  if (mode === "labels") return null;
  const { TR, TE, TI } = PROTOCOL[mode];
  const e1 = Math.exp(-TR / t.T1), e2 = Math.exp(-TE / t.T2);
  if (mode === "FLAIR") return t.PD * Math.abs(1 - 2 * Math.exp(-TI / t.T1) + e1) * e2;
  return t.PD * (1 - e1) * e2;
}

// "brain" windows on the parenchyma (WM sits at 60% brightness; fat and CSF may saturate), which
// shows the GM/WM contrast. "full" maps the brightest tissue to white.
function lookup(mode, windowMode) {
  const lut = new Uint8ClampedArray(8 * 3);
  const values = Object.keys(TISSUE).map((k) => (mode === "labels" ? 0 : signal(+k, mode)));
  let top = Math.max(...values, 1e-9);
  if (mode !== "labels" && windowMode === "brain") {
    top = Math.max(signal(LABELS.WM, mode), signal(LABELS.GM, mode)) / 0.6;
  }
  for (const k of Object.keys(TISSUE)) {
    const c = mode === "labels" ? TISSUE[k].color : Array(3).fill(255 * Math.min(1, signal(+k, mode) / top));
    lut.set(c, 3 * +k);
  }
  return lut;
}

let phantom = null, key = "";
function draw() {
  const sulcal = +$("sulcal").value, seed = +$("seed").value, lesions = $("lesions").checked;
  const mode = $("mode").value, size = +$("res").value;
  $("sulcalV").textContent = sulcal; $("seedV").textContent = seed;
  const pos = { axial: +$("zpos").value, coronal: +$("ypos").value, sagittal: +$("xpos").value };
  $("zposV").textContent = pos.axial; $("yposV").textContent = pos.coronal; $("xposV").textContent = pos.sagittal;
  const k = `${sulcal}|${seed}|${lesions}`;
  if (k !== key) { phantom = createPhantom({ seed, sulcalDepthMm: sulcal, lesions }); key = k; }
  const lut = lookup(mode, $("window").value);
  const t0 = performance.now();
  for (const plane of ["axial", "coronal", "sagittal"]) {
    const canvas = $(plane);
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const labels = sliceLabels(phantom, plane, pos[plane], size, FOV, CENTER[plane]);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < labels.length; i++) {
      img.data[4 * i] = lut[3 * labels[i]]; img.data[4 * i + 1] = lut[3 * labels[i] + 1];
      img.data[4 * i + 2] = lut[3 * labels[i] + 2]; img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  $("stats").textContent = `Rendered three ${size} × ${size} slices in ${(performance.now() - t0).toFixed(0)} ms (FOV ${FOV} mm).`;
}

// Optional URL settings, e.g. ?mode=T1w&res=384&lesions=1&seed=3&z=20
const q = new URLSearchParams(location.search);
for (const [param, id] of [["mode", "mode"], ["window", "window"], ["res", "res"], ["sulcal", "sulcal"], ["seed", "seed"], ["z", "zpos"], ["y", "ypos"], ["x", "xpos"]]) {
  if (q.has(param)) $(id).value = q.get(param);
}
if (q.get("lesions") === "1") $("lesions").checked = true;

let pending = false;
const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; draw(); }); } };
for (const id of ["mode", "window", "res", "sulcal", "seed", "lesions", "zpos", "ypos", "xpos"]) $(id).addEventListener("input", schedule);
draw();
