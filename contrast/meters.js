// DOM-free helpers for the three always-visible trade-off meters (SNR, resolution, scan time).
// Bars are log-scaled so that a doubling moves every meter by the same distance. They show "how much", not "how good".

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const logFrac = (v, lo, hi) => (v > 0 ? clamp01(Math.log(v / lo) / Math.log(hi / lo)) : 0);

export const METERS = {
  snr: { label: "SNR (WM)", lo: 1, hi: 1000, scaleNote: "log scale, 1 to 1000" },
  resolution: { label: "In-plane resolution", lo: 0.2, hi: 5, scaleNote: "log scale, 5 mm (coarse) to 0.2 mm (fine)" },
  time: { label: "Scan time", lo: 5, hi: 1800, scaleNote: "log scale, 5 s to 30 min" },
};

// Bar fill 0-1. Resolution is inverted: smaller pixels fill the bar.
export function meterFraction(kind, value) {
  const m = METERS[kind];
  if (kind === "resolution") return value > 0 ? clamp01(Math.log(m.hi / value) / Math.log(m.hi / m.lo)) : 1;
  return logFrac(value, m.lo, m.hi);
}

export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Geometric-mean in-plane pixel size (mm).
export const inPlanePixel = ([px, py]) => Math.sqrt(px * py);

// Relative change vs a pinned baseline, as a signed percentage; null when there is no usable baseline.
export function percentChange(current, baseline) {
  if (baseline === null || baseline === undefined || !(baseline > 0)) return null;
  return ((current - baseline) / baseline) * 100;
}

export function formatPercent(pct) {
  if (pct === null) return "";
  if (Math.abs(pct) < 0.5) return "no change";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;
}

// The numbers a baseline stores and later compares against.
export function meterValues(model) {
  return { snr: model.snrs.WM, resolution: inPlanePixel(model.pixelMm), time: model.scanSec };
}
