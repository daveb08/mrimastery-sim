// Render a pulse-sequence record (psd.js) as an inline SVG that follows the original figure's layout:
// an 8 x 3 inch figure, five rows sharing one time axis, drawn on a 100 px-per-inch grid.
import * as K from "./psd_constants.js";
import { ROW_LABELS, ROW_COLORS } from "./psd.js";

const PX_PER_IN = 100;
const W = K.PSD_FIG_SIZE[0] * PX_PER_IN, H = K.PSD_FIG_SIZE[1] * PX_PER_IN;
const PT = PX_PER_IN / 72; // points to viewBox pixels
const rowHeight = (K.PSD_MARGIN_TOP - K.PSD_MARGIN_BOT) / (5 + 4 * K.PSD_HSPACE); // fraction of the figure height
const rowTop = (r) => K.PSD_MARGIN_TOP - r * rowHeight * (1 + K.PSD_HSPACE); // figure fraction, from the bottom

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => (Math.round(v * 100) / 100).toString();

// "#RRGGBBAA" -> { color: "#RRGGBB", opacity }
function splitColor(c, alpha) {
  let color = c, opacity = alpha ?? 1;
  if (/^#[0-9a-fA-F]{8}$/.test(c)) { color = c.slice(0, 7); opacity *= parseInt(c.slice(7), 16) / 255; }
  return { color, opacity };
}

function dash(ls, lw) {
  if (ls === ":") return ` stroke-dasharray="${n(lw * PT)} ${n(lw * PT * 1.65)}"`;
  if (ls === "--") return ` stroke-dasharray="${n(lw * PT * 3.7)} ${n(lw * PT * 1.6)}"`;
  return "";
}

// opts.fontScale makes the small schematic labels legible when the diagram is shown at less than full size.
export function psdToSvg(fig, { fontScale = 1.0 } = {}) {
  const xlim = fig.axes[0].xlim, span = xlim[1] - xlim[0];
  const left = K.PSD_MARGIN_LEFT * W, width = (K.PSD_MARGIN_RIGHT - K.PSD_MARGIN_LEFT) * W;
  const X = (t) => left + ((t - xlim[0]) / span) * width;
  const rowBottomPx = (r) => (1 - (rowTop(r) - rowHeight)) * H;
  const rowTopPx = (r) => (1 - rowTop(r)) * H;
  const Y = (r, v) => rowBottomPx(r) - ((v - K.PSD_Y_MIN) / (K.PSD_Y_MAX - K.PSD_Y_MIN)) * (rowBottomPx(r) - rowTopPx(r));
  const fs = (pt) => pt * PT * fontScale;

  const text = (t, px, py) => {
    const { color, opacity } = splitColor(t.color);
    const anchor = { left: "start", center: "middle", right: "end" }[t.ha];
    const size = fs(t.size);
    const dy = { top: 0.8, center: 0.35, bottom: -0.2, baseline: 0 }[t.va] * size;
    const lines = String(t.s).split("\n");
    const lineH = size * 1.25;
    const up = { center: (lines.length - 1) * lineH / 2, bottom: (lines.length - 1) * lineH }[t.va] ?? 0; // multi-line text grows downward from top/baseline
    const y0 = py + dy - up;
    return lines.map((ln, i) => `<text x="${n(px)}" y="${n(y0 + i * lineH)}" fill="${color}" fill-opacity="${n(opacity)}" font-size="${n(size)}"`
      + ` text-anchor="${anchor}"${t.weight === "bold" ? ' font-weight="bold"' : ""}${t.style === "italic" ? ' font-style="italic"' : ""}>${esc(ln)}</text>`).join("");
  };

  const parts = [];
  parts.push(`<defs>${fig.axes.map((_, r) => `<clipPath id="psdclip${r}"><rect x="${n(left)}" y="${n(rowTopPx(r))}" width="${n(width)}" height="${n(rowBottomPx(r) - rowTopPx(r))}"/></clipPath>`).join("")}</defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#1a1a1a"/>`);

  fig.axes.forEach((ax, r) => {
    if (!ax.visible) return;
    parts.push(`<text x="${n(left - 30 * PT)}" y="${n((rowTopPx(r) + rowBottomPx(r)) / 2 + fs(K.FONT_ROW_LABEL) * 0.35)}" fill="${ROW_COLORS[r]}" font-size="${n(fs(K.FONT_ROW_LABEL))}" text-anchor="end">${ROW_LABELS[r]}</text>`);
    const lines = ax.lines.map((ln) => {
      const { color, opacity } = splitColor(ln.color, ln.alpha);
      let pts;
      if (ln.axv && ln.x[0] === ln.x[1]) pts = [[X(ln.x[0]), rowBottomPx(r) - ln.y[0] * (rowBottomPx(r) - rowTopPx(r))], [X(ln.x[1]), rowBottomPx(r) - ln.y[1] * (rowBottomPx(r) - rowTopPx(r))]];
      else if (ln.axv) pts = [[left + ln.x[0] * width, Y(r, ln.y[0])], [left + ln.x[1] * width, Y(r, ln.y[1])]];
      else pts = ln.x.map((x, i) => [X(x), Y(r, ln.y[i])]);
      return `<polyline points="${pts.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="none" stroke="${color}" stroke-opacity="${n(opacity)}" stroke-width="${n(ln.lw * PT)}"${dash(ln.ls, ln.lw)} stroke-linejoin="round"/>`;
    });
    parts.push(`<g clip-path="url(#psdclip${r})">${lines.join("")}</g>`);
    for (const t of ax.texts) {
      if (t.kind === "arrow") {
        const x1 = X(t.xytext[0]), x2 = X(t.xy[0]), y = Y(r, t.xy[1]), a = 3.2 * PT;
        const { color } = splitColor(t.color);
        parts.push(`<g stroke="${color}" stroke-width="${n(t.lw * PT)}" fill="none"><line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}"/>`
          + `<path d="M${n(x1 + a)},${n(y - a * 0.7)} L${n(x1)},${n(y)} L${n(x1 + a)},${n(y + a * 0.7)}"/>`
          + `<path d="M${n(x2 - a)},${n(y - a * 0.7)} L${n(x2)},${n(y)} L${n(x2 - a)},${n(y + a * 0.7)}"/></g>`);
      } else parts.push(text(t, X(t.x), Y(r, t.y)));
    }
  });

  for (const rc of fig.rects) {
    parts.push(`<rect x="${n(X(rc.xy[0]))}" y="${n((1 - rc.xy[1] - rc.h) * H)}" width="${n((rc.w / span) * width)}" height="${n(rc.h * H)}" fill="none" stroke="${rc.edge}" stroke-width="${n(rc.lw * PT)}"${dash(rc.ls, rc.lw)}/>`);
  }
  for (const t of fig.figTexts) {
    if (t.s.startsWith("⚠")) { // the original draws warnings in a rounded red box
      const lines = t.s.split("\n"), size = fs(t.size), boxW = Math.min(W - 20, Math.max(...lines.map((l) => l.length)) * size * 0.55 + 30);
      const boxH = lines.length * size * 1.25 + 24;
      parts.push(`<rect x="${n(t.x * W - boxW / 2)}" y="${n((1 - t.y) * H - boxH / 2)}" width="${n(boxW)}" height="${n(boxH)}" rx="6" fill="#1a1a1a" fill-opacity=".9" stroke="#FF4444"/>`);
    }
    parts.push(text(t, t.x * W, (1 - t.y) * H));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pulse sequence diagram" style="width:100%;height:auto;display:block">${parts.join("")}</svg>`;
}
