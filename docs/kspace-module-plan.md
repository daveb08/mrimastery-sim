# K-space explorer: plan

A standalone page at `/kspace/` where a to-scale pulse-sequence diagram and k-space are animated together, driven by the
gradient physics: k(t) = γ̄ ∫ G(t) dt. Every point of the trajectory follows from the gradients drawn; nothing is a
hand-made path. Agreed with the user on 2026-11-01.

## Decisions

- **Real units and hardware limits.** Events in ms, mT/m and mm (the Bloch engine's units), with adjustable scanner limits
  (default 40 mT/m, 150 T/m/s), so students see why EPI needs strong, fast gradients and when a protocol is impossible.
- **First sequences:** single-echo spin echo, GRE, FSE and EPI (Cartesian). Spiral and PROPELLER come later (they need
  regridding for the reconstruction).
- **Contrast simulator:** keeps its faithful schematic diagram and its K-space tab. In phase 4 its K-space tab gets an
  "Open in k-space explorer" button that opens the new page with the same sequence, matrix, FOV, TE, TR and so on (the
  settings travel in the page address). Replacing the schematic diagram with the new one is decided later.

## Phases

1. **Sequence engine and k-space physics (no UI)** — `shared/sequence.js`, `shared/ktraj.js`.
   - A sequence is a list of events: RF pulses (role excite or refocus, flip, phase, duration), trapezoid gradients per
     axis (amplitude, rise, flat top, fall) and ADC windows (k = 0 time, samples, dwell, direction).
   - Builders for spin echo, GRE, FSE and EPI compute the events from FOV, matrix, bandwidth, slice thickness, TE, TR and
     ETL, within the scanner limits, and report impossible requests (TE or TR too short, gradient too strong).
   - k(t) is integrated exactly from the trapezoids. Excitation resets k to 0 at the RF centre; a refocusing pulse sends
     k to −k.
   - Tests: ADC samples land on the Cartesian grid (Δk = 1/FOV) and each grid point is sampled once over a scan; the echo
     (k = 0) falls at TE; prephaser area is half the readout area; slice rephasing and crushers bring kz back to 0; EPI
     blips are one Δky each; all gradients respect the limits; the 180° inversion behaves correctly.
   **Done** (18 tests in `shared/sequence.test.js`). The tests caught one real sign error during development: in spin echo
   the phase encode precedes the 180, which inverts ky too, so it must be applied with the opposite sign.
2. **Diagram from the events, to scale** — RF, Gss, Gpe, Gfe and ADC/signal rows in real milliseconds, long waits
   compressed with break marks so one TR or echo train fits, zoom into a single echo.
   **Done** (`shared/seqdiagram.js`, 7 tests) on a draft `/kspace/` page (not linked from the landing page yet): gradient
   heights per axis or on one true scale, hover details, and the main parameters and scanner limits as controls.
3. **The page** — diagram on top with a moving time cursor; k-space (trajectory and cursor) and the reconstruction below.
   Playback as a fraction of real time, step by event or by TR, sequence choice and the main parameters. Reuses the
   phantom, reconstruction, text-size control and click-to-zoom.
   **Done (first version):** cursor on the diagram; k-space shows this TR's path k(t) (refocusing jumps dashed) and fills
   with the phantom's k-space at each ADC sample; the image builds from the samples; the ADC row shows the received signal
   |S(k(t))|; playback in ms per second or TRs per second, TR stepping, fill all, and a live note of what is switched on.
   Layout as in the contrast simulator: settings in a right-hand column, everything on one screen.
4. **Polish and links** — the contrast simulator's "Open in k-space explorer" button, a landing-page card, phone and
   iPad checks.
   **Done:** settings live in the page address (shareable links, `kspace/settings.js` with 6 tests); the contrast
   simulator's K-space tab opens the explorer with its settings and notes approximations (inversion pulses, bSSFP, MPRAGE
   and diffusion are not modelled yet); landing card added and the draft label removed; phone (diagram scrolls inside its
   panel) and iPad portrait and landscape checked with no sideways page scrolling.
5. **Inversion recovery and longer TR** (2026-11-01) — TR up to 12 000 ms; one inversion (FLAIR, STIR) or two (DIR)
   before SE or FSE (`withInversion` in `shared/sequence.js`): slice-selective 4 ms 180° inversion plus spoiler, TI
   measured from each inversion centre to the excitation centre, minimum-TI and TR checks. Inversions leave k alone. The
   phantom contrast uses the FLAIR/STIR or DIR signal equations; the info panel shows the CSF, fat or WM null TI. The
   contrast simulator's FLAIR, STIR and DIR now open with their real TI values instead of an approximation note.

6. **Multi-slice imaging, 2D** (2026-11-04) — N slices per TR, each with its own RF frequency offset; slice gap and
   order (sequential or interleaved). TR is raised to N × block when the slices do not fit, and the page shows the
   maximum N for the TR asked for. Cross-talk comes from Bloch-simulated excite and refocus profiles, per tissue
   (`shared/crosstalk.js`), and is shown as a signed signal change. Since 2026-11-05 every pulse the builders emit is
   a Hann-windowed TBW-4 sinc (`RF_SHAPE` in `shared/sequence.js`; 10° FWHM 4.98 mm at 5 mm, so no bandwidth
   correction). With the unwindowed sinc, its side lobes tipped the slice edges out of phase with the centre and
   neighbours that saturated them raised the signal by up to +50 % (CSF, GRE 90°). With the window, cross-talk lowers
   the signal. Measured at 8 slices of 5 mm, 3 T, middle slice: GRE 90°, TR 300 ms, gap 0: WM −20 %, CSF −41 %;
   gap 20 %: WM −5 %, CSF −19 %; EPI TR 3000 ms, gap 0: CSF −12 %; spin echo TR 500 ms, gap 0: CSF −6 %. With gaps
   up to 20 % no factor exceeds 1 (to 1e-4). A small gain remains only at wide gaps (about 30–70 %) for 90° GRE and
   EPI: just outside the slice the 90° profile keeps a weak transverse part opposing the centre, which a neighbour
   saturates; at most +7.8 % (GRE 90°, gap 60 %, TR 100, CSF) and +1.3 % for EPI. The engine matches a brute-force
   Bloch run within 1 %, including CSF at GRE 90° and gap 50 %. Slice-profile plot and slice strip.
   Inversion recovery is off with more than one slice. Design: `docs/superpowers/specs/2026-11-04-multislice-design.md`.
   **Done** for the k-space explorer; 3D is roadmap item 2.

7. **Concatenations and the windowed sinc** (2026-11-05, design `docs/superpowers/specs/2026-11-05-multislice-protocol-design.md`)
   - `sliceTiming` in `shared/sequence.js` gives the slots, the maximum slices per TR, the concatenations (passes) and the
     scan factor. Concatenation k holds slices k, k + C, k + 2C, … in spatial order, so neighbours fall in different passes.
   - Auto concatenations are ⌈N / maxSlices⌉ with no cap, and the TR is never raised for them in the contrast simulator.
     Scan time = TR × shots × NEX × concatenations × partial-Fourier factor.
   - The explorer gains a Concatenations control, a "Pass k of C" view, cross-talk per pass and scan time × concatenations.
     The contrast simulator's "Open in k-space explorer" link carries slices, gap, order and the resolved concatenations.
   - Every builder pulse is a Hann-windowed TBW-4 sinc (`RF_SHAPE`). With it, cross-talk is a signal loss in every case of
     the comparison table; the largest gain found in a wider sweep was about +8 % (GRE 90°, wide gap, CSF), against up to
     +385 % with the plain sinc.
   - Per-pixel tissue fractions: the image side scales each tissue's signal through the label lookup table (one label
     per pixel, with `sampleSlice`'s slab partial volume), not the spec's map of tissue fractions per pixel. Composing
     from per-pixel fractions is a prerequisite for bringing BrainWeb back as a phantom.

## Later

Spiral and PROPELLER (with regridding); driving the Bloch simulator from the same events; possibly replacing the contrast
simulator's schematic diagram.
