/*
 * Home page: the Bloch bench drawing, the site tour and the guided sessions. Content is in home/tour-data.js and the
 * physics in home/bench.js; this file only draws and handles clicks. No network calls and no AI.
 */
import { MODS, TOUR, PATHS, SESS } from "./tour-data.js";
import { magnetization, windowMs, clampBench, niceStep } from "./bench.js";
import { WEIGHTINGS, labelLut, imageFromLabels, kspaceOf, centerOutRows, reconFromRows } from "./showcase.js";
import { createPhantom, sliceLabels } from "../phantom/phantom.js";

const $ = (id) => document.getElementById(id);
const MOD = (id) => MODS.find((m) => m.id === id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (el) => el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });

/* ---- Bloch bench ---------------------------------------------------------------------------------------------- */
const S = { flip: 90, t1: 780, t2: 90, t: 0 };
const svg = $("sv"), fig = $("fig");
const win = () => windowMs(S.t1, S.t2);
const mag = (t) => magnetization(t, S);

function draw() {
  const W = fig.clientWidth, H = fig.clientHeight;
  if (!W || !H) return;
  const narrow = W < 520, Tw = win();
  const bw = narrow ? W : W * 0.48, bh = narrow ? H * 0.5 : H;
  const R = Math.min(bw * 0.36, bh * 0.34), cx = bw * 0.48, cy = bh * 0.56;
  const P = (x, y, z) => [cx + R * (0.92 * x - 0.5 * y), cy + R * (0.22 * x + 0.32 * y - 0.95 * z)];
  const f = (n) => n.toFixed(1);
  const ln = (a, b, c, w, d) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${c}" stroke-width="${w}"${d ? ` stroke-dasharray="${d}"` : ""}/>`;
  let o = `<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--signal)"/></marker></defs>`;
  let ring = "";
  for (let i = 0; i <= 48; i++) { const p = P(Math.cos(i / 48 * 2 * Math.PI), Math.sin(i / 48 * 2 * Math.PI), 0); ring += (i ? "L" : "M") + f(p[0]) + " " + f(p[1]); }
  o += `<path d="${ring}" fill="rgba(77,141,255,.07)" stroke="var(--line)"/>`;
  const O = P(0, 0, 0);
  o += ln(P(-1.15, 0, 0), P(1.15, 0, 0), "var(--line)", 1.5) + ln(P(0, -1.15, 0), P(0, 1.15, 0), "var(--line)", 1.5) + ln(O, P(0, 0, 1.25), "var(--cool)", 2);
  const lx = P(1.25, 0, 0), ly = P(0, 1.3, 0), lz = P(0, 0, 1.32);
  o += `<text x="${f(lx[0])}" y="${f(lx[1] + 5)}">x</text><text x="${f(ly[0] - 14)}" y="${f(ly[1] + 8)}">y</text><text x="${f(lz[0] + 8)}" y="${f(lz[1] + 4)}" style="fill:var(--cool)">B0, z</text>`;
  const ph = (t) => 2 * Math.PI * 6 * t / Tw; // six turns across the window: precession slowed so it can be followed
  const tip = (t) => { const m = mag(t); return P(m.xy * Math.cos(ph(t)), m.xy * Math.sin(ph(t)), m.z); };
  if (S.t > 0) {
    let tr = "";
    for (let i = 0; i <= 90; i++) { const p = tip(S.t * i / 90); tr += (i ? "L" : "M") + f(p[0]) + " " + f(p[1]); }
    o += `<path d="${tr}" fill="none" stroke="var(--signal)" stroke-width="1.5" opacity=".45"/>`;
  }
  const m = mag(S.t), T = tip(S.t), F = P(m.xy * Math.cos(ph(S.t)), m.xy * Math.sin(ph(S.t)), 0);
  o += ln(F, T, "var(--muted)", 1, "3 4") + ln(O, F, "var(--signal)", 1.5, "4 3");
  o += `<line x1="${f(O[0])}" y1="${f(O[1])}" x2="${f(T[0])}" y2="${f(T[1])}" stroke="var(--signal)" stroke-width="4" stroke-linecap="round" marker-end="url(#ah)"/>`;
  o += `<text x="${f(T[0] + 10)}" y="${f(T[1] - 8)}" style="fill:var(--signal);font-weight:600">M</text>`;
  // the two traces
  const gx = narrow ? 44 : bw + 44, gw = (narrow ? W : W - bw) - 64, top = narrow ? bh + 8 : 24, gh = (H - top - 36) / 2 - 18;
  const plot = (y0, key, col, label, lo) => {
    const X = (t) => gx + gw * t / Tw, Y = (v) => y0 + gh * (1 - (v - lo) / (1 - lo));
    let s = ln([gx, y0], [gx, y0 + gh], "var(--line)", 1) + ln([gx, Y(0)], [gx + gw, Y(0)], "var(--line)", 1);
    if (lo < 0) s += `<text x="${gx - 8}" y="${f(Y(0) + 5)}" text-anchor="end">0</text>`;
    s += `<text x="${gx - 8}" y="${f(Y(1) + 5)}" text-anchor="end">1</text><text x="${gx + 6}" y="${f(y0 + 14)}" style="fill:${col};font-weight:600">${label}</text>`;
    let full = "", now = "";
    for (let i = 0; i <= 120; i++) {
      const t = Tw * i / 120, p = `${f(X(t))} ${f(Y(mag(t)[key]))}`;
      full += (i ? "L" : "M") + p;
      if (t <= S.t) now += (now ? "L" : "M") + p;
    }
    s += `<path d="${full}" fill="none" stroke="${col}" stroke-width="1.5" opacity=".3"/>`;
    if (now) s += `<path d="${now}" fill="none" stroke="${col}" stroke-width="3"/>`;
    return s + `<circle cx="${f(X(S.t))}" cy="${f(Y(mag(S.t)[key]))}" r="5" fill="${col}"/>`;
  };
  o += plot(top, "z", "var(--teal)", "Mz, T1 recovery", -1);
  o += plot(top + gh + 30, "xy", "var(--signal)", "Mxy, T2 decay", 0);
  const st = niceStep(Tw), yb = top + 2 * gh + 34;
  for (let t = 0; t <= Tw + 1; t += st) {
    if (narrow && (t / st) % 2) continue;
    o += `<text x="${f(gx + gw * t / Tw)}" y="${f(yb + 14)}" text-anchor="middle">${t >= 1000 ? t / 1000 + " s" : t}</text>`;
  }
  svg.innerHTML = o;
  $("rt").textContent = Math.round(S.t) + " ms";
  $("rz").textContent = m.z.toFixed(2);
  $("rxy").textContent = m.xy.toFixed(2);
}
const figObserver = new ResizeObserver(draw);
figObserver.observe(fig);

let raf = 0;
function play() {
  cancelAnimationFrame(raf);
  if (reduced) { S.t = win() * 0.35; draw(); return; }
  const t0 = performance.now(), dur = 5500, Tw = win();
  const step = (now) => { const k = Math.min((now - t0) / dur, 1); S.t = Tw * k; draw(); if (k < 1) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
}
function syncControls() {
  $("fa").value = S.flip; $("t1").value = S.t1; $("t2").value = S.t2;
  $("fao").textContent = S.flip + "°"; $("t1o").textContent = S.t1 + " ms"; $("t2o").textContent = S.t2 + " ms";
}
function setBench(p) {
  Object.assign(S, clampBench(p, S));
  S.t = Math.min(S.t, win());
  syncControls(); draw();
}
for (const [id, key] of [["fa", "flip"], ["t1", "t1"], ["t2", "t2"]]) {
  $(id).addEventListener("input", (e) => { setBench({ [key]: e.target.value }); $("ps").value = ""; });
}
$("ps").addEventListener("change", (e) => {
  if (!e.target.value) return;
  const [t1, t2] = e.target.value.split(",");
  setBench({ t1, t2 }); play();
});
$("play").addEventListener("click", play);
syncControls(); S.t = win() * 0.08; draw();

/* ---- tour sketches -------------------------------------------------------------------------------------------- */
function sketch(id) {
  const L = 'stroke="var(--line)" fill="none"', A = 'stroke="var(--signal)" fill="none" stroke-width="2.5"', T = 'stroke="var(--teal)" fill="none" stroke-width="2"';
  let o = "";
  if (id === "bloch") o = `<ellipse cx="200" cy="72" rx="80" ry="22" ${L}/><line x1="200" y1="72" x2="200" y2="12" stroke="var(--cool)" stroke-width="1.5"/><path d="M200 72 L262 48" ${A}/><path d="M120 72 Q200 96 280 72" ${T} opacity=".6"/>`;
  else if (id === "signal") {
    let a = "";
    for (let i = 0; i <= 80; i++) { const x = (i - 40) / 4, y = x ? Math.sin(Math.PI * x) / (Math.PI * x) : 1; a += (i ? "L" : "M") + (30 + i * 2) + " " + (80 - y * 55).toFixed(1); }
    o = `<path d="${a}" ${A}/><path d="M230 80 L265 80 L265 28 L335 28 L335 80 L370 80" ${T}/><text x="200" y="60" text-anchor="middle" style="stroke:none;font-size:20px">→</text>`;
  } else if (id === "coil") {
    o = `<ellipse cx="200" cy="80" rx="60" ry="10" ${A}/>`;
    for (let k = 1; k <= 4; k++) o += `<path d="M${140 - k * 18} 80 Q200 ${50 - k * 16} ${260 + k * 18} 80" ${T} opacity="${(1 - k * 0.18).toFixed(2)}"/>`;
  } else if (id === "tuning") o = `<circle cx="200" cy="55" r="45" ${L}/><circle cx="222" cy="55" r="23" ${L}/><line x1="155" y1="55" x2="245" y2="55" stroke="var(--line)"/><path d="M168 30 Q190 70 200 55" ${T}/><circle cx="200" cy="55" r="5" fill="var(--signal)"/>`;
  else if (id === "contrast") o = ["#d9d9d9", "#777", "#555", "#eee"].map((c, i) => `<rect x="${120 + (i % 2) * 84}" y="${12 + Math.floor(i / 2) * 46}" width="76" height="40" rx="3" fill="${c}"/>`).join("");
  else if (id === "kspace") {
    for (let i = 0; i < 9; i++) o += `<line x1="140" y1="${15 + i * 10}" x2="260" y2="${15 + i * 10}" stroke="var(--line)"/>`;
    let p = "M140 15";
    for (let i = 0; i < 9; i++) { const y = 15 + i * 10, x = i % 2 ? 140 : 260; p += ` L${x} ${y}` + (i < 8 ? ` L${x} ${y + 10}` : ""); }
    o += `<path d="${p}" ${A}/><circle cx="200" cy="55" r="4" fill="var(--teal)"/>`;
  } else if (id === "phantom") o = `<ellipse cx="200" cy="56" rx="42" ry="50" fill="#bbb"/><ellipse cx="200" cy="56" rx="34" ry="42" fill="#8a8a8a"/><path d="M190 40 Q186 58 194 68 M210 40 Q214 58 206 68" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  else o = `<path d="M60 90 L200 90 L330 25" ${A}/><path d="M200 90 L200 15" stroke="var(--cool)" stroke-width="2.5"/><text x="210" y="22" style="stroke:none">B0</text>`;
  return `<svg viewBox="0 0 400 110" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${o}</svg>`;
}

/* ---- the tour ------------------------------------------------------------------------------------------------- */
const DEFAULT_ORDER = ["intro", "bloch", "signal", "coil", "tuning", "contrast", "kspace", "phantom"];
let path = null, i = 0;
const seen = new Set();
try {
  const v = JSON.parse(localStorage.getItem("mpb-tour") || "null");
  if (v && PATHS.some((p) => p.id === v.p)) { path = v.p; i = Math.min(DEFAULT_ORDER.length - 1, Math.max(0, v.i | 0)); }
} catch { /* storage blocked: start at the beginning */ }
const order = () => (PATHS.find((p) => p.id === path) || { o: DEFAULT_ORDER }).o;
const save = () => { try { localStorage.setItem("mpb-tour", JSON.stringify({ p: path, i })); } catch { /* not kept */ } };

function renderTour() {
  const o = order(), id = o[i], st = TOUR[id], m = MOD(id);
  seen.add(id);
  $("tc").textContent = `Stop ${i + 1} of ${o.length}`;
  $("dots").innerHTML = o.map((k, j) => `<button class="dot${j === i ? " on" : seen.has(k) ? " seen" : ""}" type="button" aria-current="${j === i ? "step" : "false"}" aria-label="${j ? TOUR[k].t : "Start"}" data-j="${j}">${j || "★"}</button>`).join("");
  let h = `<div class="pv">${sketch(id)}</div><div><h3>${st.t}</h3><span class="kind">${st.k}</span></div><p>${st.p}</p>`;
  if (id === "intro") {
    h += `<h4>What are you studying?</h4><div class="paths">${PATHS.map((p) => `<button class="path${p.id === path ? " on" : ""}" type="button" data-p="${p.id}" id="path-${p.id}">${p.n}<small>${p.d}</small></button>`).join("")}</div>`;
  } else {
    h += `<h4>Try this</h4><ol>${st.try.map((t) => `<li>${t}</li>`).join("")}</ol><p class="for"><b>Good for:</b> ${st.for}</p>`;
    h += `<div class="acts2"><a class="pill" href="${m.u}">Open ${st.t}</a>${st.bench ? `<button class="pill line" type="button" id="showbench">Show me on the bench</button>` : ""}</div>`;
  }
  $("stop").innerHTML = h;
  $("stop").dataset.stop = id;
  $("bn").textContent = "";
  $("prev").disabled = i === 0;
  $("next").textContent = i === o.length - 1 ? "Finish" : "Next";
  $("nx").textContent = i < o.length - 1 ? "Next: " + TOUR[o[i + 1]].t : "Then try a guided session";
  save();
}
function go(j) {
  const o = order();
  if (j >= o.length) { scrollTo($("sessions")); return; }
  i = Math.max(0, Math.min(o.length - 1, j));
  renderTour();
}
$("prev").addEventListener("click", () => go(i - 1));
$("next").addEventListener("click", () => go(i + 1));
$("dots").addEventListener("click", (e) => { const b = e.target.closest("[data-j]"); if (b) go(+b.dataset.j); });
$("stop").addEventListener("click", (e) => {
  const p = e.target.closest("[data-p]");
  if (p) { path = p.dataset.p; i = 1; renderTour(); return; }
  if (e.target.closest("#showbench")) {
    const b = TOUR[order()[i]].bench;
    showSlide(0, true); setBench(b); play();
    $("bn").textContent = b.n;
    if (innerWidth < 1000) scrollTo($("bh"));
  }
});
$("tour").addEventListener("keydown", (e) => {
  if (e.target.matches("input, select")) return;
  if (e.key === "ArrowRight") go(i + 1);
  if (e.key === "ArrowLeft") go(i - 1);
});
renderTour();

/* ---- guided sessions ------------------------------------------------------------------------------------------ */
$("sl").innerHTML = SESS.map((x) => `<article class="sess" id="s-${x.id}"><h3>${x.n}</h3><p class="who">${x.w}</p><ol>${x.s.map((st, k) => `<li><div><b>${st.b}</b><span class="q">${st.q}</span><div class="acts">${st.m === "bench"
  ? `<button type="button" data-try="${x.id}|${k}">Try it on the bench</button>`
  : `<a href="${MOD(st.m).u}">Open ${MOD(st.m).n}</a>`}<button type="button" data-ans="${x.id}|${k}" aria-expanded="false" aria-controls="a-${x.id}-${k}">Show answer</button></div><div class="ans" id="a-${x.id}-${k}">${st.a}</div></div></li>`).join("")}</ol></article>`).join("");
$("sl").addEventListener("click", (e) => {
  const t = e.target.closest("[data-try]"), a = e.target.closest("[data-ans]");
  if (t) {
    const [id, k] = t.dataset.try.split("|");
    showSlide(0, true); setBench(SESS.find((s) => s.id === id).s[+k].set); play();
    scrollTo($("bh"));
  }
  if (a) {
    const el = $("a-" + a.dataset.ans.replace("|", "-"));
    const open = el.classList.toggle("open");
    a.textContent = open ? "Hide answer" : "Show answer";
    a.setAttribute("aria-expanded", String(open));
  }
});

/* ---- "See it in the tour" on the simulator cards -------------------------------------------------------------- */
$("modules").addEventListener("click", (e) => {
  const b = e.target.closest("[data-stop]");
  if (!b) return;
  const j = order().indexOf(b.dataset.stop);
  if (j >= 0) { go(j); scrollTo($("tour")); }
});

/* ---- rotating showcase: Bloch bench, contrast, k-space ------------------------------------------------------------
 * Rotates every ROTATE_MS. Pauses while the pointer or keyboard focus is in the panel, and while the panel is off
 * screen or the tab is hidden. Stops for good when the visitor picks a tab, presses Pause or uses any control, and
 * never rotates under prefers-reduced-motion. */
const ROTATE_MS = 9000;
const SLIDES = ["bloch", "contrast", "kspace"];
const show = $("show");
let current = 0, auto = !reduced, hovering = false, onScreen = true, elapsed = 0, last = performance.now();

function showSlide(k, stop = false) {
  if (stop) stopAuto();
  current = k; elapsed = 0;
  SLIDES.forEach((id, j) => {
    const on = j === k, tab = $("tab-" + id), slide = $("slide-" + id);
    tab.classList.toggle("on", on); tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1;
    slide.classList.toggle("on", on); slide.inert = !on;
  });
  if (SLIDES[k] === "bloch") { draw(); if (!stop) play(); }
  if (SLIDES[k] === "contrast") startContrast();
  if (SLIDES[k] === "kspace") startKspace();
}
function stopAuto() {
  if (!auto) return;
  auto = false;
  $("spause").hidden = true;
  show.style.setProperty("--p", 1);
}
$("spause").addEventListener("click", stopAuto);
show.querySelector(".stabs").addEventListener("click", (e) => { const t = e.target.closest("[data-slide]"); if (t) showSlide(+t.dataset.slide, true); });
show.querySelector(".stabs").addEventListener("keydown", (e) => {
  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!d) return;
  const k = (current + d + SLIDES.length) % SLIDES.length;
  showSlide(k, true); $("tab-" + SLIDES[k]).focus();
});
for (const ev of ["input", "change"]) show.addEventListener(ev, stopAuto);
show.addEventListener("click", (e) => { if (e.target.closest("#play, .wt, a")) stopAuto(); });
show.addEventListener("pointerenter", () => { hovering = true; });
show.addEventListener("pointerleave", () => { hovering = false; });
show.addEventListener("focusin", () => { hovering = true; });
show.addEventListener("focusout", () => { hovering = false; });
const showObserver = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }, { threshold: 0.15 });
showObserver.observe(show);
if (reduced) $("spause").hidden = true;

function tick(now) {
  const dt = now - last; last = now;
  if (auto && !hovering && onScreen && !document.hidden) {
    elapsed += dt;
    if (elapsed >= ROTATE_MS) showSlide((current + 1) % SLIDES.length);
  }
  if (auto) show.style.setProperty("--p", Math.min(1, elapsed / ROTATE_MS).toFixed(3));
  if (auto) requestAnimationFrame(tick);
}

/* contrast slide: one phantom slice, cycling T1-weighted, T2-weighted and FLAIR */
const N = 128, NC = 256; // k-space matrix; the contrast slide is drawn at 256 so it is not blocky
// The slice comes from the Colin27 head (real anatomy), cut out by tools/prepare-home-slice.mjs. Until it arrives, or if
// it cannot load, the generated phantom stands in, as on the simulator pages.
let phantom = null, colin = null;
const slices = {};
const slice = (n = N) => colin?.[n] ?? (slices[n] ??= sliceLabels(phantom ??= createPhantom({ seed: 1, lesions: true }), "axial", 24, n, 250, [0, 8]));
async function loadColin() {
  try {
    const res = await fetch("data/colin27/home-axial-slice.u8.gz");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const b = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    if (b.length !== NC * NC + N * N) throw new Error("unexpected size " + b.length);
    colin = { [NC]: b.subarray(0, NC * NC), [N]: b.subarray(NC * NC) };
    kData = null;
    $("show").dataset.anatomy = "colin27";
    if (SLIDES[current] === "contrast") setWeighting(wIdx);
    if (SLIDES[current] === "kspace") startKspace();
  } catch (err) {
    $("show").dataset.anatomy = "generated";
    $("anat").textContent = "Showing the generated head phantom (the real-anatomy slice could not load).";
  }
}
const NOTES = {
  t1: "T1-weighted: fat and white matter are bright and CSF is dark, because short-T1 tissues recover most in a short TR.",
  t2: "T2-weighted: CSF is bright, because its long T2 keeps most of its signal at TE 100 ms.",
  flair: "FLAIR: the inversion time nulls CSF, so the ventricles go dark while the added example lesions stay bright.",
};
function paint(canvas, img, max = 1) {
  const n = canvas.width, ctx = canvas.getContext("2d"), data = ctx.createImageData(n, n);
  for (let p = 0; p < n * n; p++) {
    const v = Math.max(0, Math.min(255, Math.round((img[p] / max) * 255)));
    data.data[4 * p] = data.data[4 * p + 1] = data.data[4 * p + 2] = v; data.data[4 * p + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
}
let wIdx = 0, wTimer = 0;
$("wts").innerHTML = WEIGHTINGS.map((w, j) => `<button class="wt" type="button" data-w="${j}" id="wt-${w.id}">${w.name}<small>${w.detail}</small></button>`).join("");
function setWeighting(j) {
  wIdx = j;
  const w = WEIGHTINGS[j];
  paint($("cimg"), imageFromLabels(slice(NC), labelLut(w, { scale: "brain" })));
  $("wnote").textContent = NOTES[w.id];
  document.querySelectorAll(".wt").forEach((b, k) => b.classList.toggle("on", k === j));
  $("show").dataset.weighting = w.id;
}
function startContrast() {
  clearInterval(wTimer);
  setWeighting(0);
  if (!reduced) wTimer = setInterval(() => { if (SLIDES[current] !== "contrast") return clearInterval(wTimer); setWeighting((wIdx + 1) % WEIGHTINGS.length); }, ROTATE_MS / 3);
}
$("wts").addEventListener("click", (e) => { const b = e.target.closest("[data-w]"); if (!b) return; clearInterval(wTimer); setWeighting(+b.dataset.w); });

/* k-space slide: fill the T2-weighted slice's k-space centre-out and rebuild the image from the lines so far */
let kTimer = 0, kData = null;
function startKspace() {
  clearInterval(kTimer);
  if (!kData) {
    const k = kspaceOf(imageFromLabels(slice(), labelLut(WEIGHTINGS[1], { scale: "brain" })), N);
    const mag = new Float64Array(N * N);
    let max = 0;
    for (let p = 0; p < N * N; p++) { mag[p] = Math.log1p(Math.hypot(k.re[p], k.im[p])); max = Math.max(max, mag[p]); }
    kData = { k, mag, max, rows: centerOutRows(N) };
  }
  let filled = reduced ? N : 0;
  const step = () => {
    const rows = kData.rows.slice(0, filled), shown = new Float64Array(N * N);
    for (const j of rows) for (let i = 0; i < N; i++) shown[j * N + i] = kData.mag[j * N + i];
    paint($("kk"), shown, kData.max);
    if (filled < N) { const ctx = $("kk").getContext("2d"); ctx.fillStyle = "#4D8DFF"; ctx.fillRect(0, kData.rows[filled], N, 1); }
    const img = filled ? reconFromRows(kData.k, N, rows) : new Float64Array(N * N);
    paint($("ki"), img, 1);
    $("klines").textContent = `${filled} of ${N} lines`;
    $("show").dataset.klines = filled;
  };
  step();
  if (reduced) return;
  // most of the image arrives in the first lines, so go slowly at the start and faster later
  kTimer = setInterval(() => {
    if (SLIDES[current] !== "kspace" || filled >= N) return clearInterval(kTimer);
    filled = Math.min(N, filled + (filled < 16 ? 1 : filled < 48 ? 2 : 4));
    step();
  }, 120);
}

showSlide(0);
// build the phantom slices while the browser is idle, so the first switch to Contrast or K-space does not stall
loadColin();
if (auto) requestAnimationFrame((t) => { last = t; tick(t); });
