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

## Later

Spiral and PROPELLER (with regridding); driving the Bloch simulator from the same events; possibly replacing the contrast
simulator's schematic diagram.
