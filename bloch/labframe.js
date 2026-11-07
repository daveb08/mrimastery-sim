// Lab-frame display helpers for the rotating-frame engine in bloch.js. No DOM.
//
// The engine works in the frame rotating at the Larmor frequency. The lab view rotates each result about z by a
// display angle that advances a fixed amount per simulation frame (not per simulated millisecond): the true rate,
// tens of MHz, cannot be animated, and the animation already stretches short pulses more than long delays.
// The sense is clockwise seen from +z, the same as positive off-resonance in bloch.js (dM/dt = gamma M x B).

import { envelope } from "./bloch.js";

export const LAB_DEG_PER_FRAME = 8;

export const labAngle = (frameIndex) => (-frameIndex * LAB_DEG_PER_FRAME * Math.PI) / 180;

export function toLab([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c, z];
}

// Rotating-frame B1 at the step that produced frame `frameIndex`: its direction (the pulse phase) times its
// amplitude relative to that pulse's peak. Null at frame 0 and outside RF events. Step counts match runProgram.
export function rfAt(events, eventEnds, frameIndex) {
  if (frameIndex <= 0) return null;
  const k = eventEnds.findIndex((end) => frameIndex <= end);
  if (k < 0) return null;
  const ev = events[k];
  if (ev.type !== "rf") return null;
  const start = k === 0 ? 0 : eventEnds[k - 1];
  const steps = Math.max(1, Math.round(ev.durMs / (ev.dtMs ?? 0.05)));
  const env = envelope(ev.shape ?? "rect", steps, ev.tbw ?? 4);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, Math.abs(v));
  const amp = env[frameIndex - start - 1] / peak;
  const ph = ((ev.phaseDeg ?? 0) * Math.PI) / 180;
  return { bx: amp * Math.cos(ph), by: amp * Math.sin(ph) };
}
