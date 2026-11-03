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

// Scroll-wheel zoom starts off so the wheel scrolls the page; clicking a plot turns it on until the pointer leaves.
export const config = { responsive: true, displaylogo: false, scrollZoom: false };

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
  const el = document.getElementById(id);
  const s = textScale();
  const result = Plotly.react(el, scaleFonts(traces, s), withLiveCameras(el, scaleFonts(lay, s)), { ...cfg, scrollZoom: el.classList.contains("plot-active") });
  wireScrollZoom(el);
  return result;
}

// ---- click to enable scroll-wheel zoom ----
function setScrollZoom(el, on) {
  if (!el.data || el.classList.contains("plot-active") === on) return;
  el.classList.toggle("plot-active", on);
  const cfg = lastDraw.get(el.id)?.[2] ?? config;
  Plotly.react(el, el.data, withLiveCameras(el), { ...cfg, scrollZoom: on });
  if (on) document.addEventListener("pointermove", el._zoomWatch);
  else document.removeEventListener("pointermove", el._zoomWatch);
}

// The layout with each 3D scene's camera as it is now. Plotly writes a rotated or zoomed 3D view back to the layout
// only some of the time, so redrawing from el.layout alone can jump back to an older view.
function withLiveCameras(el, base = el.layout) {
  const lay = { ...base };
  for (const [key, scene] of Object.entries(el._fullLayout ?? {})) {
    if (/^scene\d*$/.test(key) && scene?._scene?.getCamera) lay[key] = { ...lay[key], camera: scene._scene.getCamera() };
  }
  return lay;
}

let hint = null, hintTimer = 0;
function showHint(e) {
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "plot-zoom-hint";
    hint.setAttribute("role", "status");
    hint.textContent = "Click the plot to zoom with the scroll wheel";
    document.body.appendChild(hint);
  }
  hint.style.left = `${e.clientX + 14}px`;
  hint.style.top = `${e.clientY + 14}px`;
  hint.classList.add("show");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove("show"), 1400);
}

function wireScrollZoom(el) {
  if (el.dataset.zoomWired) return;
  el.dataset.zoomWired = "1";
  // capture phase: Plotly's drag layer stops mousedown before it would bubble up to the plot element
  el.addEventListener("pointerdown", () => setScrollZoom(el, true), true);
  // Turn it off once the pointer is outside the plot. Not "mouseleave": Plotly covers the page with a drag layer
  // while a button is held, which the browser reports as leaving the plot.
  el._zoomWatch = (e) => {
    if (e.buttons) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setScrollZoom(el, false);
  };
  el.addEventListener("wheel", (e) => { if (!el.classList.contains("plot-active")) showHint(e); }, { passive: true });
}

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = ".js-plotly-plot.plot-active{outline:1px solid #FFD700;outline-offset:2px;border-radius:2px}"
    + ".plot-zoom-hint{position:fixed;z-index:1000;pointer-events:none;background:rgba(20,20,20,.92);color:#e6e6e6;"
    + "border:1px solid #FFD700;border-radius:6px;padding:5px 9px;font:.85rem system-ui,sans-serif;opacity:0;transition:opacity .2s}"
    + ".plot-zoom-hint.show{opacity:1}";
  document.head.appendChild(style);
}

if (typeof window !== "undefined") {
  window.addEventListener("textsizechange", () => {
    for (const [id, [traces, lay, cfg]] of lastDraw) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) draw(id, traces, lay, cfg); // hidden plots are redrawn when their tab opens
    }
  });
}
