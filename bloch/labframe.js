// Lab-frame display helpers for the rotating-frame engine in bloch.js. No DOM.
//
// The engine works in the frame rotating at the Larmor frequency. The lab view rotates each result about z by a
// display angle that advances a fixed amount per simulation frame (not per simulated millisecond): the true rate,
// tens of MHz, cannot be animated, and the animation already stretches short pulses more than long delays.
// The sense is clockwise seen from +z, the same as positive off-resonance in bloch.js (dM/dt = gamma M x B).

import { envelope, scaleToFlip } from "./bloch.js";

export const LAB_DEG_PER_FRAME = 8;

export const labAngle = (frameIndex) => (-frameIndex * LAB_DEG_PER_FRAME * Math.PI) / 180;

export function toLab([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c, z];
}

// B1 waveform of an RF event exactly as runProgram plays it (same step count, envelope and scaling; the sign of
// flipDeg reverses the field). Units are Hz of nutation, so different pulses compare directly.
function rfWave(ev) {
  const steps = Math.max(1, Math.round(ev.durMs / (ev.dtMs ?? 0.05)));
  return scaleToFlip(envelope(ev.shape ?? "rect", steps, ev.tbw ?? 4), ev.durMs, ev.flipDeg);
}

// Rotating-frame B1 at the step that produced frame `frameIndex`: its direction (the pulse phase) times its
// amplitude relative to the strongest pulse in the program, so a 180 draws twice as long as a 90 of the same
// duration. Null at frame 0 and outside RF events.
export function rfAt(events, eventEnds, frameIndex) {
  if (frameIndex <= 0) return null;
  const k = eventEnds.findIndex((end) => frameIndex <= end);
  if (k < 0) return null;
  const ev = events[k];
  if (ev.type !== "rf") return null;
  let peak = 0;
  for (const e of events) if (e.type === "rf") for (const v of rfWave(e)) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return null;
  const start = k === 0 ? 0 : eventEnds[k - 1];
  const amp = rfWave(ev)[frameIndex - start - 1] / peak;
  const ph = ((ev.phaseDeg ?? 0) * Math.PI) / 180;
  return { bx: amp * Math.cos(ph), by: amp * Math.sin(ph) };
}

// B1 drawn as a field outside the unit sphere rather than as a vector from the origin, so it cannot be mistaken
// for magnetization. B1 is uniform over the sample, so where it is drawn is a convention. The arrow starts just
// outside the sphere along the field direction (a reversed field sits on the opposite side) and its length is
// 0.4 x the field relative to the strongest pulse. Null when there is no field.
export const RIM_START = 1.08, RIM_LENGTH = 0.4;
export function rimArrow(bx, by) {
  const mag = Math.hypot(bx, by);
  if (mag < 1e-9) return null;
  const ux = bx / mag, uy = by / mag, r = RIM_START + RIM_LENGTH * mag;
  return { from: [RIM_START * ux, RIM_START * uy, 0], to: [r * ux, r * uy, 0] };
}

// Nominal flip angle (degrees, on resonance) the current pulse has applied by frame `frameIndex`: the B1 area so
// far. Null at frame 0 and outside RF events.
export function flipSoFar(events, eventEnds, frameIndex) {
  if (frameIndex <= 0) return null;
  const k = eventEnds.findIndex((end) => frameIndex <= end);
  if (k < 0 || events[k].type !== "rf") return null;
  const ev = events[k], wave = rfWave(ev), h = ev.durMs / wave.length;
  const start = k === 0 ? 0 : eventEnds[k - 1];
  let area = 0;
  for (let s = 0; s < frameIndex - start; s++) area += wave[s] * h * 1e-3;
  return 360 * area;
}
