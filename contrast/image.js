// DOM-free image formation for the contrast simulator: sample the labelled phantom at the acquired matrix and
// field of view (slab partial volume, in-plane partial volume, phase-direction wrap-around), map tissues to signal,
// add the N/2 ghost, partial-Fourier zero filling and Rician noise, then window/level to grey. Screen-up is always the phase-encode direction.
import { tissueSignal, optimalWindowLevel } from "./physics.js";
import { LABELS } from "../phantom/phantom.js";
import { unitNoise } from "./noise.js";
import { applyPartialFourier } from "./kspace.js";

export { unitNoise };

export const PLANES = ["axial", "coronal", "sagittal"];
// View centre [screen-right, screen-up] in mm, framing the head with a little neck (same as the phantom viewer).
export const CENTER = { axial: [0, 8], coronal: [0, -25], sagittal: [-8, -25] };
// Slice-position ranges (mm) per patient axis, and the phantom's approximate extent along each plane's phase direction.
export const POS_RANGE = { x: [-70, 70], y: [-105, 115], z: [-150, 95] };
export const OBJECT_EXTENT = { axial: 230, coronal: 300, sagittal: 300 };
const NORMAL_AXIS = { axial: "z", coronal: "y", sagittal: "x" };

// Illustrative values (not in the simulator's tissue table); shared by every field strength.
export const EXTRA_TISSUES = {
  muscle: { T1: 1420, T2: 32, T2s: 28, PD: 0.8, ADC: 0.0015 },
  lesion: { T1: 1400, T2: 140, T2s: 60, PD: 0.85, ADC: 0.0012 },
};

export const normalAxis = (plane) => NORMAL_AXIS[plane];

// Screen coordinates [right, up] (mm) of the point `pos` ({x,y,z}) in a plane, and the inverse for clicks.
export function patientToScreen(plane, pos) {
  if (plane === "axial") return [pos.x, pos.y];
  if (plane === "coronal") return [pos.x, pos.z];
  return [-pos.y, pos.z];
}
export function screenToPatient(plane, right, up) {
  if (plane === "axial") return { x: right, y: up };
  if (plane === "coronal") return { x: right, z: up };
  return { y: -right, z: up };
}
export const clampPos = (pos) => Object.fromEntries(Object.entries(pos).map(([k, v]) =>
  [k, Math.round(Math.min(POS_RANGE[k][1], Math.max(POS_RANGE[k][0], v)))]));

function planePoint(plane, right, up, along) {
  if (plane === "axial") return [right, up, along];
  if (plane === "coronal") return [right, along, up];
  return [along, -right, up];
}

// Which phase-direction shifts (in multiples of the phase FOV) fold into the image when the FOV is smaller than the object.
export function wrapShifts(plane, fovPhase) {
  const e = OBJECT_EXTENT[plane];
  if (e <= fovPhase) return [0];
  const k = Math.ceil((e - fovPhase) / (2 * fovPhase));
  return Array.from({ length: 2 * k + 1 }, (_, i) => i - k);
}

// Sample the phantom: nx x ny pixels over fovRead x fovPhase, thickness along the normal. The result holds one stack of
// label images per wrap shift; each pixel's signal is the mean over the stack (partial volume), summed across shifts.
export function sampleSlice(phantom, plane, position, { nx, ny, fovRead, fovPhase, thicknessMm }) {
  const px = fovRead / nx, py = fovPhase / ny;
  const zs = Math.max(1, Math.min(5, Math.round(thicknessMm / 2)));
  const ip = Math.max(px, py) > 1.5 ? 2 : 1;
  const shifts = wrapShifts(plane, fovPhase);
  const [cr, cu] = CENTER[plane];
  const groups = [];
  for (const shift of shifts) {
    const layers = [];
    for (let a = 0; a < zs; a++) {
      const along = position + (zs === 1 ? 0 : (a / (zs - 1) - 0.5) * thicknessMm);
      for (let sj = 0; sj < ip; sj++) for (let si = 0; si < ip; si++) {
        const out = new Uint8Array(nx * ny);
        for (let j = 0; j < ny; j++) {
          const up = cu + fovPhase / 2 - (j + (sj + 0.5) / ip) * py + shift * fovPhase;
          for (let i = 0; i < nx; i++) {
            const right = cr - fovRead / 2 + (i + (si + 0.5) / ip) * px;
            const [x, y, z] = planePoint(plane, right, up, along);
            out[j * nx + i] = phantom.labelAt(x, y, z);
          }
        }
        layers.push(out);
      }
    }
    groups.push(layers);
  }
  return { nx, ny, groups };
}

// Scaled signal per label (index = LABELS value) for the current parameters: physics x voxel-volume x sqrt(partial Fourier).
export function labelSignals(model, p) {
  const f = model.volScale * Math.sqrt(p.pfFraction);
  const out = new Float32Array(8);
  out[LABELS.WM] = model.baseSignals.WM * f;
  out[LABELS.GM] = model.baseSignals.GM * f;
  out[LABELS.CSF] = model.baseSignals.CSF * f;
  out[LABELS.FAT] = model.baseSignals.Fat * f;
  out[LABELS.MUSCLE] = tissueSignal(p.seq, p, EXTRA_TISSUES.muscle, false) * f;
  out[LABELS.LESION] = tissueSignal(p.seq, p, EXTRA_TISSUES.lesion, false) * f;
  return out; // AIR and BONE stay 0 (bone is a signal void)
}

export function composeSignal(sampled, lut) {
  const { nx, ny, groups } = sampled;
  const out = new Float32Array(nx * ny);
  for (const layers of groups) {
    const w = 1 / layers.length;
    for (const layer of layers) for (let i = 0; i < out.length; i++) out[i] += lut[layer[i]] * w;
  }
  return out;
}

// Nyquist (N/2) ghost of single-shot EPI: a copy shifted by half the phase FOV, at `fraction` of the amplitude.
export function addGhost(values, nx, ny, fraction) {
  if (!(fraction > 0)) return values;
  const out = new Float32Array(values.length);
  const half = Math.floor(ny / 2);
  for (let j = 0; j < ny; j++) {
    const src = ((j + half) % ny) * nx;
    for (let i = 0; i < nx; i++) out[j * nx + i] = values[j * nx + i] + fraction * values[src + i];
  }
  return out;
}

// Magnitude image of signal plus complex Gaussian noise (Rician): sigma is the model's noise floor, so SNR matches the meters.
export function addRicianNoise(values, sigma, seed) {
  if (!(sigma > 0)) return values;
  const { a, b } = unitNoise(values.length, seed);
  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(values[i] + sigma * a[i], sigma * b[i]);
  return out;
}

// Auto window/level on the pure physics signals, brought to the scaled-signal units of the image.
export function autoWindowLevel(p, model) {
  const { window, level } = optimalWindowLevel(p);
  const f = model.volScale * Math.sqrt(p.pfFraction);
  return { window: window * f, level: level * f };
}

// RGBA bytes for a window/level display.
export function toRgba(values, window, level) {
  const out = new Uint8ClampedArray(values.length * 4);
  const lo = level - window / 2;
  for (let i = 0; i < values.length; i++) {
    const g = ((values[i] - lo) / window) * 255;
    out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = g; out[4 * i + 3] = 255;
  }
  return out;
}

// Full pipeline for one plane from a cached sampling.
export function renderPlane(sampled, model, p, { window, level, noiseSeed }) {
  let v = composeSignal(sampled, labelSignals(model, p));
  if (p.seq === "EPI (single-shot)") v = addGhost(v, sampled.nx, sampled.ny, (p.ghostPct ?? 0) / 100);
  v = applyPartialFourier(v, sampled.nx, sampled.ny, p.pfFraction);
  v = addRicianNoise(v, model.noiseFloor, noiseSeed);
  return toRgba(v, window, level);
}
