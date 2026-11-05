# Roadmap

Recorded 2026-11-01; order agreed 2026-11-04 (basic ideas first). Nothing here starts without the user's go-ahead.

**Done:** the k-space explorer (`docs/kspace-module-plan.md`, phases 1–5, including inversion recovery and TR up to
12 s).

0. **Head phantom realism (procedural, option A, chosen 2026-11-03)** — **done (2026-11-04, commit b5216e2).** The aim
   was to keep the phantom generated in code, so it still
   works at any slice and resolution and keeps its seeds and lesions, but make it look anatomical:
   - a brain outline with frontal and occipital poles and temporal lobes;
   - a cortical ribbon of even thickness that follows the gyri;
   - curved lateral ventricles and a third ventricle;
   - the corpus callosum, caudate, putamen and thalamus;
   - a folded cerebellum and a brainstem;
   - a better skull, scalp, face and neck;
   - partial-volume edges.
   Comes first because multi-slice and 3D will show much more of the phantom. Plan it with the user before building.
1. **Multi-slice imaging** — k-space explorer part done (2D only; design `docs/superpowers/specs/2026-11-04-multislice-design.md`);
   contrast simulator next. Scope: interleaving several slices within one TR: slice order (sequential, interleaved), slice
   gap and cross-talk from imperfect slice profiles, and how TR sets the number of slices. Fits the k-space explorer
   (per-slice RF frequency offsets in the event model) and the contrast simulator (slice count and scan time).
2. **3D imaging** — a second phase-encode axis (partition encoding along z): a 3D k-space volume, the scan-time and SNR
   trade-off against 2D, slab-selective excitation, and slab-edge wrap. Links to MPRAGE in the contrast simulator,
   which is 3D in practice.
3. **Non-Cartesian trajectories in the k-space explorer** — radial first, then spiral and PROPELLER, as new sequence
   builders on the event model. Needs a gridding / non-uniform FFT reconstruction (`shared/gridding.js`). Teaching points:
   radial motion robustness, spiral speed and off-resonance blurring, PROPELLER blade rotation and motion correction.
4. **Parallel imaging page (SENSE, then GRAPPA)** —
   - receive-coil sensitivity maps from the coil module's Biot–Savart fields (a ring of loops around the phantom);
   - undersampling from the acquisition plans (every Rth line, plus fully sampled centre lines for GRAPPA), in 2D or
     across both phase-encode axes of 3D;
   - folded images at acceleration R, SENSE pixel-wise unfolding with the coil maps, GRAPPA k-space line synthesis from
     the centre lines, and g-factor maps showing where the SNR penalty falls.
   - Vendor names: SENSE (Philips; Siemens mSENSE, GE ASSET), GRAPPA (Siemens; GE ARC).
5. **Compressed sensing** — random variable-density undersampling (best across the two phase-encode axes of 3D) and an
   iterative sparsity-enforcing reconstruction (e.g. wavelet soft-thresholding / FISTA) at 128 × 128 in the browser;
   show iterations removing noise-like aliasing. Vendor names: Siemens Compressed Sensing, GE HyperSense, Philips
   Compressed SENSE.
6. **Pulse-sequence designer** — see `docs/sequence-designer-idea.md`; draws on everything above.

Alongside 4–5: an acceleration-factor control in the contrast simulator (scan time ÷ R, SNR ∝ 1 / (g √R), matching
artifacts).

## Backlog (not ordered, not started)

- **Real-subject phantom option (OpenNeuro)** — added 2026-11-03.
  - A "Phantom: generated / real subject" switch, with the procedural phantom kept as the default.
  - Source: a healthy adult's 1 mm 3D T1 (plus T2 if available) from a CC0 OpenNeuro dataset, segmented offline
    (SynthSeg, FSL FAST or FreeSurfer, or segmentations shipped with the dataset) into the phantom's labels. The
    labels are stored as a compact file of a few MB.
  - Risks:
    - each dataset's licence must be checked, and the DOI cited;
    - scans are defaced and often neck-cropped, so the subject is for brain views only;
    - the anatomy is fixed (no seeds, no sub-voxel slices, lesions would need painting);
    - segmentation errors are inherited;
    - load size if several subjects are added.
  - Start with a one-subject pilot. First step: research two or three candidate datasets for licence, size and
    segmentations.
