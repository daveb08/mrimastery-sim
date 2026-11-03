# Roadmap (placeholders, not scheduled)

Recorded 2026-11-01. Order is a suggestion for the user to confirm; nothing here starts without their go-ahead.

1. **Finish the k-space explorer** — phase 4 of `docs/kspace-module-plan.md` (contrast-simulator link button, landing
   card, phone/iPad checks).
2. **Non-Cartesian trajectories in the k-space explorer** — radial first, then spiral and PROPELLER, as new sequence
   builders on the event model. Needs a gridding / non-uniform FFT reconstruction (`shared/gridding.js`). Teaching points:
   radial motion robustness, spiral speed and off-resonance blurring, PROPELLER blade rotation and motion correction.
3. **Parallel imaging page (SENSE, then GRAPPA)** —
   - receive-coil sensitivity maps from the coil module's Biot–Savart fields (a ring of loops around the phantom);
   - undersampling from the acquisition plans (every Rth line, plus fully sampled centre lines for GRAPPA);
   - folded images at acceleration R, SENSE pixel-wise unfolding with the coil maps, GRAPPA k-space line synthesis from
     the centre lines, and g-factor maps showing where the SNR penalty falls.
   - Vendor names: SENSE (Philips; Siemens mSENSE, GE ASSET), GRAPPA (Siemens; GE ARC).
4. **Compressed sensing** — random variable-density undersampling and an iterative sparsity-enforcing reconstruction
   (e.g. wavelet soft-thresholding / FISTA) at 128 × 128 in the browser; show iterations removing noise-like aliasing.
   Vendor names: Siemens Compressed Sensing, GE HyperSense, Philips Compressed SENSE.
5. **Pulse-sequence designer** — see `docs/sequence-designer-idea.md`; draws on everything above.
6. **Multi-slice imaging** (added 2026-11-04) — interleaving several slices within one TR: slice order
   (sequential, interleaved), slice gap and cross-talk from imperfect slice profiles, and how TR sets the
   number of slices. Fits the k-space explorer (per-slice RF frequency offsets in the event model) and the
   contrast simulator (slice count and scan time).
7. **3D imaging** (added 2026-11-04) — a second phase-encode axis (partition encoding along z): a 3D
   k-space volume, the scan-time and SNR trade-off against 2D, slab-selective excitation, and slab-edge
   wrap. Links to MPRAGE in the contrast simulator, which is 3D in practice.

Alongside 3–4: an acceleration-factor control in the contrast simulator (scan time ÷ R, SNR ∝ 1 / (g √R), matching
artifacts).
