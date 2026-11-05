# Multi-slice Protocol Page (project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the contrast simulator into the technologist's multi-slice protocol page. It gets slices, gap, order,
concatenations, scan time, max slices per TR, cross-talk in the SNR bars, a TR strip and planning lines. The explorer
gains concatenations, and the site's slice-selective pulses become a Hann-windowed sinc.

**Architecture:** The pulse shape and the slice packing live once, in `shared/sequence.js`: `RF_SHAPE`,
`sliceTiming` and multi-slice builds of one concatenation ("pass"). A new DOM-free module, `contrast/protocol.js`,
maps the contrast simulator's own settings onto those builders and returns timing and middle-slice cross-talk factors.
`computeModel` takes the scan factor and the factors as optional extras, so its N = 1 output is untouched. The
explorer builds the pass that holds the selected slice.

**Tech Stack:** Plain ES modules, no build step; `node:test`; Plotly 2.35.2; headless-Chrome smoke test
`tools/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-05-multislice-protocol-design.md` (project 1 only). Read it with this plan.
The earlier multi-slice design, `docs/superpowers/specs/2026-11-04-multislice-design.md`, explains the existing
engine.

## Global Constraints

- Project 1 only: FLAIR, STIR and DIR stay single-slice. `sliceTiming` throws for any sequence with an inversion.
- **Contrast simulator at N = 1 is unchanged:** every golden test (`contrast/physics.test.js` against
  `contrast/golden.json`) passes untouched.
- Hann-windowed sinc: `envelope("hannSinc")` = TBW-4 sinc × `0.5 · (1 + cos(2π u))`, u ∈ [−0.5, 0.5].
  `RF_SHAPE = "hannSinc"`, and every RF event the builders emit carries `shape: RF_SHAPE`. Do not change
  `bloch/ui.js` or `signal/rfslice.js` behaviour.
- Slices 1–32 on both pages; gap 0–100 % in 10 % steps (default 20); order interleaved (default) or sequential;
  concatenations Auto (default) or 1–4.
- Auto concatenations = ⌈N / maxSlices⌉ with no upper cap; maxSlices = ⌊requested TR / slotMs⌋, at least 1.
- Concatenation k (0-based) holds slices k, k + C, k + 2C, … in spatial order; the chosen order applies within a pass.
- Scan time = TR × shots × NEX × concatenations × pfFraction (contrast page); TR × TRs × concatenations (explorer).
- When manual concatenations are too few: the contrast page always raises the concatenations, never TR. In the
  explorer, manual 1 raises TR (today's behaviour) and manual 2–4 raises the concatenations; both say so in a message.
- bSSFP is acquired slice by slice: scan factor N, no cross-talk. DWI uses the EPI timing. MPRAGE hides the slice
  controls.
- The contrast page's timing uses its own freqMatrix, phaseMatrix, FOVs, BW, TE, TR, ETL and FA. Builder clamping
  (for example a minimum TE) is silent on the contrast page.
- Cross-talk on the contrast page uses the middle slice's factors (spatial index ⌊(N − 1)/2⌋), from the pass that holds
  it, with T1s from `tissuesAt(field)`. It is applied to the physics signals before the voxel-volume scale and to the
  image label table. A toggle, "Include cross-talk (Bloch-simulated slice profiles)", defaults to on.
- No fudge factors or clamping of cross-talk numbers. Speed: crossTalk < 50 ms. A contrast-page slider tick must stay
  comparable to today's (cache the timing and the factors).
- Run `node --test "**/*.test.js"` (quotes included) and `node tools/smoke.mjs` from the worktree root.

## Review Focus

1. **Switching the sequence on the contrast page from GRE with 20 slices to FLAIR:** the slices control shows 1
   (disabled), scan time and SNR become single-slice, and switching back restores 20. → Task 4 test
   `inversion sequences run single-slice`.
2. **MPRAGE with a stored slice count:** the slice controls are hidden and ignored, so scan time is unchanged.
   → Task 4 test `MPRAGE ignores slices`.
3. **TR set below one slice's block** (GRE TR 10 with 32 slices): maxSlices is 1 and C = 32, with no NaN or Infinity.
   → Task 2 test `TR shorter than one block`.
4. **bSSFP with 10 slices:** scan time is ×10, there is no cross-talk, and the mode is `"sequential"`. → Task 4 test
   `bSSFP is slice by slice`.
5. **Non-square or extreme contrast matrices** (320 × 192; EPI with a 512 phase matrix): timing stays finite even
   when a builder reports a gradient error. → Task 4 test `odd matrices stay finite`.

---

### Task 1: Hann-windowed sinc everywhere the builders' pulses are simulated or drawn

**Files:**
- Modify: `bloch/bloch.js` (`envelope`), `shared/sequence.js` (`RF_SHAPE`, `shape` on every RF event),
  `shared/crosstalk.js` (shape from the event), `shared/seqdiagram.js` (RF polyline from `envelope`), the explorer's
  profile caption (`kspace/index.html` or `kspace/ui.js`, wherever it lives), `docs/kspace-module-plan.md` (phase 6
  wording)
- Test: `bloch/bloch.test.js`, `shared/sequence.test.js`, `shared/crosstalk.test.js`, `shared/seqdiagram.test.js`

**Interfaces:**
- Produces: `envelope("hannSinc", count, tbw)`; `RF_SHAPE` exported from `shared/sequence.js`; RF events
  `{ ..., shape: "hannSinc" }`; `pulseProfile({ ..., shape })` called with `e.shape ?? "sinc"`.

- [ ] **Step 1: Write the failing tests.**
  - `bloch.test.js`: `hannSinc` is symmetric, peaks at 1 in the centre, is below 0.01 in the first and last samples,
    and `shapeFraction("hannSinc") < shapeFraction("sinc")`.
  - `sequence.test.js`: every RF event of SE, GRE, FSE and EPI (with 1 and with 3 slices, and FSE with an inversion)
    has `shape === RF_SHAPE`.
  - `seqdiagram.test.js`: the RF polyline of a 90° excitation has its end points at the baseline (the window takes
    the envelope to 0 at the pulse edges).
- [ ] **Step 2: Run** `node --test bloch/bloch.test.js shared/sequence.test.js shared/seqdiagram.test.js`. Expected:
  the new tests FAIL.
- [ ] **Step 3: Implement.** In `crosstalk.js`, `profile(e)` passes `shape: e.shape ?? "sinc"`, and the brute-force
  reference in `crosstalk.test.js` uses the same shape. In `seqdiagram.js`, sample
  `envelope(rf.shape ?? "sinc", n + 1, 4)`, normalised to its peak.
- [ ] **Step 4: Measure the FWHM.** Measure the 10° windowed excite FWHM at 5 mm. If it is more than 3 % from 5 mm, add
  `RF_BW_FACTOR` in `sequence.js` (used in `sliceSelect`: `gss = RF_TBW · RF_BW_FACTOR / duration / (γ̄ · thickness)`),
  with the measured value and a comment, so the FWHM is within 3 %. Otherwise add no factor and record the measured
  FWHM in the report.
- [ ] **Step 5: Re-baseline `crosstalk.test.js`.** Run it and fix only what the window legitimately changes, with the
  reason in each test comment:
  - the flat-phase bounds;
  - the FWHM check within 3 % of nominal;
  - the `signal/rfslice.js` cross-check (keep comparing with `simulateRfSlice("Sinc", …)` but with a stated, measured
    tolerance, since rfslice has no window);
  - the "factors above 1" and "never exceed 1" tests: restate their exact conditions from the new measurements.
  The brute-force agreement must stay within 1 %.
- [ ] **Step 6: Before/after table.** Measure the signed cross-talk change, (factor − 1) × 100, middle slice, for
  sinc vs hannSinc: GRE 90° TR 300, GRE 60° TR 100, GRE 30° TR 70, EPI TR 3000, SE TR 500; N = 8, 5 mm, gaps 0 %
  and 20 %, WM and CSF. Put the table in the report, with a sentence on any gain above 10 % that remains. Tune nothing.
- [ ] **Step 7: Update the wording** of the explorer's profile caption and `docs/kspace-module-plan.md` phase 6 so they
  match the new measurements (when cross-talk can still raise a signal, and by roughly how much).
- [ ] **Step 8: Run** `node --test "**/*.test.js"`. Expected: all PASS.
- [ ] **Step 9: Commit:** `git commit -am "Hann-windowed sinc for the sequence builders' RF pulses"`

---

### Task 2: Shared slice packing and concatenations in `shared/sequence.js`

**Files:**
- Modify: `shared/sequence.js` (`DEFAULTS`, `sliceTiming`, `concatenationSlices`, `multiSlice`)
- Test: `shared/sequence.test.js`, `shared/crosstalk.test.js`

**Interfaces:**
- Consumes: Task 1's builders.
- Produces:
  - `DEFAULTS` gains `concatenations: "auto"`, `overflow: "passes"`, `pass: 0`.
  - `concatenationSlices(n, c) -> number[][]`: pass k holds spatial indices k, k + c, …, ascending.
  - `sliceTiming(P, rows) -> { slotMs, maxSlices, concatenations, passes: number[][], scanFactor, messages: string[] }`.
    - It builds one single-slice sequence (`slices: 1`, `TR: Infinity`); `slotMs` is its latest gradient end.
    - `maxSlices = Math.max(1, Math.floor(P.TR / slotMs))`.
    - Auto: C = ⌈N / maxSlices⌉. Manual c (1–4): C = max(c, ⌈N / maxSlices⌉), and when raised, a message
      `` `${c} concatenation${c > 1 ? "s" : ""} cannot hold ${N} slices at TR ${P.TR} ms: using ${C}` ``.
    - With `P.overflow === "tr"` and manual 1: C = 1, and no message here (multiSlice raises TR as today).
    - `scanFactor = C`.
    - Throws `"sliceTiming: inversion recovery is not handled here"` when `P.inversion` is not `"none"`.
  - `multiSlice` (N > 1): it plays only the slices of `passes[P.pass]`, keeping their full-stack z positions. The
    chosen order (`acquisitionOrder` on that pass's members) applies within the pass. TR is raised only when
    `P.overflow === "tr"` and C = 1.
  - `info` gains `passes`, `pass`, `concatenations`, `scanFactor` and `slotMs`. `info.slices` lists only the pass's
    slices, each with `{ index (full-stack spatial), zMm, acq }`.
  - At C = 1, events and info are identical to today's, apart from the new info fields.

- [ ] **Step 1: Write the failing tests.**
  - `concatenationSlices(5, 2)` deep-equals `[[0, 2, 4], [1, 3]]`.
  - `slot equals the multi-slice block`: for SE, GRE, FSE and EPI, `sliceTiming(P, rows).slotMs` equals
    `BUILDERS.X({ ...P, slices: 3, TR: 1e6 }, rows).info.block`.
  - `auto concatenations`: GRE TR 50, N = 12 gives C = ⌈12 / max⌉ and no message.
  - `manual too few is raised`: manual 1 at the same settings gives C = ⌈12 / max⌉ and one message containing
    `"cannot hold 12 slices"`.
  - `overflow tr keeps one pass`: `overflow: "tr"`, manual 1 gives C = 1, and the built sequence's TR is raised (as
    today's test).
  - `TR shorter than one block`: GRE TR 10, N = 32 gives maxSlices 1, C 32, and every number finite.
  - `inversion throws`: `sliceTiming({ ...P, inversion: "IR" }, rows)` throws.
  - `a pass plays only its slices`: N = 5, C = 2, pass 1 has 2 excitations, at z of slices 1 and 3 of the full stack.
  - `crosstalk.test.js` `per-pass cross-talk`: N = 6, gap 0, SE. Each pass's factors are closer to 1 than the
    single-pass (C = 1) factors for the same slice.
- [ ] **Step 2: Run** `node --test shared/sequence.test.js shared/crosstalk.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `multiSlice` calls `sliceTiming` for C and passes, then filters to `passes[P.pass]`.
- [ ] **Step 4: Update the one existing test this changes on purpose.** With the default now Auto, too many slices
  become more passes instead of a longer TR (spec §5). So the existing "too many slices raises TR…" test in
  `sequence.test.js` (and any scan or smoke check relying on it) now passes `concatenations: 1, overflow: "tr"`, with
  a comment citing the spec. No other existing test may change.
- [ ] **Step 5: Run** `node --test "**/*.test.js"`. Expected: all PASS.
- [ ] **Step 6: Commit:** `git commit -am "Slice packing and concatenations shared by both pages"`

---

### Task 3: Model hooks in `contrast/physics.js` and `contrast/image.js`

**Files:**
- Modify: `contrast/physics.js` (`computeModel`), `contrast/image.js` (`labelSignals`)
- Test: `contrast/physics.test.js`, `contrast/image.test.js`

**Interfaces:**
- Produces:
  - `computeModel(p, { scanFactor = 1, crossTalk = null } = {})`.
    - `crossTalk` is `{ WM, GM, CSF, Fat, muscle, lesion }` factors or null.
    - When non-null, `baseSignals[name] *= crossTalk[name]` before the voxel-volume scale. Noise is unchanged.
    - `scanSec` is multiplied by `scanFactor`.
    - The model carries `crossTalk` and `scanFactor`.
  - `labelSignals(model, p)` multiplies the muscle and lesion entries by `model.crossTalk?.muscle ?? 1` and
    `?.lesion ?? 1` (WM, GM, CSF and Fat already follow from baseSignals).

- [ ] **Step 1: Write the failing tests.**
  - `extras default to today`: `computeModel(p)` deep-equals `computeModel(p, {})` for every sequence.
  - `scan factor`: `computeModel(p, { scanFactor: 3 }).scanSec` is 3 × the plain value.
  - `cross-talk scales signal not noise`: factors `{ WM: 0.9, … }` give WM signal × 0.9 (to rounding), the same
    noiseFloor, and SNR × 0.9.
  - `image.test.js`: `labelSignals` with `crossTalk.lesion = 0.5` halves the LESION entry.
- [ ] **Step 2: Run** `node --test contrast/physics.test.js contrast/image.test.js`. Expected: the new tests FAIL; the
  golden tests PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "**/*.test.js"`. Expected: all PASS, golden untouched.
- [ ] **Step 5: Commit:** `git commit -am "Contrast model: scan factor and cross-talk factors as optional extras"`

---

### Task 4: `contrast/protocol.js`, the contrast settings mapped to the shared timing

**Files:**
- Create: `contrast/protocol.js`, `contrast/protocol.test.js`

**Interfaces:**
- Consumes: `sliceTiming`, `BUILDERS`, `DEFAULTS` (Task 2); `shotRows(name, P)` from `kspace/scan.js`; `crossTalk`
  (`shared/crosstalk.js`); `tissuesAt` (`contrast/physics.js`); `EXTRA_TISSUES` (`contrast/image.js`).
- Produces:
  - `PROTOCOL_DEFAULTS = { slices: 1, gapPct: 20, sliceOrder: "interleaved", concatenations: "auto", crossTalkOn: true }`.
  - `protocolMode(seq)`:
    - `"packed"` for FSE, GRE, EPI (single-shot) and DWI;
    - `"sequential"` for bSSFP;
    - `"single"` for FLAIR, STIR and DIR;
    - `"3d"` for MPRAGE.
  - `builderName(p)`: FSE with ETL 1 → `"SE"`, FSE → `"FSE"`, GRE → `"GRE"`, EPI (single-shot) and DWI → `"EPI"`.
  - `builderParams(p)`: `{ ...DEFAULTS, nx: p.freqMatrix, ny: p.phaseMatrix, fovRead, fovPhase, bw: p.BW, TE, TR,
    ETL, flip: p.FA ?? 90, sliceMm, slices, gapPct, sliceOrder, concatenations, overflow: "passes", inversion: "none" }`.
  - `protocolTiming(p) -> { mode, N, maxSlices, concatenations, passes, slotMs, scanFactor, messages }`.
    - `"single"` and `"3d"`: N = 1, scanFactor = 1.
    - `"sequential"`: N = p.slices, scanFactor = N, maxSlices = null, C = 1.
    - `"packed"`: N = p.slices, and the rest from `sliceTiming(builderParams(p), shotRows(builderName(p), …).rowsPerShot[0])`.
  - `middleSliceFactors(p) -> { WM, GM, CSF, Fat, muscle, lesion } | null`.
    - Returns null unless the mode is `"packed"`, N > 1 and `p.crossTalkOn`.
    - Otherwise: the middle slice ⌊(N − 1)/2⌋; build the pass that holds it (`pass` = its index in `passes`); run
      `crossTalk(seq, T1s)` with T1s from `tissuesAt(p.field)` (WM, GM, CSF, Fat) plus `EXTRA_TISSUES` (muscle,
      lesion); return that slice's `factor`.
    - Memoise both functions on a key of every input they read.

- [ ] **Step 1: Write the failing tests** (`contrast/protocol.test.js`):
  - `N = 1 is today`: for every sequence, at slices 1, `protocolTiming(p).scanFactor === 1` and
    `middleSliceFactors(p) === null`.
  - `inversion sequences run single-slice` (FLAIR, STIR, DIR with slices 20): N 1, scanFactor 1, factors null.
  - `MPRAGE ignores slices`: slices 20 gives N 1 and scanFactor 1.
  - `bSSFP is slice by slice`: slices 10 gives mode "sequential", scanFactor 10, factors null.
  - `odd matrices stay finite`: FSE at 320 × 192 and EPI with a 512 phase matrix give a finite slotMs, maxSlices ≥ 1
    and C ≥ 1.
  - `pages agree on representable protocols`: GRE 128 × 128, FOV 240, BW 260, TR 100, 20 slices. Here
    `protocolTiming` gives the same maxSlices and concatenations as `sliceTiming` on the parameters the explorer
    would build for the same protocol (nx = ny = 128, fov 240, bw 260, TE, TR, slices, gap, order, as `kspace/ui.js`
    `params()` builds them), and the explorer's scan time
    (TR × TRs × C) equals `computeModel(p, { scanFactor }).scanSec` at NEX 1 and full sampling.
  - `cross-talk factors`: SE, 8 slices, gap 0 gives every factor finite, the WM factor < 1, and the toggle off gives
    null.
  - `speed`: `middleSliceFactors` on a fresh key (FSE ETL 16, 32 slices) takes under 50 ms, ×3 under `process.env.CI`.
    A repeated call with the same key takes under 1 ms.
- [ ] **Step 2: Run** `node --test contrast/protocol.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `contrast/protocol.js`.**
- [ ] **Step 4: Run** `node --test "**/*.test.js"`. Expected: all PASS.
- [ ] **Step 5: Commit:** `git add contrast/protocol.* && git commit -m "Contrast protocol timing and middle-slice cross-talk"`

---

### Task 5: Contrast page: controls, meters, cross-talk toggle and images

**Files:**
- Modify: `contrast/ui.js`, `contrast/index.html` (only if markup is needed), `tools/smoke.mjs`

**Interfaces:**
- Consumes: Task 3's `computeModel(p, extras)`; Task 4's `PROTOCOL_DEFAULTS`, `protocolMode`, `protocolTiming`,
  `middleSliceFactors`.
- Produces: `p.slices`, `p.gapPct`, `p.sliceOrder`, `p.concatenations`, `p.crossTalkOn` in the page state, and
  `timing` (the latest `protocolTiming(p)`), which Task 6 reads.

- [ ] **Step 1: Add the controls to the Geometry tab, after "Slice thickness".**
  - Controls: Slices (1–32), Slice gap (% of thickness, 0–100 in steps of 10, with the gap in mm shown in its
    label), Order (Interleaved, Sequential), Concatenations (Auto, 1–4).
  - Add the new keys to `GEOMETRY_KEEP`, so they survive a sequence change.
  - Hidden for `"3d"`. For `"single"`: disabled, showing 1, with the note *"Multi-slice inversion recovery
    (interleaved inversions, CSF nulling and concatenations) is coming next."*
  - For bSSFP: the note *"bSSFP keeps one slice in steady state at a time, so slices are acquired one after
    another."* For DWI: *"Slice timing uses the EPI readout; the diffusion gradients are not timed here."*
  - Gap and Order are shown only when Slices > 1. Concatenations is shown when Slices > 1 and the mode is
    `"packed"`.
  - A Slices drag across 1 ↔ > 1 updates which controls show without losing focus. Follow the explorer's
    `syncControls` approach in `kspace/ui.js`.
- [ ] **Step 2: Wire the model.**
  - `update()` computes `timing = protocolTiming(p)` and
    `model = computeModel(p, { scanFactor: timing.scanFactor, crossTalk: middleSliceFactors(p) })`.
  - The images' label table follows automatically through `labelSignals`.
  - `timing.messages` go through the page's existing message area as information, not errors.
- [ ] **Step 3: Meters and toggle.**
  - Beside scan time: `` `Slices: ${N} (max ${maxSlices} per TR) · ${C} concatenation${C > 1 ? "s" : ""}` ``. For
    bSSFP: `` `Slices: ${N} · one after another` ``.
  - A checkbox "Include cross-talk (Bloch-simulated slice profiles)" in the Geometry tab, shown when the mode is
    `"packed"` and N > 1, default on.
- [ ] **Step 4: Smoke steps** (`tools/smoke.mjs`, contrast entry), using the real control ids:
  - choose GRE, set TR 100 and slices 32: the meter text contains "concatenations";
  - toggle cross-talk: the WM bar value changes;
  - choose FLAIR: the slices input is disabled and the note is visible.
- [ ] **Step 5: Run** `node --test "**/*.test.js"` and `node tools/smoke.mjs`. Expected: all PASS. Check by hand that
  slider ticks feel no slower than before at 32 slices. If you serve the page, use port 8001, not 8000.
- [ ] **Step 6: Commit:** `git commit -am "Contrast simulator: slices, gap, order, concatenations and cross-talk"`

---

### Task 6: Contrast page: TR timeline strip and planning lines

**Files:**
- Modify: `contrast/ui.js`, `contrast/index.html`, `contrast/contrast.css`, `tools/smoke.mjs`
- Create: `contrast/trstrip.js` (DOM-free layout helper) and `contrast/trstrip.test.js`

**Interfaces:**
- Consumes: `timing` (Task 5); `slicePositions`, `acquisitionOrder` (`shared/sequence.js`).
- Produces: `trStripLayout(timing, TR, order) -> { rows: [{ blocks: [{ slice, x0, x1 }], idleFrom }], more, caption }`.
  - x is a fraction of TR. There are at most 4 rows; `more` is the number of further passes.
  - The caption is, for example, `"5 of max 21 slices per TR · 1 concatenation · TA 4:48"` (TA from `formatTime`).
  - Sequential mode: a single row of N equal blocks, with the caption `"N slices acquired one after another"`.

- [ ] **Step 1: Write the failing tests.**
  - N = 5, C = 1: 1 row, 5 blocks, in acquisition order, each block width = slotMs / TR.
  - C = 6: 4 rows, `more === 2`.
  - The caption matches the example format.
- [ ] **Step 2: Run** `node --test contrast/trstrip.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement the helper, then render it as an SVG** under `#psd`. Use the dark theme and the site's text
  scale, labels S1…, no sideways scrolling at phone width. Hide it at N = 1.
- [ ] **Step 4: Planning lines.**
  - On the coronal and sagittal canvases: one thin line per slice at its z (`slicePositions` centred on the current
    axial position), with the middle slice brighter. Draw the lines over the image after it renders.
  - A "Show slice stack" checkbox (default on) in the image panel header. Shown only when N > 1 and the mode is not
    `"3d"`.
- [ ] **Step 5: Smoke step:** with GRE TR 100 and 32 slices, the strip SVG exists and shows "+" when
  concatenations > 4; the planning-line checkbox toggles without errors.
- [ ] **Step 6: Run** `node --test "**/*.test.js"` and `node tools/smoke.mjs`. Expected: all PASS.
- [ ] **Step 7: Commit:** `git add contrast && git commit -am "Contrast simulator: TR timeline strip and slice-stack planning lines"`

---

### Task 7: Explorer concatenations and the contrast → explorer link

**Files:**
- Modify: `kspace/settings.js`, `kspace/ui.js`, `kspace/scan.js` (only if pass selection needs it), `tools/smoke.mjs`
- Test: `kspace/settings.test.js`, `kspace/scan.test.js`

**Interfaces:**
- Consumes: Task 2 (`concatenations`, `overflow`, `pass`, `info.passes`, `info.scanFactor`); Task 4
  (`protocolTiming`).
- Produces:
  - Settings key `conc` (`"auto"` | 1–4; default `"auto"`; absent at N = 1).
  - `fromContrast(p, timing)`: when `timing.mode === "packed"` and N > 1, it carries `slices`, `gapPct`, `sliceOrder`
    and `conc = timing.concatenations` (resolved, so it may exceed 4; the explorer accepts any integer ≥ 1 from the
    address) and `sel` = the middle slice. Otherwise one slice, as today.
  - `explorerUrl(base, p, timing)`.

- [ ] **Step 1: Write the failing tests.**
  - `conc` round-trips; it is absent at N = 1; `fromQuery("?conc=7")` gives 7.
  - `fromContrast` with a GRE 20-slice timing carries `slices: 20` and the resolved `conc`.
  - `scan.test.js`: `buildShots` with N = 5, C = 2 and the selected slice in pass 1 builds a first sequence with 2
    excitations.
- [ ] **Step 2: Run** `node --test kspace/settings.test.js kspace/scan.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement the explorer.**
  - A Concatenations control (Auto, 1, 2, 3, 4, and the linked value if it is above 4), shown when N > 1.
  - `params()` sets `overflow: conc === 1 ? "tr" : "passes"` and `pass` = the index of the pass that holds `state.sel`.
  - A "Pass k of C" readout beside the TR controls.
  - The slice strip dims the slices that are not in the shown pass.
  - Cross-talk is computed per pass for the strip and the info: one `crossTalk` per pass, each on its own pass's first
    sequence.
  - Info panel: scan time × C and "max M slices per TR".
  - `contrast/ui.js` passes `timing` to `explorerUrl`.
- [ ] **Step 4: Smoke steps.**
  - The contrast page (GRE TR 100, 32 slices) link opened in the explorer shows "Pass 1 of" and no JS errors.
  - The explorer with `?slices=6&conc=2` shows "Pass" and a dimmed strip.
- [ ] **Step 5: Run** `node --test "**/*.test.js"` and `node tools/smoke.mjs`. Expected: all PASS.
- [ ] **Step 6: Commit:** `git commit -am "Explorer: concatenations, pass view and the protocol link"`

---

### Task 8: Docs

**Files:**
- Modify: `README.md`, `docs/roadmap.md`, `docs/kspace-module-plan.md`

- [ ] **Step 1: Update the docs.**
  - `docs/roadmap.md` item 1: part 2, project 1 is done (with a link to the spec); project 2 (multi-slice inversion
    recovery, reference `docs/2d-flair-concatenations-reference.md`) is next.
  - `README.md`: the `contrast/` row mentions multi-slice protocols, and the DOM-free module list gains
    `contrast/protocol.js`.
  - `docs/kspace-module-plan.md`: phase 7, concatenations and the windowed sinc.
- [ ] **Step 2: Run** `node --test "**/*.test.js"`. Expected: all PASS.
- [ ] **Step 3: Commit:** `git commit -am "Docs: multi-slice protocol page and concatenations"`
