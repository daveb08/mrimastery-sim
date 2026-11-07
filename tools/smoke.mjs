// Page smoke test: loads every simulator page in headless Chrome, exercises its main controls, and fails on
// JavaScript errors, failed loads, plots that do not draw, or a check that does not hold. Saves desktop and phone
// screenshots and, when a baseline exists, reports how much of each screenshot changed.
//
//   node tools/smoke.mjs                 run every page
//   node tools/smoke.mjs tuning bloch    run only these pages
//   node tools/smoke.mjs --baseline      run, then save the screenshots as the new baseline
//
// Output: qc-out/<date-time>/ (screenshots, diffs, report.md), baseline in qc-out/baseline/. No npm packages:
// Node 22+ (built-in WebSocket) and an installed Chrome or Chromium (or CHROME_PATH).

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, extname, resolve, normalize, sep } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_ROOT = join(ROOT, "qc-out");
const BASELINE = join(OUT_ROOT, "baseline");
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const DIFF_THRESHOLD = 24; // per-channel difference (0-255) that counts a pixel as changed
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the text of red alert boxes that are actually showing ("" when none)
const VISIBLE_ALERTS = `[...document.querySelectorAll(".alert")].filter((e) => e.checkVisibility())
  .map((e) => e.innerText.trim()).filter(Boolean).join(" | ")`;

// ---- what each page is checked for -----------------------------------------------------------------------------
// Steps: ["set", id, value] sets an input or select; ["cycle", id] steps a select through every option;
// ["click", id]; ["wait", ms]; ["url", query] reloads the page with a query string; ["expect", label, js] fails if
// the expression is not truthy; ["open", js] goes to the address the expression gives (a link on the page) and runs the
// remaining steps there. Screenshots are taken of the page as first loaded, before any steps.
const PAGES = [
  { name: "landing", path: "", plots: false, steps: [
    ["expect", "every card links to a page that loads", `(async () => {
      const links = [...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => h.startsWith(location.origin));
      const bad = [];
      for (const h of links) { const r = await fetch(h); if (!r.ok) bad.push(h); }
      return bad.length ? "broken: " + bad.join(", ") : true;
    })()`],
  ] },
  { name: "contrast", path: "contrast/", steps: [
    ["cycle", "seq"], ["cycle", "field"], ["cycle", "preset"],
    ["click", "tabBtnKspace"], ["click", "kPlay"], ["wait", 1200], ["click", "kPlay"], ["click", "kReset"],
    ["click", "tabBtnImages"],
    ["click", "tabBtnGeometry"], ["click", "tabBtnSignal"], ["click", "tabBtnBars"], ["click", "tabBtnCurves"],
    ["click", "tabBtnContrast"],
    ["expect", "BrainWeb choice shown only when its data is present", `(async () => {
      const ok = (await fetch("../data/brainweb/subject04_labels_1mm.json")).ok;
      await new Promise((r) => setTimeout(r, 300));
      return document.getElementById("phantomSrc").hidden === !ok; })()`],
    ["expect", "BrainWeb draws with its credit and the explorer link (skipped without data)", `(async () => {
      const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
      s.value = "brainweb"; s.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 50 && document.body.dataset.phantom !== "brainweb"; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      const lit = ["cv_axial", "cv_coronal", "cv_sagittal"].every((id) => { const c = document.getElementById(id);
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4 * 53) if (d[i] > 20) return true; return false; });
      return document.body.dataset.phantom === "brainweb" && document.getElementById("bwStatus").textContent === ""
        && !document.getElementById("bwCredit").hidden && lit && document.getElementById("kExplorer").href.includes("phantom=brainweb")
        && document.getElementById("bwCite").checkVisibility() && document.getElementById("bwCite").textContent.includes("Aubert-Broche"); })()`],
    ["click", "tabBtnKspace"],
    ["expect", "credit and citations stay visible on the K-space tab with BrainWeb; back to Generated hides them (skipped without data)", `(async () => {
      const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
      const c = document.getElementById("bwCredit"), t = document.getElementById("bwCite");
      const onK = c.checkVisibility() && t.checkVisibility();
      s.value = "generated"; s.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 50 && document.body.dataset.phantom !== "generated"; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      return onK && document.body.dataset.phantom === "generated" && !c.checkVisibility() && !t.checkVisibility(); })()`],
    ["click", "tabBtnImages"],
    // multi-slice protocol: cross-talk changes the bars (32 tightly packed GRE slices); a short TR needs concatenations
    ["set", "seq", "GRE"], ["click", "tabBtnGeometry"], ["click", "tabBtnBars"], ["set", "c_gapPct", 0], ["set", "c_slices", 32],
    ["expect", "slices 32: gap, order, concatenations and cross-talk shown", `["c_gapPct", "c_sliceOrder", "c_concatenations", "c_crossTalkOn"].every((i) => document.getElementById(i).checkVisibility())`],
    ["expect", "remember the bar values", `(window.__bars = document.getElementById("plotSignal").innerText, true)`],
    ["click", "c_crossTalkOn"],
    ["expect", "cross-talk off changes the bar values", `document.getElementById("plotSignal").innerText !== window.__bars`],
    ["click", "c_crossTalkOn"],
    ["set", "c_TR", 500], ["set", "c_TE", 100],
    ["expect", "32 slices at TR 500, TE 100 (the slider's minimum TR is 500): the meter reports concatenations", `document.getElementById("meters").innerText.includes("concatenations")`],
    ["expect", "TR strip: SVG with a '+ k more passes' note and a caption", `document.querySelectorAll("#trstripSvg rect").length > 4 && document.getElementById("trstripSvg").textContent.includes("more pass") && document.getElementById("trCaption").innerText.includes("concatenations")`],
    ["expect", "slice stack: lines drawn on coronal and sagittal, not axial", `document.querySelectorAll("#frame_coronal .sl").length > 0 && document.querySelectorAll("#frame_sagittal .sl").length > 0 && document.querySelectorAll("#frame_axial .sl").length === 0`],
    ["click", "showStack"],
    ["expect", "slice stack off: no lines", `document.querySelectorAll(".frame .sl").length === 0`],
    ["click", "showStack"],
    ["set", "c_slices", 1],
    ["expect", "slices 1: strip and stack checkbox hidden", `document.getElementById("trstrip").hidden && document.getElementById("stackWrap").hidden`],
    ["expect", "slices 1: gap and cross-talk hidden", `!document.getElementById("c_gapPct").checkVisibility() && !document.getElementById("c_crossTalkOn").checkVisibility()`],
    ["set", "seq", "FLAIR"],
    ["expect", "FLAIR: slices input disabled, note visible", `document.getElementById("c_slices").disabled && document.getElementById("sliceNote").innerText.includes("coming next")`],
    ["set", "seq", "MPRAGE"],
    ["expect", "MPRAGE: no slice controls", `!document.getElementById("c_slices")`],
    // the link to the explorer carries the stack and the resolved concatenations; the explorer opens on the middle slice
    ["set", "seq", "GRE"], ["click", "tabBtnGeometry"], ["set", "c_slices", 32], ["set", "c_TR", 500], ["set", "c_TE", 100], ["click", "tabBtnKspace"],
    ["expect", "the explorer link carries 32 slices and the concatenations", `(() => { const q = new URL(document.getElementById("kExplorer").href).searchParams;
      return (q.get("slices") === "32" && Number(q.get("conc")) > 1 && q.get("sel") === "15") || document.getElementById("kExplorer").href; })()`],
    ["open", `document.getElementById("kExplorer").href`],
    ["expect", "explorer from the link: 'Pass k of C' with the linked C, and the strip dims the other passes", `(() => {
      const C = new URLSearchParams(location.search).get("conc"), t = document.getElementById("passNote").innerText;
      return (document.getElementById("passNote").checkVisibility() && t.startsWith("Pass ") && t.includes(" of " + C + " (")
        && document.querySelectorAll("#strip figure").length === 32 && document.querySelectorAll("#strip figure.other").length > 0) || t; })()`],
  ] },
  { name: "kspace", path: "kspace/", steps: [
    ["click", "play"], ["wait", 1500], ["click", "play"], ["click", "nextTr"], ["click", "fillAll"], ["click", "reset"],
    ["url", "?seq=GRE"], ["click", "fillAll"],
    ["url", "?seq=EPI"], ["click", "fillAll"],
    ["url", "?seq=FSE&inv=IR"], ["click", "fillAll"],
    ["url", "?seq=FSE&inv=DIR&tr=8000"], ["click", "fillAll"],
    ["url", "?seq=SE&slices=5&gap=0&order=sequential&sel=1"], ["click", "fillAll"],
    ["expect", "multi-slice info shows cross-talk", `document.getElementById("info").innerText.includes("Cross-talk signal change")`],
    ["url", "?seq=GRE&slices=3"], ["click", "fillAll"],
    ["url", "?seq=EPI&slices=4&order=sequential"], ["click", "fillAll"],
    ["url", "?seq=SE&slices=5&order=interleaved"], ["click", "fillAll"],
    ["expect", "strip shows five slices", `document.querySelectorAll('#strip canvas').length === 5`],
    ["url", "?slices=6&conc=2"], ["click", "fillAll"],
    ["expect", "concatenations 2: 'Pass 1 of 2' (the middle slice, S3, is in pass 1) and a dimmed strip", `document.getElementById("passNote").innerText.startsWith("Pass 1 of 2")
      && document.querySelectorAll("#strip figure.other").length === 3 && document.getElementById("k_conc").value === "2"`],
    ["expect", "concatenations 2: info gives the scan time with 2 concatenations and max slices per TR", `(() => { const t = document.getElementById("info").innerText;
      return (t.includes("2 concatenations") && t.includes("slices per TR")) || t; })()`],
    ["expect", "selecting a slice in the other pass plays that pass", `(() => { document.querySelector('#strip figure[data-j="1"]').click();
      return (document.getElementById("passNote").innerText.startsWith("Pass 2 of 2") && document.querySelector("#strip figure.sel")?.dataset.j === "1") || document.getElementById("passNote").innerText; })()`],
    ["expect", "profile plot drawn", `!!document.querySelector('#profilePlot .main-svg')`],
    ["expect", "BrainWeb choice shown only when its data is present", `(async () => {
      const ok = (await fetch("../data/brainweb/subject04_labels_1mm.json")).ok;
      await new Promise((r) => setTimeout(r, 300));
      return document.getElementById("phantomSrc").hidden === !ok; })()`],
    ["expect", "BrainWeb redraws the image with its credit (skipped without data)", `(async () => {
      const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
      const lit = () => { const c = document.getElementById("rCanvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i]; return n; };
      document.getElementById("fillAll").click(); const before = lit();
      s.value = "brainweb"; s.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 80 && document.body.dataset.phantom !== "brainweb"; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      return document.body.dataset.phantom === "brainweb" && document.getElementById("bwStatus").textContent === ""
        && !document.getElementById("bwCredit").hidden && (() => { document.getElementById("fillAll").click(); const after = lit(); return after > 0 && after !== before; })()
        && location.search.includes("phantom=brainweb")
        && document.getElementById("bwCite").checkVisibility() && document.getElementById("bwCite").textContent.includes("Kwan"); })()`],
    ["expect", "back to Generated hides the credit and citations (skipped without data)", `(async () => {
      const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
      s.value = "generated"; s.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 50 && document.body.dataset.phantom !== "generated"; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      return document.body.dataset.phantom === "generated" && !document.getElementById("bwCredit").checkVisibility() && !document.getElementById("bwCite").checkVisibility(); })()`],
    ["url", "?seq=SE&slices=3&phantom=brainweb"], ["click", "fillAll"],
    ["expect", "?phantom=brainweb: BrainWeb with data; silently Generated, select hidden and no error without it", `(async () => {
      const ok = (await fetch("../data/brainweb/subject04_labels_1mm.json")).ok;
      for (let i = 0; i < 80 && ok && document.body.dataset.phantom !== "brainweb"; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      const s = document.getElementById("phantomSrc");
      const thumbs = document.querySelectorAll("#strip canvas").length === 3;
      if (ok) return document.body.dataset.phantom === "brainweb" && s.value === "brainweb" && !document.getElementById("bwCredit").hidden && thumbs;
      return s.hidden && s.value === "generated" && document.body.dataset.phantom !== "brainweb" && document.getElementById("bwCredit").hidden
        && document.getElementById("bwStatus").hidden && !location.search.includes("phantom") && thumbs; })()`],
    ["expect", "no sequence error shown", `(${VISIBLE_ALERTS}) || true`],
    // dragging Slices across 1 shows the gap and order and hides the inversion, without a rebuild of the slider
    ["url", "?seq=SE"], ["set", "k_slices", 5],
    ["expect", "slices 5: gap and order shown", `!!document.getElementById("k_gapPct")?.checkVisibility() && !!document.getElementById("k_sliceOrder")?.checkVisibility()`],
    ["expect", "slices 5: inversion hidden", `!document.getElementById("k_inversion")?.checkVisibility()`],
    ["set", "k_slices", 1],
    ["expect", "slices 1: inversion shown, gap hidden", `!!document.getElementById("k_inversion")?.checkVisibility() && !document.getElementById("k_gapPct")?.checkVisibility()`],
    // a tall stack reaching into the air: thumbnails share a window from the brightest slice, air is black
    ["url", "?seq=FSE&slices=32&slice=10&gap=100"], ["wait", 3000],
    ["expect", "tall stack: a thumbnail has a black corner", `[...document.querySelectorAll("#strip canvas")].some((c) => {
      const d = c.getContext("2d").getImageData(0, 0, 1, 1).data; return d[0] === 0 && d[1] === 0 && d[2] === 0; })`],
    ["expect", "tall stack: no NaN in the diagram", `!document.getElementById("diagram").innerHTML.includes("NaN")`],
    ["expect", "tall stack: four legend entries (selected, other slices, refocusing, Mz)", `document.querySelectorAll("#profilePlot .legend .traces").length === 4`],
    ["url", "?seq=FSE&slices=32&slice=10&gap=100&sel=0"], ["click", "fillAll"],
    ["expect", "selected slice in air: no NaN in the diagram", `!document.getElementById("diagram").innerHTML.includes("NaN")`],
    ["expect", "selected slice in air: image is black", `(() => { const d = document.getElementById("rCanvas").getContext("2d").getImageData(0, 0, 1, 1).data; return d[0] === 0 && d[1] === 0 && d[2] === 0; })()`],
    // the slice-select slider at the largest stack stays fast (finding: a rebuild took about a second at 32 slices)
    ["url", "?seq=GRE&slices=32&matrix=128"],
    ["expect", "32 slices, matrix 128: a slider change redraws in under 500 ms", `(() => {
      const e = document.getElementById("k_TE"), t0 = performance.now(); e.value = "6"; e.dispatchEvent(new Event("input", { bubbles: true }));
      const ms = performance.now() - t0; return ms < 500 || "took " + ms.toFixed(0) + " ms"; })()`],
  ] },
  { name: "bloch", path: "bloch/", steps: [
    ["cycle", "program"], ["set", "flip", 180], ["click", "play"], ["wait", 1500], ["click", "play"],
    ["set", "pmode", "b1"], ["set", "b1", 11.7], ["set", "pdur", 1],
    ["expect", "B1 mode: fixed B1, doubled duration gives about 180 degrees", `Math.abs(parseFloat(document.getElementById("flipV").textContent) - 180) <= 1`],
    ["set", "b1Num", 11.74], ["set", "pdurNum", 0.37], ["set", "pdurNum", 0.5],
    ["expect", "typed B1 and duration are used exactly", `document.getElementById("flipEq").textContent.includes("11.74 µT × 0.50 ms") && document.getElementById("flipV").textContent === "90°"`],
    ["set", "pmode", "flip"],
    ["set", "frame", "lab"], ["click", "play"], ["wait", 1500], ["click", "play"],
    ["expect", "lab frame shows its label", `!document.getElementById("labNote").hidden`],
    ["set", "program", "ir"],
    ["expect", "lab frame survives a change of experiment", `document.getElementById("frame").value === "lab" && !document.getElementById("labNote").hidden`],
    ["set", "frame", "rot"],
    ["expect", "rotating frame hides the lab label", `document.getElementById("labNote").hidden`],
    ["click", "play"], ["wait", 800], ["click", "reset"],
    ["expect", "Reset pauses and returns to equilibrium", `+document.getElementById("time").value === 0 && document.getElementById("play").textContent === "Play" && document.getElementById("readout").textContent.includes("start")`],
    ["set", "time", 40],
    ["expect", "mid-pulse readout shows the flip so far", `/\\d+° of 180° so far/.test(document.getElementById("readout").textContent)`],
    ["expect", "B1 field is drawn mid-pulse", `document.getElementById("scene").data.some((t) => t.name === "B1" && t.visible !== false)`],
    ["click", "showB1"],
    ["expect", "Show B1 off hides the field", `document.getElementById("scene").data.filter((t) => t.name === "B1").every((t) => t.visible === false)`],
    ["click", "showB1"],
  ] },
  { name: "coil", path: "coil/", steps: [
    ["cycle", "geometry"], ["set", "radius", 8],
    ["click", "tabBtnRf"], ["cycle", "b0axis"], ["click", "flip_standard"], ["click", "b1_full"], ["click", "tabBtnCoil"],
  ] },
  { name: "signal", path: "signal/", steps: [["cycle", "field"], ["cycle", "kind"], ["set", "tbw", 8]] },
  { name: "phantom", path: "phantom/", steps: [
    ["cycle", "mode"], ["cycle", "window"], ["set", "zpos", 20], ["click", "lesions"], ["cycle", "res"],
    ["expect", "BrainWeb choice shown only when its data is present", `(async () => {
      const ok = (await fetch("../data/brainweb/subject04_labels_1mm.json")).ok;
      await new Promise((r) => setTimeout(r, 300));
      return document.getElementById("phantomSrc").hidden === !ok; })()`],
    ["expect", "BrainWeb draws with its credit (skipped without data)", `(async () => {
      const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
      s.value = "brainweb"; s.dispatchEvent(new Event("input", { bubbles: true }));
      for (let i = 0; i < 50 && document.body.dataset.phantom !== "brainweb"; i++) await new Promise((r) => setTimeout(r, 100));
      return document.body.dataset.phantom === "brainweb" && document.getElementById("bwStatus").textContent === ""
        && !document.getElementById("bwStatus").offsetParent
        && !document.getElementById("bwCredit").hidden && document.getElementById("seed").disabled
        && document.getElementById("bwCite").checkVisibility() && document.getElementById("bwCite").textContent.includes("Collins")
        && !document.querySelector("h1").innerText.includes("Procedural") && !document.body.innerText.includes("not a segmentation of a real person")
        && !document.body.innerText.includes("no stored data"); })()`],
    ["expect", "back to Generated restores the procedural wording and hides the citations (skipped without data)", `(async () => {
      const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
      s.value = "generated"; s.dispatchEvent(new Event("input", { bubbles: true }));
      for (let i = 0; i < 50 && document.body.dataset.phantom !== "generated"; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      return document.body.dataset.phantom === "generated" && !document.getElementById("bwCite").checkVisibility()
        && document.querySelector("h1").innerText === "Procedural head phantom" && document.body.innerText.includes("not a segmentation of a real person"); })()`],
    ["set", "xpos", 5], ["set", "ypos", 0], ["set", "zpos", 14],
    ["expect", "linked slice lines mark the other two slices on each view", `(async () => {
      await new Promise((r) => setTimeout(r, 200));
      const pct = (el, prop) => parseFloat(el.style[prop]);
      const ax = document.getElementById("frame_axial"), sag = document.getElementById("frame_sagittal");
      // axial: x = 5 -> (5 + 125) / 250 = 52 % from the left; y = 0 -> (8 + 125 - 0) / 250 = 53.2 % from the top
      // sagittal: y = 0 -> screen-right 0 -> (0 + 8 + 125) / 250 = 53.2 %; z = 14 -> (-25 + 125 - 14) / 250 = 34.4 %
      return Math.abs(pct(ax.querySelector(".xh.v"), "left") - 52) < 0.5 && Math.abs(pct(ax.querySelector(".xh.h"), "top") - 53.2) < 0.5
        && Math.abs(pct(sag.querySelector(".xh.v"), "left") - 53.2) < 0.5 && Math.abs(pct(sag.querySelector(".xh.h"), "top") - 34.4) < 0.5; })()`],
    ["expect", "clicking an image moves the other two slices to that point", `(async () => {
      const f = document.getElementById("frame_axial"), r = f.getBoundingClientRect();
      // the centre of the axial view is screen (0, 8) mm: patient x = 0, y = 8
      f.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      f.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
      await new Promise((r) => setTimeout(r, 200));
      return +document.getElementById("xpos").value === 0 && +document.getElementById("ypos").value === 8
        && +document.getElementById("zpos").value === 14 && document.getElementById("xposV").textContent === "0"; })()`],
  ] },
  { name: "tuning", path: "tuning/", steps: [
    ["click", "auto"], ["expect", "Tune & match gives a matched coil", `!!document.querySelector("#status .ok")`],
    ["set", "loading", 0.5], ["expect", "patient loading detunes the coil", `!document.querySelector("#status .ok")`],
    ["click", "auto"], ["expect", "the loaded coil can be re-matched", `!!document.querySelector("#status .ok")`],
  ] },
];

// ---- a static file server for the repo ---------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/plain" };
function serve() {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT + sep) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// ---- Chrome over the DevTools protocol ---------------------------------------------------------------------------
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const fixed = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const f of fixed) if (existsSync(f)) return f;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch { /* not this one */ }
  }
  throw new Error("Chrome not found; set CHROME_PATH");
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "smoke-chrome-"));
  const args = ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"];
  if (process.env.CI) args.push("--no-sandbox");
  const proc = spawn(findChrome(), args, { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 80 && !existsSync(portFile); i++) await sleep(250);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pending = new Map(), listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method) for (const l of listeners) l(m);
  };
  const send = (method, params = {}, timeout = 30000) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); rej(new Error(`${method} timed out`)); }, timeout);
    pending.set(i, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const close = () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, on: (f) => listeners.push(f), close };
}

// ---- running one page --------------------------------------------------------------------------------------------
async function runPage(cdp, base, page, outDir) {
  const problems = [], warnings = [];
  const record = (m) => {
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      problems.push(`JS error: ${(d.exception?.description ?? d.text).split("\n")[0]}`);
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      problems.push(`console error: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    } else if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && !m.params.response.url.endsWith("favicon.ico")
      // The BrainWeb file is git-ignored until permission to redistribute it is granted, so pages probe for it and a 404 is expected.
      && !(m.params.response.status === 404 && m.params.response.url.includes("/data/brainweb/"))) {
      problems.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
    } else if (m.method === "Network.loadingFailed" && !m.params.canceled) {
      problems.push(`failed to load (${m.params.errorText}): ${m.params.requestId}`);
    }
  };
  let active = true;
  cdp.on((m) => active && record(m));

  const evaluate = async (expr) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const load = async (query = "", url = `${base}/${page.path}${query}`) => {
    await cdp.send("Page.navigate", { url });
    // wait for the load event, then until the number of drawn plots stops changing
    for (let i = 0; i < 60 && (await evaluate("document.readyState")) !== "complete"; i++) await sleep(150);
    let last = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const n = await evaluate(COUNT_PLOTS);
      if (n === last && n > 0) break;
      last = n;
    }
    await sleep(300);
  };
  const shoot = async (metrics, file) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", metrics);
    await load();
    const { cssContentSize: s } = await cdp.send("Page.getLayoutMetrics");
    const height = Math.min(Math.ceil(s.height), 6000);
    const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: metrics.width, height, scale: 1 } });
    writeFileSync(file, Buffer.from(r.data, "base64"));
  };

  // phone first, so the page is left at desktop size for the steps
  await shoot(PHONE, join(outDir, "phone", `${page.name}.png`));
  if (await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")) {
    warnings.push("scrolls sideways at phone width");
  }
  await shoot(DESKTOP, join(outDir, "desktop", `${page.name}.png`));
  const plots = await evaluate(COUNT_PLOTS);
  if (page.plots !== false && plots === 0) problems.push("no plots or images drew");
  const alert = await evaluate(VISIBLE_ALERTS);
  if (alert) problems.push(`alert on load: ${alert.slice(0, 200)}`);

  for (const [kind, a, b] of page.steps) {
    try {
      if (kind === "wait") await sleep(a);
      else if (kind === "url") await load(a);
      else if (kind === "open") await load("", await evaluate(a));
      else if (kind === "click") await evaluate(`(() => { const e = document.getElementById(${JSON.stringify(a)});
        if (!e) throw new Error("no element #${a}"); e.click(); })()`);
      else if (kind === "set") await evaluate(`(() => { const e = document.getElementById(${JSON.stringify(a)});
        if (!e) throw new Error("no element #${a}"); e.value = ${JSON.stringify(String(b))};
        e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      else if (kind === "cycle") await evaluate(`(async () => { const e = document.getElementById(${JSON.stringify(a)});
        if (!e) throw new Error("no element #${a}"); const start = e.value;
        for (const v of [...[...e.options].map((o) => o.value), start]) {
          e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 500));
        } })()`);
      else if (kind === "expect") {
        const v = await evaluate(b);
        if (v !== true) problems.push(`check failed: ${a}${typeof v === "string" ? ` (${v})` : ""}`);
      }
      if (kind !== "wait" && kind !== "expect") await sleep(250);
    } catch (err) {
      problems.push(`step ${kind} ${a ?? ""}: ${err.message.split("\n")[0]}`);
    }
  }
  await sleep(400); // let late errors arrive
  active = false;
  return { name: page.name, plots, problems: [...new Set(problems)], warnings };
}

// Plotly plots that have drawn, plus 2D canvases (the phantom) that are not blank.
const COUNT_PLOTS = `(() => {
  const plotly = document.querySelectorAll(".js-plotly-plot .main-svg").length ? document.querySelectorAll(".js-plotly-plot").length : 0;
  let canvases = 0;
  for (const c of document.querySelectorAll("canvas")) {
    if (c.closest(".js-plotly-plot") || !c.width || !c.height) continue;
    const ctx = c.getContext("2d"); if (!ctx) continue;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] || d[i + 1] || d[i + 2]) { canvases++; break; }
  }
  return plotly + canvases;
})()`;

// ---- comparing against the baseline (done inside Chrome, so no image library is needed) ---------------------------
async function compare(cdp, current, baseline, diffFile) {
  const url = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
  const r = await cdp.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const load = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const [a, b] = await Promise.all([load(${JSON.stringify(url(baseline))}), load(${JSON.stringify(url(current))})]);
    const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
    const px = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
    const A = px(a), B = px(b), out = new ImageData(w, h);
    let changed = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      const g = (B.data[i] + B.data[i + 1] + B.data[i + 2]) / 12; // the current page, dimmed
      if (d > ${DIFF_THRESHOLD}) { changed++; out.data.set([255, 40, 40, 255], i); } else out.data.set([g, g, g, 255], i);
    }
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").putImageData(out, 0, 0);
    return { pct: (100 * changed) / (w * h), resized: a.width !== b.width || a.height !== b.height, png: changed ? c.toDataURL() : null };
  })()` }, 120000);
  const v = r.result.value;
  if (v.png) writeFileSync(diffFile, Buffer.from(v.png.split(",")[1], "base64"));
  return v;
}

// ---- main --------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const saveBaseline = args.includes("--baseline");
const only = args.filter((a) => !a.startsWith("--"));
const pages = only.length ? PAGES.filter((p) => only.includes(p.name)) : PAGES;
if (only.length && pages.length !== only.length) {
  console.error(`unknown page; choose from: ${PAGES.map((p) => p.name).join(", ")}`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const outDir = join(OUT_ROOT, stamp);
for (const d of ["desktop", "phone", "diff"]) mkdirSync(join(outDir, d), { recursive: true });

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const cdp = await launch();
await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

const results = [];
try {
  for (const page of pages) {
    process.stdout.write(`${page.name.padEnd(9)} `);
    let r;
    try { r = await runPage(cdp, base, page, outDir); }
    catch (err) { r = { name: page.name, plots: 0, problems: [`page run failed: ${err.message}`], warnings: [] }; }
    r.diffs = {};
    if (existsSync(BASELINE) && !saveBaseline) {
      for (const view of ["desktop", "phone"]) {
        const b = join(BASELINE, view, `${page.name}.png`), c = join(outDir, view, `${page.name}.png`);
        if (existsSync(b) && existsSync(c)) r.diffs[view] = await compare(cdp, c, b, join(outDir, "diff", `${view}-${page.name}.png`));
      }
    }
    const diff = Object.entries(r.diffs).map(([v, d]) => `${v} ${d.pct.toFixed(1)}%${d.resized ? " (size changed)" : ""}`).join(", ");
    console.log(`${r.problems.length ? "FAIL" : "pass"}  plots ${String(r.plots).padStart(2)}${diff ? `  changed vs baseline: ${diff}` : ""}`);
    for (const p of r.problems) console.log(`          - ${p}`);
    for (const w of r.warnings) console.log(`          ~ ${w}`);
    results.push(r);
  }
} finally {
  cdp.close();
  server.close();
}

const failed = results.filter((r) => r.problems.length);
const lines = [`# Smoke test ${stamp}`, "", `${results.length - failed.length} of ${results.length} pages passed.`, "",
  "| Page | Result | Plots | Changed vs baseline | Notes |", "|---|---|---|---|---|",
  ...results.map((r) => `| ${r.name} | ${r.problems.length ? "FAIL" : "pass"} | ${r.plots} | ${
    Object.entries(r.diffs).map(([v, d]) => `${v} ${d.pct.toFixed(1)}%`).join(", ") || "—"} | ${
    [...r.problems, ...r.warnings.map((w) => `(warning) ${w}`)].join("; ").replace(/\|/g, "/") || ""} |`)];
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
writeFileSync(join(outDir, "report.json"), JSON.stringify(results, null, 2));

if (saveBaseline) {
  rmSync(BASELINE, { recursive: true, force: true });
  for (const v of ["desktop", "phone"]) cpSync(join(outDir, v), join(BASELINE, v), { recursive: true });
  writeFileSync(join(BASELINE, "from.txt"), `${stamp}\n`);
  console.log(`baseline saved from this run`);
}
console.log(`\n${results.length - failed.length}/${results.length} pages passed. Report and screenshots: ${outDir}`);
process.exit(failed.length ? 1 : 0);
