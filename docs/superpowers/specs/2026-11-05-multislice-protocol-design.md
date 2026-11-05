# Multi-slice in the contrast simulator, concatenations, and a windowed sinc: design

Agreed with the user on 2026-11-05. Roadmap item 1, part 2. It builds on the k-space explorer's multi-slice work
(`docs/superpowers/specs/2026-11-04-multislice-design.md`, branch `multislice`, not yet merged). This work starts from
that branch.

## Intent

The simulator teaches MRI technologists (and physics students) the fundamentals. In the user's words: a technologist at
the scanner always prescribes a protocol with several slices, so students must see multi-slice together with the
pulse sequence and the parameter settings, and learn how it affects scan time and SNR.

The roles split as **option C** (chosen by the user):

- **The contrast simulator becomes the technologist's protocol page.** It gets slice count, gap, order and
  concatenations, a correct scan time, the maximum slices the TR allows, and cross-talk's effect on signal and SNR.
- **The k-space explorer stays the "how it works" page.** It gains concatenations and the same scan-time readout, so its
  true-scale diagram shows exactly what the protocol prescribed. Non-Cartesian imaging is planned there (roadmap item 3).

Teaching points the pages must make visible:

- In 2D, the slice count does not change a slice's SNR directly. It acts through TR (a longer TR forced by many slices
  means more T1 recovery), through concatenations (extra passes cost time but add no SNR, unlike averages), and through
  cross-talk (close slices partly saturate each other).
- How the TR sets how many slices fit, and what concatenations cost.

**Two projects (agreed 2026-11-05).** This document is project 1. Multi-slice **inversion recovery** (FLAIR, STIR,
DIR) is project 2, designed separately against the physics reference `docs/2d-flair-concatenations-reference.md`. The
user has already decided that in project 2 the concatenation count **emerges from the physics**. Students choose
1, 2, … passes and see residual CSF rise when neighbouring, wider-than-the-slice inversions overlap. Siemens' "at least
2 concatenations for head FLAIR" is shown as context, with the 2× inversion width as a labelled Siemens-like default,
not enforced as a rule. In project 1, the inversion sequences stay single-slice (see 3).

The user also chose to **switch the site's slice-selective RF pulses to a Hann-windowed sinc** as part of this work.
The unwindowed sinc made cross-talk *raise* the signal in many cases (gradient echo at 90°: CSF up to about +90 %),
which a technologist reading the SNR bars would take for a bug. Scanners play windowed or optimised pulses.

## Goals

1. **Hann-windowed sinc (TBW 4)** for every pulse that the sequence builders (`shared/sequence.js`) define: the
   explorer's diagram, the cross-talk engine, and the slice profiles all use it.
2. **Contrast simulator protocol controls** (Geometry tab): Slices, Slice gap (% of thickness), Order (interleaved or
   sequential), Concatenations (Auto, or 1–4).
3. **Correct timing.** The maximum slices per TR comes from the real pulse timing, using the same builders the explorer
   uses, so both pages always agree. Scan time = TR × shots × NEX × concatenations × the partial-Fourier factor.
4. **Cross-talk in the signal and SNR bars**, with a cross-talk on/off toggle.
5. **A TR timeline strip** under the contrast simulator's pulse diagram, showing how the slices fill each TR.
6. **Slice-stack planning lines** on the coronal and sagittal images, as on a scanner's localizer (designer's
   proposal; see "Calls for the user to check").
7. **The explorer gains concatenations** and a scan-time readout.
8. **The "Open in k-space explorer" link carries the slice settings across.**

## Non-goals

- A new multi-slice module (option B was declined).
- 3D imaging (roadmap item 2) and non-Cartesian trajectories (item 3).
- Anything multi-slice for inversion-recovery sequences (FLAIR, STIR, DIR): slice packing, concatenations, the
  inversion scheduler, inversion profile width, inversion-history cross-talk and RF load. All of that is project 2.
- Replacing the contrast simulator's schematic pulse diagram.
- Magnetisation transfer and stimulated echoes (still not modelled; captions say so).
- Changing the Bloch simulator page's own pulse-shape choices (`bloch/ui.js`), or the Fourier page's RF slice-profile
  panel (`signal/rfslice.js`). Both are separate teaching tools.

## Anti-goals (failure even if it works)

- **With one slice, the contrast simulator's numbers change.** Its signals, SNR, CNR and scan time at N = 1 must stay
  equal to the Python-derived golden values (`contrast/golden.json` and its tests).
- The two pages disagree on the maximum slices or the scan time for the same protocol.
- Sliders lag. The contrast simulator recomputes on every slider tick, so its multi-slice work must stay within the
  explorer's budgets (cross-talk < 50 ms; whole tick comparable to today's).
- Cross-talk numbers that are not traceable to the simulated pulses (no clamping or fudge factors).

## Approaches (chosen: C)

- **A. Extend only the contrast simulator.** Cheapest, but its pulse diagram is a hand-drawn schematic and cannot
  honestly show slices interleaved within TR.
- **B. A new multi-slice / protocol module** with a scanner-style protocol card, the true diagram, TR limits,
  concatenations, interleaving and later non-Cartesian imaging. It would duplicate the explorer's engine and the
  contrast simulator's tissue physics: three pages to keep in agreement.
- **C. Split the roles between the existing pages (chosen).** The protocol page and the mechanics page, linked; no new
  page to keep in sync.

## Decisions

### 1. Windowed sinc

- **Envelope.** A new envelope kind `"hannSinc"` in `bloch/bloch.js`: the TBW-4 sinc multiplied by a Hann window over
  the pulse duration, `0.5 · (1 + cos(2π u))` for u ∈ [−0.5, 0.5]. `"sinc"` stays as it is for the pages that offer it.
- **One source of truth.** `shared/sequence.js` exports `RF_SHAPE = "hannSinc"` beside `RF_TBW`. Every RF event the
  builders emit carries `shape: RF_SHAPE`. `shared/crosstalk.js` reads the shape from the event instead of defaulting
  to `"sinc"`, and `shared/seqdiagram.js` draws the RF envelope from the same `envelope` function.
- **Slice thickness.** The slice-select gradient keeps `gss = RF_TBW / duration / (γ̄ · thickness)`. Windowing mainly
  widens the transition band, and changes the FWHM only slightly. Measure it. If the FWHM is more than 3 % away from
  the nominal thickness, introduce a fixed bandwidth correction for the windowed pulse (measured once, documented in a
  comment) so that it matches to within 3 %.
- **N = 1 changes.** The explorer's diagram RF shape and any slice-profile numbers change; this is intended. The
  contrast simulator is unaffected at N = 1, because its signals come from analytic equations.
- **Re-check.** Report a before/after table of signed cross-talk changes for the cases the final review probed: GRE 90°
  TR 300, GRE 60° TR 100, GRE 30° TR 70, EPI TR 3000, SE; N = 8, 5 mm, gaps 0 % and 20 %, WM and CSF. Update the
  captions and docs to describe what remains. Do not tune anything to hide gains. If any gain above 10 % remains, the
  report says where and why.
- Tests: the excite FWHM test, the `signal/rfslice.js` cross-check (now against a windowed reference or a stated
  tolerance), the brute-force Bloch agreement within 1 % (the reference uses the same envelope), and the flat-phase
  tests, re-baselined where the window legitimately changes them (with the reason in the test comment).

### 2. Slice packing, shared by both pages

- New exported helper in `shared/sequence.js`:
  `sliceTiming(P, rows) → { slotMs, maxSlices, concatenations, slicesPerConcatenation, scanFactor }`.
  - **Slot:** the time one slice needs inside the TR.
    - SE, GRE, FSE and EPI: the single-slice block, as `multiSlice` already measures it.
    - Inversion sequences are not handled here (project 2). `sliceTiming` throws if asked for one, so nothing can
      silently use a wrong packing rule.
  - `maxSlices = ⌊requested TR / slotMs⌋`, at least 1.
  - **Auto concatenations** = ⌈N / maxSlices⌉, with **no upper cap**: EPI at TR 500 with 32 slices really does need
    32 passes, and the page should say so. **Manual** 1–4: if the chosen number is too small, it is raised to the
    required number (which may be above 4) with a message, in the style of the explorer's "TR too short" messages.
    TR is never raised in the contrast simulator. In the explorer, Auto concatenations replace the "raise TR" behaviour
    when the user picks Auto (see 5). (Designer's call after review.)
  - **bSSFP is acquired slice by slice**, not packed: its steady state needs every TR to belong to one slice. Its
    scan time is N × the single-slice time, the TR strip shows "slices acquired one after another", and there is no
    cross-talk factor (each slice is finished before the next starts). (Designer's call after review.)
  - **Splitting slices across concatenations:** concatenation k (0-based) gets slices k, k + C, k + 2C, … in spatial
    order, so neighbouring slices fall in different passes. Within each concatenation, the chosen order applies.
- Scan time (both pages) = TR × shots × NEX × concatenations × pfFraction. At N = 1 this is exactly today's
  `calcScanTime`. `contrast/physics.js` gains the concatenation factor as an argument defaulting to 1, so golden tests
  stay untouched.

### 3. Contrast simulator: protocol page

- **Geometry tab controls** after "Slice thickness":
  - Slices: 1–32, default 1. This is the designer's call, changed from the 1–64 first proposed: 32 matches the
    explorer and the cross-talk speed budget, and 2D clinical stacks rarely exceed it.
  - Slice gap: 0–100 % of thickness in 10 % steps, default 20 %, with the gap also shown in mm.
  - Order: Interleaved (default) or Sequential.
  - Concatenations: Auto (default), 1, 2, 3, 4.
  - Hidden for MPRAGE (3D).
  - For FLAIR, STIR and DIR, the slice controls are shown disabled at 1 slice, with the note "Multi-slice inversion
    recovery (interleaved inversions, CSF nulling and concatenations) is coming next." Scan time is unchanged.
- **What the timing is built from (designer's call after review).** The contrast page calls the sequence builders
  with **its own** settings: frequency and phase matrix (separately; the builders accept nx ≠ ny), both FOVs,
  bandwidth, TE, TR, ETL and flip angle. It does not use the explorer's snapped values (`fromContrast` snaps the
  matrix to 32/64/128/256, forces EPI bandwidth up to 1500 Hz/px and has no NEX or partial Fourier). NEX and
  partial Fourier enter only the scan time. So the protocol page is true to what the user set. The "pages agree"
  anti-goal applies to protocols the explorer can represent exactly: a square 32/64/128/256 matrix, NEX 1, full
  sampling, the same bandwidth, and a non-inversion sequence. A test checks agreement for such protocols.
- **Sequence mapping** for timing and cross-talk uses the sequence part of the existing contrast → explorer mapping
  (`kspace/settings.js` `fromContrast`):
  - FSE (ETL 1 → SE), GRE, EPI.
  - bSSFP → slice by slice (see 2); DWI → EPI timing. Each shows a one-line note in the Geometry tab.
  - Contrast-simulator settings the builders cannot reach (for example a TE below the builder's minimum) are clamped
    the same way the explorer clamps them. Timing is computed from the clamped sequence, with no error banner on the
    contrast page.
- **Meters:** scan time reflects the concatenations, and beside it the page shows "Slices: N (max M per TR) ·
  C concatenation(s)".
- **Cross-talk in signals.**
  - With N > 1, a 2D non-inversion sequence and the toggle on (default on), each tissue's physics signal is multiplied
    by the cross-talk factor of the stack's middle slice. This happens in the model, before the voxel-volume scale.
    Noise is unchanged, so SNR and CNR follow.
  - The factor comes from `crossTalk` on the sequence of the concatenation that holds the middle slice. Slices in other
    concatenations are treated as fully recovered, because passes are seconds apart.
  - Tissues are taken from the field strength's table: `tissuesAt(field)` T1s, not a fixed 3 T.
  - The toggle reads "Include cross-talk (Bloch-simulated slice profiles)".
  - The images use the same factors (label signal table), so bars and images agree.
- **TR timeline strip** under the pulse diagram, one row per concatenation (up to 4 rows, then "+ k more passes"): a bar the length of TR,
  with N blocks in acquisition order labelled S1…, then idle time. Text below it, for example:
  "5 of max 21 slices per TR · 1 concatenation · TA 4:48". Drawn as SVG or canvas, matching the dark theme.
- **Planning lines** on the coronal and sagittal views: one thin line per slice at its z, in the stack colour, with the
  selected or middle slice emphasised. On by default; a "Show slice stack" checkbox turns them off. The stack is
  centred on the axial slice position the views already use.
- **Address and presets.** If the contrast page keeps settings in its address, the new values join them; protocol
  presets keep N = 1 unless the builder finds a preset that clearly needs a slice count (leave presets unchanged
  otherwise).

### 4. Contrast simulator → explorer link

The "Open in k-space explorer" link carries slices, gap, order and the **resolved** number of concatenations (not
"auto"), and the explorer opens on the middle slice. Inversion protocols open with one slice, as today (project 2 changes this).

### 5. Explorer: concatenations and scan time

- New control: Concatenations (Auto, 1–4), shown when N > 1.
  - **Auto:** uses the shared packing rule, so N slices that do not fit become more passes and TR stays as typed.
  - **1:** keeps today's behaviour, where TR is raised to fit and the message says so.
  - **2–4:** fixed passes, raised with a message if too few.
- The TR shown holds the selected slice's concatenation. A "Pass k of C" readout sits beside the TR controls, and the
  slice strip marks which slices belong to the shown pass.
- **Cross-talk:** computed within each pass. Each pass's slices form their own sequence; slices in other passes are
  treated as recovered.
- **Info panel:** scan time = TR × TRs to fill k-space × concatenations, plus "max M slices per TR".
- **Address key:** `conc` ("auto" | 1–4), absent at N = 1.

## Tests

- `bloch/bloch.test.js`: `hannSinc` envelope shape (zero at the ends, peak 1, symmetric) and `shapeFraction`.
- `shared/sequence.test.js`:
  - `sliceTiming` slot for SE/GRE/FSE/EPI equals the multi-slice block;
  - `sliceTiming` throws for an inversion sequence;
  - auto and manual concatenations (including raising a too-small manual value);
  - the k + C·i split;
  - every RF event carries `shape: RF_SHAPE`.
- `shared/crosstalk.test.js`: re-baselined profile tests with the windowed pulse; Bloch reference within 1 %; FWHM
  within 3 % of nominal; a per-pass cross-talk test (two passes give each pass its own factors).
- `contrast/physics.test.js`:
  - N = 1 golden values unchanged;
  - scan time × concatenations;
  - the cross-talk factor applied only when N > 1, 2D, non-inversion and the toggle is on.
- `kspace/settings.test.js`: `conc` round-trips; `fromContrast` carries the slice settings.
- `tools/smoke.mjs`:
  - the contrast page with 32 slices, GRE, TR 100 shows the right number of concatenations in the TR strip and the
    meter, and the explorer opened from it shows "Pass 1 of C";
  - FLAIR shows the slice controls disabled with the project-2 note;
  - toggling cross-talk changes the WM bar;


## Calls for the user to check (designer's proposals)

- Slices limited to 1–32 on both pages (the first proposal said 1–64).
- Planning lines on coronal and sagittal images, with a checkbox.
- Concatenations split slices as k, k + C, …, so neighbours fall in different passes.
- The middle slice's cross-talk drives the bars and images. The toggle defaults to on.
- If the window moves the FWHM by more than 3 %, a fixed bandwidth correction restores the nominal thickness.
- Auto concatenations have no upper cap (EPI at a short TR can need one pass per slice).
- bSSFP is acquired slice by slice: scan time N × single-slice time, no cross-talk.
- The contrast page's timing uses its own matrix, bandwidth and TE (true to the protocol). The two pages are required
  to agree only on protocols the explorer can represent exactly.
- In project 1, FLAIR/STIR/DIR show the slice controls disabled with a "coming next" note.

## Left to the builder

- Layout and styling of the TR strip, the planning lines and the new controls (dark theme, phone width, no sideways
  scrolling).
- Where the cross-talk factor is cached in the contrast page so a slider tick stays fast (for example keyed by
  sequence timing, slices, gap, order, concatenations and field).
- Exact wording of notes and captions, in the site's plain style.
