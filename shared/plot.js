// Shared Plotly dark-theme helpers.
export const COLORS = { gold: "#FFD700", blue: "#6699FF", green: "#66DD66", red: "#FF4444", orange: "#FFAA44" };

export const axisStyle = (extra = {}) => ({
  gridcolor: "rgba(170,170,170,0.15)", zerolinecolor: "rgba(170,170,170,0.3)",
  linecolor: "#555", mirror: true, ...extra,
});

export function layout(extra = {}) {
  return {
    paper_bgcolor: "#242424", plot_bgcolor: "#1a1a1a", font: { color: "#ccc", size: 11 },
    margin: { l: 56, r: 14, t: 36, b: 44 },
    legend: { x: 0.99, xanchor: "right", y: 0.99, bgcolor: "rgba(26,26,26,0.85)", font: { size: 10 } },
    uirevision: "keep", // keep the user's zoom/pan across slider updates
    ...extra,
  };
}

export const config = { responsive: true, displaylogo: false, scrollZoom: true };

// The page text scale set by shared/text-size.js (1, 1.15 or 1.3).
export function textScale() {
  if (typeof document === "undefined") return 1;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ts")) || 1;
}

// Copy of a Plotly layout or trace list with every font size multiplied by s. Data arrays are shared, not copied.
const FONT_KEYS = new Set(["font", "textfont", "tickfont", "titlefont", "insidetextfont", "outsidetextfont"]);
export function scaleFonts(obj, s) {
  if (s === 1 || obj === null || typeof obj !== "object" || ArrayBuffer.isView(obj)) return obj;
  if (Array.isArray(obj)) return obj.length && obj[0] !== null && typeof obj[0] === "object" ? obj.map((v) => scaleFonts(v, s)) : obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (FONT_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { ...v };
      if (typeof v.size === "number") out[k].size = v.size * s;
      else if (Array.isArray(v.size)) out[k].size = v.size.map((x) => x * s);
    } else out[k] = scaleFonts(v, s);
  }
  return out;
}

// Draw with fonts at the current text size, and remember the call so a text-size change can redraw it.
const lastDraw = new Map();
export function draw(id, traces, lay, cfg = config) {
  lastDraw.set(id, [traces, lay, cfg]);
  const s = textScale();
  return Plotly.react(id, scaleFonts(traces, s), scaleFonts(lay, s), cfg);
}

if (typeof window !== "undefined") {
  window.addEventListener("textsizechange", () => {
    for (const [id, [traces, lay, cfg]] of lastDraw) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) draw(id, traces, lay, cfg); // hidden plots are redrawn when their tab opens
    }
  });
}
