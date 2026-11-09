# Bloch TR Repetitions and Hover Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Bloch simulator run 1–5 spoiled repetitions of each experiment at a chosen TR, and give every control
a hover/focus/tap explanation.

**Architecture:** A new DOM-free `bloch/program.js` builds the repeated event list (moving `buildEvents` out of
`bloch/ui.js`), using one new engine event `spoil` in `bloch/bloch.js`. The page reads TR and Repetitions and shows
"TR k of N". A shared `shared/hint.js` attaches "?" markers and popups from a text table in `bloch/hints.js`.

**Tech Stack:** Plain ES modules, Plotly 2.35.2 (already loaded), `node --test`, `tools/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-09-bloch-tr-and-hints-design.md` (its hover-text table is approved verbatim).

## Global Constraints

- TR control: 50–5000 ms, default 500. Repetitions: 1–5, default 2.
- Minimum TR: spin echo `2·τ + 2·pulse`; inversion recovery `TI + 2·pulse`; pulse `pulse`. When TR is below the
  minimum, the TR actually used is the minimum, rounded up to a whole ms, and a note says so.
- Spoiling happens between repetitions only (after TR k, before excitation k+1), never after the last one.
- Hover text: exactly the spec's table, verbatim (the owner approved it as written).
- With Repetitions = 1 and TR at its minimum or more, each experiment plays as today plus a recovery-to-TR segment.
  Existing `bloch/bloch.test.js` and `bloch/labframe.test.js` tests stay unchanged and passing.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `node --test --test-concurrency=1 "**/*.test.js"`; `node tools/smoke.mjs bloch`.

## Review Focus

- Raising τ/TI above what the current TR allows: the TR used rises, the note appears, and nothing throws. Lowering
  τ/TI again clears the note.
- Lab frame, B1 field, "so far" readout and Reset across repetitions, including the frames at a `spoil` event.
- Five repetitions at TR 5000 ms: playback still about 12 s, and the lab-frame traces still use every frame without
  becoming sluggish.
- Hint popups at phone width: no sideways page scroll, and they stay inside the viewport.
- The existing smoke steps (experiment cycling, B1 mode, lab frame, Reset, Show B1) still pass.

---

### Task 1: The engine's `spoil` event and the repeated program

**Files:**
- Modify: `bloch/bloch.js` (`runProgram`: new event type)
- Create: `bloch/program.js`, `bloch/program.test.js`
- Modify: `bloch/ui.js` (replace the local `buildEvents` with `buildProgram`; no visible behaviour change yet beyond
  the program itself)

**Interfaces:**
- Produces, in `bloch/bloch.js`: event `{ type: "spoil", label: "spoiled" }`. `runProgram` sets Mx = My = 0 for every
  isochromat, records exactly one frame at the unchanged time, and pushes its `eventEnds` entry. It takes no
  duration and runs no relaxation.
- Produces, in `bloch/program.js`:
  - `export function minTrMs(p): number`, where `p` is `{ program: "pulse"|"se"|"ir", delay, pdur }`.
  - `export function buildProgram(p): { events, trMs, raised: boolean }`, where `p` is `{ program, flip, phase,
    pdur, shape, delay, tr, reps }`. `trMs = max(p.tr, ceil(minTrMs(p)))` and `raised = trMs > p.tr`. The events
    are the experiment repeated `reps` times, with a spoil between repetitions. Every event carries `rep`
    (0-based). RF events carry `role: "excite" | "refocus" | "invert"` and keep the existing fields and labels
    (`` `${Math.round(flip)}° RF pulse` ``, `tbw: 4`, `dtMs: pdur / 80`). Delays keep `dtMs: max(0.1, durMs / 300)`.
  - Per repetition, with `pulse = pdur` and `rec` = the time left to TR (a delay omitted when `rec` ≤ 0):
    - `pulse`: excite(flip, phase), delay `TR − pulse` labelled "free precession".
    - `se`: excite(flip, phase), delay τ "free precession", refocus(180, phase + 90), delay τ "to the echo", delay
      `rec = TR − 2τ − 2·pulse` "recovery".
    - `ir`: invert(180, phase), delay TI "inversion recovery", excite(flip, phase), delay `rec = TR − TI − 2·pulse`
      "recovery".

- [ ] **Step 1: Write the failing tests**
  - In `bloch/bloch.test.js`, add `spoil zeroes the transverse magnetization and keeps Mz`: a 45° pulse then
    `{ type: "spoil" }`. The last frame has mx = my = 0 and mz equal to the frame before it; the spoil adds exactly
    one frame and the time is unchanged.
  - In `bloch/program.test.js`:
    - `minTrMs per experiment`: se, τ 20, pdur 0.5 → 41; ir, TI 300, pdur 0.5 → 301; pulse, pdur 0.5 → 0.5.
    - `buildProgram raises a too-short TR`: se, τ 20, pdur 0.5, tr 30 → trMs 41, raised true; tr 500 → 500, false.
    - `spin echo repeats with spoils between, not after`: reps 2 → the event types and roles in order are
      excite, delay, refocus, delay, delay, spoil, excite, delay, refocus, delay, delay; `rep` is 0 for the first
      five events and 1 after the spoil; the sum of durations in rep 0 equals trMs.
    - `one repetition has no spoil`: reps 1 → no spoil event.
    - `spoiled repeat of a 90° recovers to 1 − e^(−TR/T1)`: pulse, flip 90, pdur 0.1, tr 500, reps 2,
      `runProgram(events, { T1: 1000, T2: 50 })`. Mz at the spoil's frame (just before excitation 2) ≈ 0.393
      (tolerance 0.005).
    - `repetitions approach the spoiled steady state`: pulse, flip 60, pdur 0.1, tr 500, reps 5, T1 1000, T2 50.
      Mz just before the 5th excitation is within 0.01 of (1 − E1) / (1 − cos 60° · E1), where E1 = e^(−0.5).
- [ ] **Step 2: Run** `node --test bloch/bloch.test.js bloch/program.test.js`. Expected: FAIL (no spoil handling;
  program.js missing).
- [ ] **Step 3: Implement** the `spoil` branch in `runProgram`, and `bloch/program.js`. Switch `bloch/ui.js`'s
  `simulate()` to use `buildProgram({ ...p, tr: minTrMs(p), reps: 1 })` until Task 2 adds the controls. That gives
  one repetition with no recovery segment, so the page keeps working. Spin echo then ends at the echo (the old
  "after the echo" tail goes away; Task 2's recovery-to-TR segment replaces it).
- [ ] **Step 4: Run** `node --test --test-concurrency=1 "**/*.test.js"` and `node tools/smoke.mjs bloch`.
  Expected: all PASS.
- [ ] **Step 5: Commit** `bloch/bloch.js bloch/bloch.test.js bloch/program.js bloch/program.test.js bloch/ui.js`:
  "Bloch: spoil event and repeated experiment programs".

### Task 2: TR and Repetitions on the page

**Files:**
- Modify: `bloch/index.html`, `bloch/ui.js`, `tools/smoke.mjs`

**Interfaces:**
- Consumes: `buildProgram`, `minTrMs` (Task 1); RF events' `rep` and `role`.
- Produces: controls `#tr` (range 50–5000, step 10, value 500, label "TR", value shown in `#trV` as "500 ms") and
  `#reps` (select, options 1–5, default 2, label "Repetitions"), placed after "Delay / τ / TI"; `#trNote` (a `.note`,
  hidden unless raised) with text `` `TR raised to ${trMs} ms, the shortest this experiment allows.` ``.

- [ ] **Step 1: Smoke steps** (append to the `bloch` entry):

```js
["set", "program", "se"], ["set", "reps", 2], ["set", "tr", 500],
["expect", "TR and repetitions controls exist; no raise note at TR 500", `document.getElementById("trNote").hidden && document.getElementById("trV").textContent === "500 ms"`],
["set", "time", 1e6],
["expect", "readout shows the second TR at the end", `document.getElementById("readout").textContent.includes("TR 2 of 2")`],
["set", "tr", 50], ["set", "delay", 100],
["expect", "too-short TR is raised with a note", `!document.getElementById("trNote").hidden && document.getElementById("trNote").textContent.includes("201 ms")`],
["set", "program", "pulse"],
["expect", "Delay is disabled for the pulse experiment", `document.getElementById("delay").disabled`],
["set", "program", "se"], ["set", "tr", 500], ["set", "delay", 20],
```

  (The "201 ms" assumes the default pulse duration of 0.5 ms: 2·100 + 2·0.5 = 201. If the step leaves the pulse
  duration elsewhere, compute the expected value from `#pdurNum` instead.)
- [ ] **Step 2: Run** `node tools/smoke.mjs bloch`. Expected: FAIL (no `#trNote`).
- [ ] **Step 3: Implement:**
  - `readParams` reads `tr` and `reps` and fills `#trV`.
  - `simulate` uses `buildProgram(p)` and keeps `trMs` and `raised`.
  - `#trNote` is shown or hidden from `raised`, and the TR slider is not moved (the note says what was used).
  - `#delay` is disabled when the program is `pulse`.
  - Add `tr` and `reps` to the refresh listener list.
  - The readout appends `` ` · TR ${rep + 1} of ${reps}` `` from the current event's `rep`; at frame 0 it shows
    "TR 1 of N".
  - In `drawTraces`, the dashed T2 curve restarts at the end of each RF event with `role: "excite"` and runs to the
    start of the next excite (or the end). Nothing is drawn for the inversion recovery's first segment, so it keeps
    today's rule of no T2 curve before any excitation.
  - Update the page's note to mention that leftover transverse magnetization is spoiled between repetitions.
- [ ] **Step 4: Run** `node --test --test-concurrency=1 "**/*.test.js"` and `node tools/smoke.mjs bloch`.
  Expected: all PASS, with no phone-width sideways-scroll warning.
- [ ] **Step 5: Commit** `bloch/index.html bloch/ui.js tools/smoke.mjs`: "Bloch: TR and repetitions controls".

### Task 3: Hover explanations

**Files:**
- Create: `shared/hint.js`, `bloch/hints.js`
- Modify: `shared/style.css`, `bloch/index.html`, `bloch/ui.js`, `tools/smoke.mjs`, `README.md` (one line under
  `shared/`)

**Interfaces:**
- Produces: `shared/hint.js` `export function attachHints(texts: Record<string, string>, doc = document): void`. For
  each id, find `label[for=id]` (or, for controls without one, the element itself). Append a
  `<button type="button" class="hint-btn" aria-label="What is this?" aria-expanded="false">?</button>` after the
  label text. Clicking, focusing or hovering it opens one shared `<div class="hint-pop" role="tooltip">` positioned
  next to the button and kept inside the viewport; set `aria-describedby` while open. It closes on mouseleave, blur,
  Escape, or a click elsewhere. Only one popup is open at a time.
- `bloch/hints.js`: `export const HINTS`, keyed by control id: `program`, `pmode`, `flip`, `b1`, `pdur`, `shape`,
  `phase`, `delay`, `off`, `spread`, `t1`, `t2`, `tr`, `reps`, `frame`, `showB1`, `play` (the Play / Reset text,
  marker beside the Play button), `time`. Values are the spec table's text verbatim. Keep the italics as plain
  words; no HTML in the strings.

- [ ] **Step 1: Smoke steps:**

```js
["expect", "every control has a hint marker", `document.querySelectorAll(".hint-btn").length >= 18`],
["expect", "a hint opens on focus with the approved text", `(async () => {
  const b = document.querySelector('label[for="flip"] .hint-btn'); b.focus();
  await new Promise((r) => setTimeout(r, 100));
  const p = document.querySelector(".hint-pop");
  const r = p.getBoundingClientRect();
  return p.checkVisibility() && p.textContent.startsWith("How far the pulse tips the magnetization")
    && r.left >= 0 && r.right <= innerWidth; })()`],
["expect", "Escape closes the hint", `(async () => {
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  return !document.querySelector(".hint-pop").checkVisibility(); })()`],
```

- [ ] **Step 2: Run** `node tools/smoke.mjs bloch`. Expected: FAIL (no `.hint-btn`).
- [ ] **Step 3: Implement** `shared/hint.js`, the CSS (a small round "?" in the muted colour; a popup up to 300 px
  wide in the panel colour with a border; it inherits the text-size scale), `bloch/hints.js`, and the call
  `attachHints(HINTS)` in `bloch/ui.js`.
- [ ] **Step 4: Run** `node --test --test-concurrency=1 "**/*.test.js"` and the full `node tools/smoke.mjs`.
  Expected: all PASS; no phone-width warning on the bloch page.
- [ ] **Step 5: Commit** the six files: "Bloch: hover explanations for every control (shared hint component)".
