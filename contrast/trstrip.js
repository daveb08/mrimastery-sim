// DOM-free layout for the TR timeline strip: how the slices fill each TR, one row per concatenation (at most 4).
import { acquisitionOrder } from "../shared/sequence.js";
import { formatTime } from "./meters.js";

export const MAX_ROWS = 4;

// x positions are fractions of TR. Returns null when there is nothing to show (one slice, or a 3D sequence).
export function trStripLayout(timing, TR, order, scanSec) {
  if (!timing || timing.N <= 1 || timing.mode === "single" || timing.mode === "3d") return null;
  const N = timing.N;
  if (timing.mode === "sequential") {
    const blocks = Array.from({ length: N }, (_, i) => ({ slice: i + 1, x0: i / N, x1: (i + 1) / N }));
    return { rows: [{ blocks, idleFrom: 1 }], more: 0, caption: `${N} slices acquired one after another` };
  }
  const w = timing.slotMs / TR;
  const rows = timing.passes.slice(0, MAX_ROWS).map((members) => {
    const blocks = acquisitionOrder(members.length, order).map((m, pos) => ({
      slice: members[m] + 1, x0: Math.min(1, pos * w), x1: Math.min(1, (pos + 1) * w),
    }));
    return { blocks, idleFrom: blocks.length ? blocks[blocks.length - 1].x1 : 0 };
  });
  const C = timing.concatenations;
  return {
    rows, more: Math.max(0, timing.passes.length - MAX_ROWS),
    caption: `${N} of max ${timing.maxSlices} slices per TR · ${C} concatenation${C > 1 ? "s" : ""} · TA ${formatTime(scanSec)}`,
  };
}
