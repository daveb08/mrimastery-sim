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

Alongside 3–4: an acceleration-factor control in the contrast simulator (scan time ÷ R, SNR ∝ 1 / (g √R), matching
artifacts).
