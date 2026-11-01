// Pulse-sequence diagram geometry, ported statement by statement from draw_pulse_sequence() in the original
// MRI_Simulator/app.py. It is DOM-free: drawPulseSequence() returns a record of lines, texts, arrows and rectangles
// (the same shape the golden test extracts from the real matplotlib figures); psd_svg.js turns it into SVG.
// Time is in schematic units, amplitudes in row units; the real TR/TE/TI only appear in labels and in the spacing rules.
import * as K from "./psd_constants.js";
import { roundHalfEven } from "./physics.js";

export const ROW = { RF: 0, SS: 1, PE: 2, FE: 3, SIG: 4 };
const [RF, SS, PE, FE, SIG] = [0, 1, 2, 3, 4];
const ROW_COLORS = ["#FFD700", "#FF6666", "#66DD66", "#6699FF", "#FFFFFF"];
const [C_RF, C_SS, C_PE, C_FE] = ROW_COLORS;
export const ROW_LABELS = ["RF", "Gss", "Gpe", "Gfe", "Signal"];
export { ROW_COLORS };

const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + ((b - a) * i) / (n - 1)));
const EXC_PEAK_YMAX = (1.0 - K.PSD_Y_MIN) / (K.PSD_Y_MAX - K.PSD_Y_MIN);

class Fig {
  constructor() {
    this.axes = Array.from({ length: 5 }, () => ({
      visible: true, xlim: [0, 1], ylim: [K.PSD_Y_MIN, K.PSD_Y_MAX], lines: [], texts: [],
    }));
    for (const ax of this.axes) { // the zero line under each row
      ax.lines.push({ x: [0, 1], y: [0, 0], axv: true, color: "#3a3a3a", lw: K.BASELINE_LINEWIDTH, ls: "-", alpha: null });
    }
    this.figTexts = [];
    this.rects = [];
  }

  plot(row, x, y, color, lw = K.WAVEFORM_LINEWIDTH, ls = "-", alpha = null) {
    this.axes[row].lines.push({ x: Array.from(x), y: Array.from(y), axv: false, color, lw, ls, alpha });
  }

  axvline(row, t, color, lw, ls, alpha, ymin = 0, ymax = 1) {
    this.axes[row].lines.push({ x: [t, t], y: [ymin, ymax], axv: true, color, lw, ls, alpha });
  }

  text(row, x, y, s, { color, size, ha = "left", va = "baseline", weight = "normal", style = "normal" }) {
    this.axes[row].texts.push({ kind: "text", x, y, s, color, size, ha, va, weight, style });
  }

  arrow(row, from, to, y, color) {
    this.axes[row].texts.push({ kind: "arrow", xy: [to, y], xytext: [from, y], color, lw: K.ARROW_LINEWIDTH, arrowstyle: "<->" });
  }

  figText(x, y, s, { color, size, ha = "left", va = "baseline", weight = "normal", style = "normal" }) {
    this.figTexts.push({ kind: "text", x, y, s, color, size, ha, va, weight, style });
  }
}

// ---- drawing helpers (the nested functions of the original) ----
function trap(f, row, t0, rise, flat, fall, amp, col) {
  f.plot(row, [t0, t0 + rise, t0 + rise + flat, t0 + rise + flat + fall], [0, amp, amp, 0], col);
}

function sincRf(f, tc, amp, hw, label = null, col = "#FFD700") {
  const tt = linspace(tc - hw, tc + hw, K.RF_SINC_N);
  f.plot(RF, tt, tt.map((t) => amp * sinc((K.RF_SINC_FREQ * (t - tc)) / hw)), col);
  if (label) f.text(RF, tc, Math.abs(amp) + K.RF_LABEL_OFFSET, label, { color: col, size: K.FONT_RF_LABEL, ha: "center", va: "bottom", weight: "bold" });
}

function rectRf(f, tc, amp, hw, label = null, col = "#FFD700") {
  f.plot(RF, [tc - hw, tc - hw, tc + hw, tc + hw], [0, amp, amp, 0], col);
  if (label) f.text(RF, tc, amp + K.RF_LABEL_OFFSET, label, { color: col, size: K.FONT_RF_LABEL, ha: "center", va: "bottom", weight: "bold" });
}

function echo(f, tc, amp, hw, envFactor, freq) {
  const tt = linspace(tc - hw * K.SIGNAL_RANGE, tc + hw * K.SIGNAL_RANGE, K.SIGNAL_N);
  f.plot(SIG, tt, tt.map((t) => amp * Math.exp(-((t - tc) ** 2) / (2 * (hw * envFactor) ** 2)) * Math.cos(freq * (t - tc))),
    "#FFFFFF", K.SIGNAL_LINEWIDTH);
}
const gradEcho = (f, tc, amp, hw) => echo(f, tc, amp, hw, K.SIGNAL_ENV_GRE, K.SIGNAL_FREQ_GRE);
const spinEcho = (f, tc, amp, hw) => echo(f, tc, amp, hw, K.SIGNAL_ENV_SE, K.SIGNAL_FREQ_SE);

function annTe(f, p, tRf, tEcho, { y = K.ANN_TE_Y, label = null, rows = [FE, SIG] } = {}) {
  for (const r of rows) f.arrow(r, tRf, tEcho, y, "#AAAAAA");
  if (rows.includes(SIG)) {
    f.text(SIG, (tRf + tEcho) / 2, y - K.ANN_LABEL_OFFSET, label ?? `TE=${p.TE} ms`,
      { color: "#AAAAAA", size: K.FONT_ANN, ha: "center", va: "top" });
  }
}

function annTi(f, p, tInv, tExc, y = K.ANN_TI_Y) {
  for (const r of [SS, SIG]) f.arrow(r, tInv, tExc, y, "#FFAA44");
  f.text(SIG, (tInv + tExc) / 2, y - K.ANN_LABEL_OFFSET, `TI=${p.TI} ms`, { color: "#FFAA44", size: K.FONT_ANN, ha: "center", va: "top" });
}

function annTr(f, p, t0, t1, row = RF, y = K.ANN_TR_Y) {
  f.arrow(row, t0, t1, y, "#888888");
  f.text(row, (t0 + t1) / 2, y + K.ANN_TR_LABEL_OFF, `TR=${p.TR} ms`, { color: "#888888", size: K.FONT_ANN, ha: "center", va: "bottom" });
}

function vmark(f, t, col = "#555555") {
  for (let r = 0; r < 5; r++) f.axvline(r, t, col, K.VMARK_LINEWIDTH, ":", 0.6);
}

function faintV(f, rows, t) {
  for (const r of rows) f.axvline(r, t, "#555555", K.VMARK_LINEWIDTH, ":", 0.5);
}
const ALL_ROWS = [0, 1, 2, 3, 4];
const BELOW_RF = [SS, PE, FE, SIG];

// Excitation marker used by FSE-family sequences: a dotted line under the 90° peak on the RF row, full height elsewhere.
function excitationMarker(f, t) {
  f.axvline(RF, t, "#555555", K.VMARK_LINEWIDTH, ":", 0.5, 0, EXC_PEAK_YMAX);
  faintV(f, BELOW_RF, t);
}

function warningFigure(f, seq, warnings) {
  for (const ax of f.axes) ax.visible = false;
  f.figText(0.5, 0.5, warnings.map((w) => `⚠  ${w}`).join("\n\n"),
    { color: "#FF4444", size: 6.5, ha: "center", va: "center" });
  f.figText(0.5, 0.93, `Pulse Sequence — ${seq}`, { color: "#CCCCCC", size: K.FONT_TITLE, ha: "center", va: "top", weight: "bold" });
  return f;
}

const ESP_WARNING = "Echo spacing too short to be physically realistic\n— minimum ESP is approximately 10 ms";

// The FSE echo train shared by FSE, FLAIR/STIR and DIR. `off` shifts everything from the 90° excitation.
function fseEchoTrain(f, { off, nShow, esp, effIdx, maxDist }) {
  let tePos = null;
  for (let i = 0; i < nShow; i++) {
    const t180 = K.FSE_MAX_ESP + off + i * esp;
    const techo = t180 + K.FSE_ECHO_OFFSET * esp;
    sincRf(f, t180, 1.0, K.RF_HW_180_FSE, "180°");
    // Composite Gss: leading crusher, slice select under the 180°, trailing crusher
    const tC0 = t180 - K.RF_HW_180_FSE - K.FSE_CRUSH_SS_RISE - K.FSE_CRUSH_PRE_FLAT - K.FSE_CRUSH_RISE;
    f.plot(SS, [tC0, tC0 + K.FSE_CRUSH_RISE, t180 - K.RF_HW_180_FSE - K.FSE_CRUSH_SS_RISE, t180 - K.RF_HW_180_FSE,
      t180 + K.RF_HW_180_FSE, t180 + K.RF_HW_180_FSE + K.FSE_CRUSH_SS_RISE,
      t180 + K.RF_HW_180_FSE + K.FSE_CRUSH_SS_RISE + K.FSE_CRUSH_NEG_FLAT,
      t180 + K.RF_HW_180_FSE + K.FSE_CRUSH_SS_RISE + K.FSE_CRUSH_NEG_FLAT + K.FSE_CRUSH_RISE],
    [0, K.FSE_CRUSH_AMP, K.FSE_CRUSH_AMP, K.FSE_SS_AMP_180, K.FSE_SS_AMP_180, K.FSE_CRUSH_AMP, K.FSE_CRUSH_AMP, 0], C_SS);
    const dist = Math.abs(i - effIdx);
    const peAmp = (K.FSE_PE_AMP_MIN + ((K.FSE_PE_AMP_MAX - K.FSE_PE_AMP_MIN) * dist) / maxDist) * (i % 2 === 0 ? 1 : -1);
    const tCrushEnd = t180 + K.RF_HW_180_FSE + K.FSE_CRUSH_SS_RISE + K.FSE_CRUSH_NEG_FLAT + K.FSE_CRUSH_RISE;
    const tGfeStart = techo - K.GRAD_RISE_SM - K.FSE_GFE_READ_FLAT / 2;
    const tGfeEnd = techo + K.FSE_GFE_READ_FLAT / 2 + K.GRAD_RISE_SM;
    const tNextCrushStart = t180 + esp - K.RF_HW_180_FSE - K.FSE_CRUSH_SS_RISE - K.FSE_CRUSH_PRE_FLAT - K.FSE_CRUSH_RISE;
    const blipHw = K.GRAD_RISE_XS + K.FSE_GPE_BLIP_FLAT / 2;
    const encWin = tGfeStart - tCrushEnd;
    const encC = encWin >= 2 * blipHw ? (tCrushEnd + tGfeStart) / 2 : tCrushEnd + blipHw;
    trap(f, PE, encC - blipHw, K.GRAD_RISE_XS, K.FSE_GPE_BLIP_FLAT, K.GRAD_RISE_XS, peAmp, C_PE);
    trap(f, FE, tGfeStart, K.GRAD_RISE_SM, K.FSE_GFE_READ_FLAT, K.GRAD_RISE_SM, K.FSE_GFE_ECHO_AMP, C_FE);
    const rewWin = tNextCrushStart - tGfeEnd;
    const rewC = rewWin >= 2 * blipHw ? (tGfeEnd + tNextCrushStart) / 2 : tGfeEnd + blipHw;
    trap(f, PE, rewC - blipHw, K.GRAD_RISE_XS, K.FSE_GPE_BLIP_FLAT, K.GRAD_RISE_XS, -peAmp, C_PE);
    const eamp = Math.max(K.FSE_SIG_AMP_EFF * Math.exp(-dist * K.FSE_SIG_DECAY), 0.15);
    spinEcho(f, techo, eamp, K.SIGNAL_HW_SE);
    if (i === effIdx) tePos = techo;
  }
  return tePos;
}

// 90° excitation block of the FSE family (Gss main lobe + rephaser + Gfe prephase), at offset `off` from the FSE origin.
function fseExcitationGradients(f, off) {
  const gssT0 = K.FSE_GSS_T0 + off;
  trap(f, SS, gssT0, K.GRAD_RISE, K.GRAD_SS_FLAT, K.GRAD_RISE, K.GRAD_SS_AMP, C_SS);
  const repStart = gssT0 + K.GRAD_RISE + K.GRAD_SS_FLAT + K.GRAD_RISE;
  trap(f, SS, repStart, K.GRAD_SS_REP_RISE, K.FSE_GSS_REP_FLAT, K.GRAD_SS_REP_RISE, K.GRAD_SS_REP_AMP, C_SS);
  trap(f, FE, K.FSE_GFE_T0 + off, K.GRAD_RISE_MD, K.FSE_GFE_FLAT, K.GRAD_RISE_MD, K.FSE_GFE_AMP, C_FE);
}

const showingNote = (f, text) => f.figText(0.67, 0.95, text, { color: "white", size: K.FONT_TITLE, weight: "bold", ha: "left", va: "top" });

// ================================================================
function drawGre(f, p) {
  const { TE, FA } = p;
  const gfeRoHw = K.GRAD_RISE + K.GRAD_FE_READ_FLAT / 2;
  const gpeHw = K.GRAD_RISE + K.GRAD_PE_FLAT / 2;
  const gfeDepRise = (Math.abs(K.GRAD_FE_DEP_AMP) / K.GRAD_FE_READ_AMP) * K.GRAD_RISE;
  const gssSsEnd = K.GRE_GSS_T0 + K.GRE_GSS_RISE + K.GRE_GSS_FLAT + K.GRE_GSS_RISE;
  const gssRepRise = (Math.abs(K.GRE_GSS_REP_AMP) / K.GRE_GSS_REF_AMP) * K.GRE_GSS_RISE;
  const gssRepEnd = gssSsEnd + gssRepRise + K.GRE_GSS_REP_FLAT + gssRepRise;
  const prepW = gfeDepRise + K.GRAD_FE_DEP_FLAT + gfeDepRise;
  const teSMin = gssRepEnd + prepW + gfeRoHw;
  const teMinMs = Math.ceil(((teSMin - K.GRE_TE_MIN) * K.GRE_TE_MAX_MS) / K.GRE_TE_RANGE);
  const teS = Math.max(teSMin, K.GRE_TE_MIN + (Math.min(TE, K.GRE_TE_MAX_MS) / K.GRE_TE_MAX_MS) * K.GRE_TE_RANGE);
  const gfeRoStart = teS - gfeRoHw;
  const gfePrepT0 = Math.max(gssRepEnd, gfeRoStart - gfeDepRise - K.GRAD_FE_DEP_FLAT - gfeDepRise);
  const gpeEncT0 = gssSsEnd;
  const gpeEncC = gpeEncT0 + gpeHw;
  const gpeRewC = 2 * teS - gpeEncC;
  const gpeRewT0 = gpeRewC - gpeHw;
  const gssScale = K.GRE_GSS_MAX_AMP / (K.GRE_GSS_REF_AMP * p.sliceMm);
  const gssAmp = K.GRE_GSS_REF_AMP * gssScale;
  const gssRepAmp = K.GRE_GSS_REP_AMP * gssScale;
  const gfeScale = (p.BW / K.GRE_GFE_REF_BW) * (K.GRE_GFE_REF_FOV / p.fovRead);
  const gfeAmp = K.GRAD_FE_READ_AMP * gfeScale;
  const gfeDepAmp = K.GRAD_FE_DEP_AMP * gfeScale;
  const ghostX = K.GRE_RF_TC + (K.T_TOTAL - K.GRE_RF_TC) * K.GRE_XLIM_SCALE;
  const gpeRewEnd = gpeRewT0 + K.GRAD_RISE + K.GRAD_PE_FLAT + K.GRAD_RISE;
  const ghostEnd = ghostX - K.GRE_GHOST_GSS_OFFSET + K.GRE_GSS_RISE + K.GRE_GSS_FLAT + K.GRE_GSS_RISE;
  const xlimRight = Math.max(ghostEnd, gpeRewEnd) + 0.3;
  sincRf(f, K.GRE_RF_TC, 1.0, K.GRE_RF_HW, `${FA}°`);
  trap(f, SS, K.GRE_GSS_T0, K.GRE_GSS_RISE, K.GRE_GSS_FLAT, K.GRE_GSS_RISE, gssAmp, C_SS);
  trap(f, SS, gssSsEnd, gssRepRise, K.GRE_GSS_REP_FLAT, gssRepRise, gssRepAmp, C_SS);
  trap(f, PE, gpeEncT0, K.GRAD_RISE, K.GRAD_PE_FLAT, K.GRAD_RISE, K.GRAD_PE_AMP, C_PE);
  trap(f, PE, gpeRewT0, K.GRAD_RISE, K.GRAD_PE_FLAT, K.GRAD_RISE, -K.GRAD_PE_AMP, C_PE);
  trap(f, FE, gfePrepT0, gfeDepRise, K.GRAD_FE_DEP_FLAT, gfeDepRise, gfeDepAmp, C_FE);
  trap(f, FE, gfeRoStart, K.GRAD_RISE, K.GRAD_FE_READ_FLAT, K.GRAD_RISE, gfeAmp, C_FE);
  gradEcho(f, teS, K.GRE_SIG_AMP, K.SIGNAL_HW_GRE);
  sincRf(f, ghostX, K.GRE_GHOST_AMP, K.GRE_RF_HW, null, C_RF + "55");
  trap(f, SS, ghostX - K.GRE_GHOST_GSS_OFFSET, K.GRE_GSS_RISE, K.GRE_GSS_FLAT, K.GRE_GSS_RISE, gssAmp, C_SS + "44");
  if (TE < teMinMs) {
    f.figText(0.5, 0.5, `⚠  TE too short: minimum achievable TE is ${teMinMs} ms`,
      { color: "#FF4444", size: 6.5, ha: "center", va: "center" });
  }
  vmark(f, K.GRE_RF_TC, C_RF);
  vmark(f, teS, "#AAAAAA");
  annTe(f, p, K.GRE_RF_TC, teS, { rows: [SIG] });
  annTr(f, p, K.GRE_RF_TC, ghostX);
  return xlimRight;
}

function fseGeometry(p, nominalEsp) {
  const nShow = Math.min(p.ETL, K.FSE_MAX_ECHOES_TO_SHOW);
  const tauS = K.FSE_MAX_ESP - K.FSE_RF_TC;
  const esp = 2.0 * tauS;
  const effIdx = Math.max(0, Math.min(nShow - 1, roundHalfEven(p.TE / nominalEsp) - 1));
  const maxDist = Math.max(effIdx, nShow - 1 - effIdx, 1);
  return { nShow, tauS, esp, effIdx, maxDist, espMs: p.TE / (effIdx + 1) };
}

function drawFse(f, p) {
  const g = fseGeometry(p, K.FSE_NOMINAL_ESP_MS);
  const minTr = p.ETL * g.espMs;
  const warn = [];
  if (p.TR < minTr) warn.push(`TR too short: minimum TR for current ETL and TEeff is ${Math.trunc(minTr)} ms`);
  if (g.espMs < 10.0) warn.push(ESP_WARNING);
  if (warn.length) return { early: warn };
  sincRf(f, K.FSE_RF_TC, 1.0, K.RF_HW_EXCITE, "90°");
  excitationMarker(f, K.FSE_RF_TC);
  fseExcitationGradients(f, 0);
  const tePos = fseEchoTrain(f, { off: 0, ...g });
  const tEnd = K.FSE_RF_TC + 2 * g.nShow * g.tauS;
  if (tePos !== null) annTe(f, p, K.FSE_RF_TC, tePos, { label: `TEeff = ${p.TE} ms`, rows: [SIG] });
  if (p.ETL > K.FSE_MAX_ECHOES_TO_SHOW) showingNote(f, `(Showing ${K.FSE_MAX_ECHOES_TO_SHOW} of ${p.ETL} echoes)`);
  annTr(f, p, K.FSE_RF_TC, tEnd, SS);
  return { xlimRight: tEnd + K.FSE_XLIM_PAD };
}

function drawFlair(f, p) {
  let tiS = K.FLAIR_TI_MIN_S + (p.TI / p.TR) * (K.T_TOTAL - K.FLAIR_TI_RANGE);
  tiS = Math.max(K.FLAIR_TI_CLAMP_MIN, Math.min(tiS, K.FLAIR_TI_CLAMP_MAX));
  const tInv = K.FLAIR_T_INV;
  const tExc = tInv + tiS;
  const g = fseGeometry(p, K.FLAIR_NOMINAL_ESP_MS);
  const off = tExc - K.FSE_RF_TC;
  const minTr = p.TI + p.ETL * g.espMs;
  const warn = [];
  if (p.TR < minTr) warn.push(`TR too short: minimum TR for current TI, ETL and TEeff is ${Math.trunc(minTr)} ms`);
  if (g.espMs < 10.0) warn.push(ESP_WARNING);
  if (warn.length) return { early: warn };
  sincRf(f, tInv, 1.0, K.RF_HW_INV, "180° inv");
  trap(f, SS, tInv - K.FLAIR_GSS_INV_OFFSET, K.GRAD_RISE_MD, K.GRAD_SS_INV_FLAT, K.GRAD_RISE_MD, K.GRAD_SS_INV_AMP, C_SS);
  const spoilT0 = tInv + K.FLAIR_GSS_INV_OFFSET;
  trap(f, SS, spoilT0, K.GRAD_RISE_MD, K.FLAIR_GSPOILER_FLAT, K.GRAD_RISE_MD, K.FLAIR_GSPOILER_AMP, C_SS);
  faintV(f, ALL_ROWS, tInv);
  excitationMarker(f, tExc);
  sincRf(f, tExc, 1.0, K.RF_HW_EXCITE, "90°");
  fseExcitationGradients(f, off);
  const tePos = fseEchoTrain(f, { off, ...g });
  const tEnd = tExc + 2 * g.nShow * g.tauS;
  if (tePos !== null) annTe(f, p, tExc, tePos, { label: `TEeff = ${p.TE} ms`, rows: [SIG] });
  if (p.ETL > K.FSE_MAX_ECHOES_TO_SHOW) showingNote(f, `(Showing ${K.FSE_MAX_ECHOES_TO_SHOW} of ${p.ETL} echoes)`);
  annTi(f, p, tInv, tExc);
  annTr(f, p, tInv, tEnd, SS);
  return { xlimRight: tEnd + K.FSE_XLIM_PAD };
}

function drawDir(f, p) {
  const ti1 = p.TI, ti2 = p.TI2;
  const totalTiMs = Math.max(1, ti1 + ti2);
  let tiTotalS = K.DIR_TI_TOTAL_MIN_S + (totalTiMs / p.TR) * (K.T_TOTAL - K.DIR_TI_TOTAL_RANGE);
  tiTotalS = Math.max(K.DIR_TI1_MIN_S + K.DIR_TI2_MIN_S, Math.min(tiTotalS, 6.8));
  const ti1S = Math.max(K.DIR_TI1_MIN_S, (tiTotalS * ti1) / totalTiMs);
  const ti2S = Math.max(K.DIR_TI2_MIN_S, tiTotalS - ti1S);
  const tInv1 = K.DIR_T_INV1;
  const tInv2 = tInv1 + ti1S;
  const tExc = tInv2 + ti2S;
  const spoilGapFixed = K.FLAIR_GSS_INV_OFFSET + (K.FSE_RF_TC - K.FSE_GSS_T0);
  const spoilNomWidth = 2 * K.GRAD_RISE_MD + K.FLAIR_GSPOILER_FLAT;
  const spoilAvail = ti2S - spoilGapFixed;
  const g = fseGeometry(p, K.DIR_NOMINAL_ESP_MS);
  const off = tExc - K.FSE_RF_TC;
  const minTr = ti1 + ti2 + p.ETL * g.espMs;
  const warn = [];
  if (p.TR < minTr) warn.push(`TR too short: minimum TR for current TI1, TI2, ETL and TEeff is ${Math.trunc(minTr)} ms`);
  if (g.espMs < 10.0) warn.push(ESP_WARNING);
  if (spoilAvail < K.DIR_GSPOILER_MIN_WIDTH_S) {
    warn.push(`TI2 too short: the inversion spoiler gradient cannot fit between the second inversion and the 90° excitation at TI1=${ti1} ms, TI2=${ti2} ms — increase TI2 (or decrease TI1)`);
  }
  if (warn.length) return { early: warn };
  rectRf(f, tInv1, 1.0, K.RF_HW_INV, "180°");
  trap(f, SS, tInv1 - K.DIR_NS_GSS_RISE - K.DIR_NS_GSS_FLAT / 2, K.DIR_NS_GSS_RISE, K.DIR_NS_GSS_FLAT, K.DIR_NS_GSS_RISE, K.DIR_NS_GSS_AMP, C_SS);
  sincRf(f, tInv2, 1.0, K.RF_HW_INV, "180°");
  trap(f, SS, tInv2 - K.FLAIR_GSS_INV_OFFSET, K.GRAD_RISE_MD, K.GRAD_SS_INV_FLAT, K.GRAD_RISE_MD, K.GRAD_SS_INV_AMP, C_SS);
  const spoilT0 = tInv2 + K.FLAIR_GSS_INV_OFFSET;
  let sRise = K.GRAD_RISE_MD, sFlat = K.FLAIR_GSPOILER_FLAT, sAmp = K.FLAIR_GSPOILER_AMP;
  if (spoilAvail < spoilNomWidth) {
    const scale = spoilAvail / spoilNomWidth;
    sRise = K.GRAD_RISE_MD * scale;
    sFlat = K.FLAIR_GSPOILER_FLAT * scale;
    sAmp = Math.min(K.FLAIR_GSPOILER_AMP / scale, K.DIR_GSPOILER_MAX_AMP);
  }
  trap(f, SS, spoilT0, sRise, sFlat, sRise, sAmp, C_SS);
  for (const tv of [tInv1, tInv2]) faintV(f, ALL_ROWS, tv);
  excitationMarker(f, tExc);
  sincRf(f, tExc, 1.0, K.RF_HW_EXCITE, "90°");
  fseExcitationGradients(f, off);
  const tePos = fseEchoTrain(f, { off, ...g });
  const tEnd = tExc + 2 * g.nShow * g.tauS;
  if (tePos !== null) annTe(f, p, tExc, tePos, { label: `TEeff = ${p.TE} ms`, rows: [SIG] });
  if (p.ETL > K.FSE_MAX_ECHOES_TO_SHOW) showingNote(f, `(Showing ${K.FSE_MAX_ECHOES_TO_SHOW} of ${p.ETL} echoes)`);
  for (const r of [SS, SIG]) f.arrow(r, tInv1, tInv2, K.ANN_TI_Y, "#FFAA44");
  f.text(SIG, (tInv1 + tInv2) / 2, K.ANN_TI_Y - K.ANN_LABEL_OFFSET, `TI1 = ${ti1} ms`, { color: "#FFAA44", size: K.FONT_ANN, ha: "center", va: "top" });
  const ti2Y = K.ANN_TI_Y + 0.38;
  for (const r of [SS, SIG]) f.arrow(r, tInv2, tExc, ti2Y, "#FFAA44");
  f.text(SIG, (tInv2 + tExc) / 2, ti2Y - K.ANN_LABEL_OFFSET, `TI2 = ${ti2} ms`, { color: "#FFAA44", size: K.FONT_ANN, ha: "center", va: "top" });
  annTr(f, p, tInv1, tEnd, SS);
  return { xlimRight: tEnd + K.DIR_XLIM_PAD };
}

function drawMprage(f, p) {
  let tiS = K.MPRAGE_TI_MIN_S + (p.TI / p.TR) * (K.T_TOTAL - K.MPRAGE_TI_RANGE);
  tiS = Math.max(K.MPRAGE_TI_CLAMP_MIN, Math.min(tiS, K.MPRAGE_TI_CLAMP_MAX));
  const tInv1 = K.MPRAGE_T_INV1;
  const tExc1 = tInv1 + tiS;
  rectRf(f, tInv1, 1.0, K.RF_HW_INV, "180°");
  trap(f, SS, tInv1 - K.DIR_NS_GSS_RISE - K.DIR_NS_GSS_FLAT / 2, K.DIR_NS_GSS_RISE, K.DIR_NS_GSS_FLAT, K.DIR_NS_GSS_RISE, K.DIR_NS_GSS_AMP, C_SS);
  faintV(f, ALL_ROWS, tInv1);
  excitationMarker(f, tExc1);
  const rfAmp = K.MPRAGE_RF_AMP_MIN + K.MPRAGE_RF_AMP_PER_DEG * Math.max(0, p.FA - 5);

  const greRep = (t0, peAmp) => {
    const gssT0 = t0 - K.MPRAGE_REP_RF_HW - K.MPRAGE_REP_GSS_RISE;
    const gssSsEnd = gssT0 + K.MPRAGE_REP_GSS_RISE + K.MPRAGE_REP_GSS_FLAT + K.MPRAGE_REP_GSS_RISE;
    const gssRepEnd = gssSsEnd + K.MPRAGE_REP_GSS_REP_RISE + K.MPRAGE_REP_GSS_REP_FLAT + K.MPRAGE_REP_GSS_REP_RISE;
    const gpeHw = K.MPRAGE_REP_GPE_RISE + K.MPRAGE_REP_GPE_FLAT / 2;
    const gpeEncC = gssSsEnd + gpeHw;
    const prepW = 2 * K.MPRAGE_REP_GFE_DEP_RISE + K.MPRAGE_REP_GFE_DEP_FLAT;
    const gfeRoHw = K.MPRAGE_REP_GFE_RO_RISE + K.MPRAGE_REP_GFE_RO_FLAT / 2;
    const teC = gssRepEnd + prepW + gfeRoHw;
    const gfeRoStart = teC - gfeRoHw;
    const gpeRewC = 2 * teC - gpeEncC;
    const gpeRewT0 = gpeRewC - gpeHw;
    sincRf(f, t0, rfAmp, K.MPRAGE_REP_RF_HW, `${p.FA}°`);
    trap(f, SS, gssT0, K.MPRAGE_REP_GSS_RISE, K.MPRAGE_REP_GSS_FLAT, K.MPRAGE_REP_GSS_RISE, K.GRE_GSS_REF_AMP, C_SS);
    trap(f, SS, gssSsEnd, K.MPRAGE_REP_GSS_REP_RISE, K.MPRAGE_REP_GSS_REP_FLAT, K.MPRAGE_REP_GSS_REP_RISE, K.MPRAGE_REP_GSS_REP_AMP, C_SS);
    trap(f, PE, gpeEncC - gpeHw, K.MPRAGE_REP_GPE_RISE, K.MPRAGE_REP_GPE_FLAT, K.MPRAGE_REP_GPE_RISE, peAmp, C_PE);
    trap(f, PE, gpeRewT0, K.MPRAGE_REP_GPE_RISE, K.MPRAGE_REP_GPE_FLAT, K.MPRAGE_REP_GPE_RISE, -peAmp, C_PE);
    trap(f, FE, gssRepEnd, K.MPRAGE_REP_GFE_DEP_RISE, K.MPRAGE_REP_GFE_DEP_FLAT, K.MPRAGE_REP_GFE_DEP_RISE, K.MPRAGE_REP_GFE_DEP_AMP, C_FE);
    trap(f, FE, gfeRoStart, K.MPRAGE_REP_GFE_RO_RISE, K.MPRAGE_REP_GFE_RO_FLAT, K.MPRAGE_REP_GFE_RO_RISE, K.MPRAGE_REP_GFE_RO_AMP, C_FE);
    const repEnd = Math.max(gfeRoStart + 2 * K.MPRAGE_REP_GFE_RO_RISE + K.MPRAGE_REP_GFE_RO_FLAT,
      gpeRewT0 + 2 * K.MPRAGE_REP_GPE_RISE + K.MPRAGE_REP_GPE_FLAT);
    return [teC, repEnd];
  };

  const nSteps = K.MPRAGE_N_SHOW + 1;
  const echoTimes = [];
  let repEndLast = tExc1;
  for (let i = 0; i < K.MPRAGE_N_SHOW; i++) {
    const t0 = tExc1 + i * K.MPRAGE_REP_SPACING;
    const peAmp = -K.MPRAGE_PE_AMP_MAX + (2 * K.MPRAGE_PE_AMP_MAX * i) / (nSteps - 1);
    const [teC, repEnd] = greRep(t0, peAmp);
    repEndLast = repEnd;
    echoTimes.push(teC);
  }
  const dotsX = repEndLast + K.MPRAGE_DOTS_GAP / 2;
  [[RF, C_RF], [SS, C_SS], [PE, C_PE], [FE, C_FE], [SIG, "#FFFFFF"]].forEach(([row, col]) =>
    f.text(row, dotsX, 0.0, "· · ·", { color: col, size: 7, ha: "center", va: "center", style: "italic" }));
  const t0Final = repEndLast + K.MPRAGE_DOTS_GAP + K.MPRAGE_REP_RF_HW + K.MPRAGE_REP_GSS_RISE;
  const [teFinal, repEndFinal] = greRep(t0Final, K.MPRAGE_PE_AMP_MAX);
  echoTimes.push(teFinal);

  const tauSig = Math.max(tiS, 0.5);
  for (const te of echoTimes) {
    const sigAmp = K.MPRAGE_SIG_MIN + (K.MPRAGE_SIG_MAX - K.MPRAGE_SIG_MIN) * (1 - Math.exp(-(te - tInv1) / tauSig));
    gradEcho(f, te, Math.min(sigAmp, K.MPRAGE_SIG_MAX), K.MPRAGE_SIG_HW);
  }
  annTi(f, p, tInv1, tExc1);
  const trRoEnd = tExc1 + K.MPRAGE_REP_SPACING;
  f.arrow(PE, tExc1, trRoEnd, K.ANN_TR_Y, C_PE);
  f.text(PE, (tExc1 + trRoEnd) / 2, K.ANN_TR_Y + K.ANN_TR_LABEL_OFF, `TR_readout = ${K.MPRAGE_TR_READOUT} ms`,
    { color: C_PE, size: K.FONT_ANN, ha: "center", va: "bottom" });
  const tInv2 = repEndFinal + K.MPRAGE_RECOVERY_GAP_S;
  annTr(f, p, tInv1, tInv2, SS);
  faintV(f, ALL_ROWS, tInv2);
  rectRf(f, tInv2, K.GRE_GHOST_AMP, K.RF_HW_INV, null, C_RF + "55");
  trap(f, SS, tInv2 - K.DIR_NS_GSS_RISE - K.DIR_NS_GSS_FLAT / 2, K.DIR_NS_GSS_RISE, K.DIR_NS_GSS_FLAT, K.DIR_NS_GSS_RISE, K.DIR_NS_GSS_AMP, C_SS + "44");
  if (p.nPartitions > K.MPRAGE_N_SHOW + 1) showingNote(f, `(Showing 4 of ${p.nPartitions} partition-encode readouts)`);
  return tInv2 + K.MPRAGE_XLIM_PAD;
}

function drawBssfp(f, p) {
  const trW = K.T_TOTAL / K.N_BSSFP_REPS;
  for (let i = 0; i < K.N_BSSFP_REPS; i++) {
    const t0 = i * trW;
    const tc = t0 + trW * K.BSSFP_RF_OFF;
    const teC = t0 + trW * K.BSSFP_SIG_OFF;
    const sign = i % 2 === 0 ? 1 : -1;
    const amp = i === 0 ? K.BSSFP_TR1_AMP : 1.0;
    const faLbl = sign > 0 ? `+${p.FA}°` : `−${p.FA}°`;
    sincRf(f, tc, sign * amp, K.RF_HW_BSSFP, faLbl);
    const tSsC0 = tc - K.GRAD_RISE_XS - K.BSSFP_GSS_MAIN_FLAT / 2;
    const tSsEnd = tc + K.GRAD_RISE_XS + K.BSSFP_GSS_MAIN_FLAT / 2;
    const durPreSs = 2 * K.GRAD_RISE_XS + K.BSSFP_GSS_HALFPRE_FLAT;
    const tSsPre0 = tSsC0 - durPreSs;
    trap(f, SS, tSsPre0, K.GRAD_RISE_XS, K.BSSFP_GSS_HALFPRE_FLAT, K.GRAD_RISE_XS, -K.BSSFP_SS_AMP, C_SS);
    trap(f, SS, tSsC0, K.GRAD_RISE_XS, K.BSSFP_GSS_MAIN_FLAT, K.GRAD_RISE_XS, K.BSSFP_SS_AMP, C_SS);
    trap(f, SS, tSsEnd, K.GRAD_RISE_XS, K.BSSFP_GSS_HALFPRE_FLAT, K.GRAD_RISE_XS, -K.BSSFP_SS_AMP, C_SS);
    const tRoC0 = teC - K.GRAD_RISE_XS - K.BSSFP_GFE_RO_FLAT / 2;
    trap(f, FE, tSsPre0, K.GRAD_RISE_XS, K.BSSFP_GSS_HALFPRE_FLAT, K.GRAD_RISE_XS, -K.BSSFP_FE_AMP, C_FE);
    trap(f, FE, tSsEnd, K.GRAD_RISE_XS, K.BSSFP_GSS_HALFPRE_FLAT, K.GRAD_RISE_XS, -K.BSSFP_FE_AMP, C_FE);
    trap(f, FE, tRoC0, K.GRAD_RISE_XS, K.BSSFP_GFE_RO_FLAT, K.GRAD_RISE_XS, K.GRAD_FE_READ_AMP, C_FE);
    trap(f, PE, tSsPre0, K.GRAD_RISE_XS, K.BSSFP_GSS_HALFPRE_FLAT, K.GRAD_RISE_XS, -K.BSSFP_PE_AMP * sign, C_PE);
    trap(f, PE, tSsEnd, K.GRAD_RISE_XS, K.BSSFP_GSS_HALFPRE_FLAT, K.GRAD_RISE_XS, K.BSSFP_PE_AMP * sign, C_PE);
    gradEcho(f, teC, amp * K.BSSFP_SIG_SCALE, K.SIGNAL_HW_BSSFP);
    f.axvline(RF, t0, K.BSSFP_VMARK_COLOR, K.BASELINE_LINEWIDTH, ":", null);
  }
  const tc0 = trW * K.BSSFP_RF_OFF;
  const teC0 = trW * K.BSSFP_SIG_OFF;
  const tc1 = trW + tc0;
  annTr(f, p, tc0, tc1, SS);
  f.arrow(FE, tc0, teC0, K.ANN_TE_Y, "#AAAAAA");
  f.text(FE, (tc0 + teC0) / 2, K.ANN_TE_Y + 0.15, "TE = TR/2", { color: "#AAAAAA", size: K.FONT_ANN, ha: "center", va: "bottom" });
  f.rects.push({ xy: [trW, K.PSD_MARGIN_BOT], w: trW, h: K.PSD_MARGIN_TOP - K.PSD_MARGIN_BOT, edge: K.BSSFP_REPEAT_COLOR.toLowerCase(),
    lw: K.BSSFP_RECT_LINEWIDTH, ls: "--" });
  f.text(RF, 1.5 * trW, K.ANN_TR_Y + 0.10, "Repeating unit", { color: K.BSSFP_REPEAT_COLOR, size: K.FONT_ANN, ha: "center", va: "center", style: "italic" });
  f.text(RF, 2.5 * trW, K.ANN_TR_Y, `×${K.N_BSSFP_REPS} TRs shown`, { color: "#777777", size: K.BSSFP_FONT_REPS, ha: "center" });
  return K.T_TOTAL;
}

function drawEpi(f, p) {
  const gssEnd = K.EPI_GSS_T0 + K.EPI_GSS_RISE + K.EPI_GSS_FLAT + K.EPI_GSS_RISE;
  const gssRepEnd = gssEnd + K.EPI_GSS_REP_RISE + K.EPI_GSS_REP_FLAT + K.EPI_GSS_REP_RISE;
  const prepEnd = gssRepEnd + K.EPI_FE_PREP_RISE + K.EPI_FE_PREP_FLAT + K.EPI_FE_PREP_RISE;
  const espS = K.EPI_RO_FLAT + 2 * K.EPI_RO_RISE;
  sincRf(f, K.EPI_RF_TC, 1.0, K.RF_HW_EXCITE, "90°");
  trap(f, SS, K.EPI_GSS_T0, K.EPI_GSS_RISE, K.EPI_GSS_FLAT, K.EPI_GSS_RISE, K.GRAD_SS_AMP, C_SS);
  trap(f, SS, gssEnd, K.EPI_GSS_REP_RISE, K.EPI_GSS_REP_FLAT, K.EPI_GSS_REP_RISE, K.EPI_GSS_REP_AMP, C_SS);
  trap(f, PE, gssRepEnd, K.EPI_PE_PREP_RISE, K.EPI_PE_PREP_FLAT, K.EPI_PE_PREP_RISE, K.EPI_PE_PREP_AMP, C_PE);
  const peCx = gssRepEnd + K.EPI_PE_PREP_RISE + K.EPI_PE_PREP_FLAT / 2;
  f.text(PE, peCx, K.EPI_PE_PREP_AMP / 2, "Ap,p", { color: C_PE, size: K.FONT_ANN - 0.5, ha: "center", va: "center", style: "italic" });
  trap(f, FE, gssRepEnd, K.EPI_FE_PREP_RISE, K.EPI_FE_PREP_FLAT, K.EPI_FE_PREP_RISE, K.EPI_FE_PREP_AMP, C_FE);

  const tZz = [prepEnd], yZz = [0.0];
  let tCur = prepEnd;
  const echoCenters = [], blipStarts = [];
  for (let i = 0; i < K.EPI_N_SHOW; i++) {
    const amp = i % 2 === 0 ? K.EPI_RO_AMP : -K.EPI_RO_AMP;
    if (i === 0) { tZz.push(tCur + K.EPI_RO_RISE); yZz.push(amp); tCur += K.EPI_RO_RISE; }
    echoCenters.push(tCur + K.EPI_RO_FLAT / 2);
    tZz.push(tCur + K.EPI_RO_FLAT); yZz.push(amp);
    tCur += K.EPI_RO_FLAT;
    if (i < K.EPI_N_SHOW - 1) {
      blipStarts.push(tCur);
      tZz.push(tCur + 2 * K.EPI_RO_RISE); yZz.push(-amp);
      tCur += 2 * K.EPI_RO_RISE;
    } else {
      tZz.push(tCur + K.EPI_RO_RISE); yZz.push(0.0);
      tCur += K.EPI_RO_RISE;
    }
  }
  f.plot(FE, tZz, yZz, C_FE);
  for (const bs of blipStarts) trap(f, PE, bs, K.EPI_BLIP_RISE, K.EPI_BLIP_FLAT, K.EPI_BLIP_RISE, K.EPI_BLIP_AMP, C_PE);
  [[FE, C_FE], [PE, C_PE], [SIG, "#FFFFFF"]].forEach(([row, col]) =>
    f.text(row, K.EPI_DOTS_X, 0.0, "· · ·", { color: col, size: 7, ha: "center", va: "center", style: "italic" }));
  const finalCenter = K.EPI_FINAL_RO_T0 + K.EPI_RO_RISE + K.EPI_RO_FLAT / 2;
  trap(f, FE, K.EPI_FINAL_RO_T0, K.EPI_RO_RISE, K.EPI_RO_FLAT, K.EPI_RO_RISE, K.EPI_RO_AMP, C_FE);

  const allCenters = [...echoCenters, finalCenter];
  const allIndices = [...Array.from({ length: K.EPI_N_SHOW }, (_, i) => i), p.epiReadouts - 1];
  allCenters.forEach((ec, k) => {
    const eamp = Math.max(0.10, K.EPI_SIG_PEAK * Math.exp(-allIndices[k] * K.EPI_SIG_DECAY));
    gradEcho(f, ec, eamp, K.SIGNAL_HW_GRE * K.EPI_SIG_HW_SCALE);
  });
  const tauEnv = espS / K.EPI_SIG_DECAY;
  const tEnv0 = echoCenters[0];
  const tEnvEnd = echoCenters[echoCenters.length - 1] + K.EPI_RO_FLAT / 2;
  const tEnv = linspace(tEnv0, tEnvEnd, 200);
  f.plot(SIG, tEnv, tEnv.map((t) => K.EPI_SIG_PEAK * Math.exp(-(t - tEnv0) / tauEnv)), "#AAAAAA", 0.5, ":", 0.85);

  const finalIdx = p.epiReadouts - 1;
  let tePos;
  if (p.epiEffIdx < K.EPI_N_SHOW) tePos = echoCenters[p.epiEffIdx];
  else if (p.epiEffIdx === finalIdx) tePos = finalCenter;
  else {
    const frac = (p.epiEffIdx - (K.EPI_N_SHOW - 1)) / Math.max(1, finalIdx - (K.EPI_N_SHOW - 1));
    tePos = echoCenters[echoCenters.length - 1] + frac * (finalCenter - echoCenters[echoCenters.length - 1]);
  }
  vmark(f, K.EPI_RF_TC, C_RF);
  vmark(f, tePos, "#AAAAAA");
  f.arrow(SIG, K.EPI_RF_TC, tePos, K.ANN_TE_Y, "#AAAAAA");
  f.text(SIG, (K.EPI_RF_TC + tePos) / 2, K.ANN_TE_Y - K.ANN_LABEL_OFFSET, `TEeff = ${p.TE} ms`, { color: "#AAAAAA", size: K.FONT_ANN, ha: "center", va: "top" });
  const trEnd = K.EPI_FINAL_RO_T0 + K.EPI_RO_RISE + K.EPI_RO_FLAT + K.EPI_RO_RISE + 0.10;
  annTr(f, p, K.EPI_RF_TC, trEnd, SS);
  f.figText(0.50, 0.055, "N/2 ghost: phase inconsistencies between alternating ±Gfe readout directions shift the ghost N/2 pixels in the phase-encode direction",
    { color: "#FFAA44", size: 4.5, ha: "center", va: "bottom", style: "italic" });
  return K.EPI_XLIM_RIGHT;
}

export const PSD_SEQUENCES = ["FSE", "GRE", "FLAIR", "STIR", "bSSFP", "DIR", "MPRAGE", "EPI (single-shot)"];

// p: the simulator parameters (seq, TR, TE, TI, TI2, FA, ETL, sliceMm, BW, fovRead, nPartitions) plus, for EPI,
// epiEffIdx and epiReadouts (= phase matrix). Returns null for sequences without a diagram (DWI).
export function drawPulseSequence(p) {
  const seq = p.seq;
  if (!PSD_SEQUENCES.includes(seq)) return null;
  const f = new Fig();
  let xlimRight;
  let r;
  switch (seq) {
    case "GRE": xlimRight = drawGre(f, p); break;
    case "FSE": r = drawFse(f, p); break;
    case "FLAIR": case "STIR": r = drawFlair(f, p); break;
    case "DIR": r = drawDir(f, p); break;
    case "MPRAGE": xlimRight = drawMprage(f, p); break;
    case "bSSFP": xlimRight = drawBssfp(f, p); break;
    default: xlimRight = drawEpi(f, p);
  }
  if (r) {
    if (r.early) return warningFigure(f, seq, r.early);
    xlimRight = r.xlimRight;
  }
  for (const ax of f.axes) ax.xlim = [0, xlimRight];
  f.figText(0.5, 0.01, "Time  →", { color: "#555555", size: K.FONT_FOOTER, ha: "center" });
  f.figText(0.5, 0.95, `Pulse Sequence — ${seq}`, { color: "#CCCCCC", size: K.FONT_TITLE, ha: "center", va: "top", weight: "bold" });
  return f;
}

// Map the simulator's parameters (and model) to the arguments the diagram needs.
export function psdParams(p, model) {
  return {
    ...p, TI: p.TI, TI2: p.TI2,
    epiEffIdx: model?.timing?.effIdx ?? 1, epiReadouts: p.phaseMatrix,
  };
}
