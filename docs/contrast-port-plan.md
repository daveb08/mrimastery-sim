# MRI contrast simulator: port plan

Port of the Streamlit contrast simulator (`MRI_Simulator/app.py`, about 3,200 lines) to static HTML/JS at `/contrast/`,
using the procedural phantom. No Streamlit, no server (the AI "Explain contrast" button is held for a future paid tier).

## What the original contains

| Piece | Size | Notes |
|---|---|---|
| Tissue tables | small | base values, 9 field strengths, SNR scaling, max TR per field, 8 teaching presets |
| Signal equations | small | FSE, GRE, FLAIR/STIR, bSSFP, DIR, DWI, MPRAGE, EPI; null points, Ernst angle, scan time, noise chain |
| Controls | medium | per-sequence sliders with field-dependent ranges; matrix, FOV, slice, NEX, BW, fat-sat, partial Fourier, EPI ghost |
| Image formation | medium | three planes with crosshairs and click-to-set slice; matrix, FOV aliasing, partial-Fourier Gibbs, partial volume, EPI ghost, noise, window/level |
| Plots | medium | signal and SNR bars, T1 recovery and T2 decay curves, 7-metric row |
| Pulse-sequence diagrams | large | about 1,260 lines of drawing, 8 sequences |
| K-space visualiser | medium | partial fill regions, centric order, reconstruction with noise |
| "What changed?" text | small | about 270 lines |
| AI "Explain contrast" | held | needs a backend; future paid tier |

## Phases

Each phase is usable and pushable on its own; review with the user between phases.

1. **Physics core and tests (no UI).** `contrast/physics.js`: tables, signal equations, Signal -> Noise -> SNR chain,
   scan time, timing constraints, slider ranges, defaults and presets. Verified against golden values generated from the
   original Python (`contrast/tools/gen_from_python.py`). **Done.** In parallel: **layout redesign** (below).
2. **Controls, metrics and plots.** Controls and presets, metric row, signal/SNR bars, signal curves. **Done**, in layout C (below).
3. **Phantom images.** Three planes on the procedural phantom, crosshairs and click-to-set slice, the image pipeline,
   window/level. The headline feature; publish after this phase. **Done** (`contrast/image.js`): acquired matrix and FOV, slab and in-plane partial volume, phase-direction wrap-around, N/2 ghost, Rician noise at the model's noise floor, auto or manual window/level. Not yet: partial-Fourier Gibbs, EPI distortion, fat chemical-shift misregistration.
4. **Pulse-sequence diagrams.** All 8 sequences, ported faithfully first; an event-list rewrite (which could also drive the
   Bloch simulator) is a separate follow-up. **Done** (`psd.js`, `psd_svg.js`): the geometry is tested against 107 figures
   recorded from the real matplotlib code (`tools/gen_psd_from_python.py`). Inherited quirks, kept on purpose: the EPI TEeff
   label overlaps the N/2 ghost note and the bSSFP "Repeating unit" label touches the second RF label. DWI has no diagram in the original either.
5. **K-space visualiser.** Needs a 2D FFT on top of `shared/fft.js`. **Done** (`kspace.js`, any-length FFT in `shared/fft.js`):
   k-space at the acquired matrix (not resized to 128), continuous ky/kx fill sliders with the original's Center/Edges and
   FSE-centric rules (tested against them, `tools/gen_kspace_from_python.py`), noise at the filled points, and an "Images |
   K-space" tab. Partial Fourier is now physically modelled in the images and k-space: an off-centre block of ky lines is
   acquired and the rest zero-filled (the original kept a symmetric central band). Reconstruction auto window/level uses the
   object pixels, since the original's whole-image rule saturated the head in a mostly-air field of view.
   Possible follow-up: a Play button that fills k-space in the sequence's acquisition order.
6. **"What changed?" explanations.**
7. **Polish and retirement.** Mobile layout, shareable URL settings, deploy, retire the Streamlit app and `MRI_Simulator`.

## Layout redesign (added at the user's request)

The user felt the Streamlit layout was not as good as it could be. Observed problems in the original:

- One sidebar holds about 25 controls in a single long scroll.
- Controls sit far from what they change: window/level and slice position are in the sidebar while the images are in the
  main area; timing errors ("TR too short") are buried in the sidebar.
- The core MRI trade-off (contrast vs resolution vs SNR/scan time) is not visible as a group; controls are ordered by
  implementation, not by meaning.
- Images and plots are small, and the main area is one long vertical stack (changes, images, plots, metrics, diagram,
  k-space).
- Key results (scan time, SNR, CNR, voxel size) appear far below the images.

Design principles for the new layout: group controls by meaning (Contrast / Geometry / Signal & time), keep results and
warnings beside the controls and images that cause them, make the images large, use tabs for secondary views (curves,
pulse sequence, k-space), and work at phone width.

## Decisions still open

- Partial volume and matrix: keep the Gaussian blur and downsample/upsample, or sample the analytic phantom properly
  (slab average across thickness, acquired matrix). Recommended: the proper approach.
- New tissues (muscle, bone, lesion) need a signal per sequence; DWI needs ADC. Optional lesion types (demyelinating,
  acute infarct) would make FLAIR and DWI more instructive.
- Analytics: none, privacy-friendly, or Google Analytics.
- Layout direction: **chosen, C** (image plus live trade-off meters). Meters for SNR, resolution and scan time stay pinned beside the images, with an optional pinned baseline showing percent change. Controls are in three tabs (Contrast / Geometry / Signal & time) next to the images, plots below the controls. Reason given by the user: in the old app the controls were far from the images, so they kept scrolling after each change.
- **Data check:** the 3.0 T row of `FIELD_STRENGTH_TISSUES` (WM T1 832 / T2 80, GM T1 1331 / T2 80) differs from the base
  `TISSUES` table (WM 1084 / 69, GM 1820 / 99), although both cite Stanisz et al. 2005. At 3.0 T WM and GM have identical T2,
  so T2-weighted GM/WM contrast comes only from PD. The runtime uses the field table. Worth verifying against the papers.

## Risks

- Fidelity drift from the Python app: mitigated by golden values and by keeping the Python app as the reference until parity.
- The diagrams are the largest single job.
- The original used unseeded random noise; seed it in tests.
