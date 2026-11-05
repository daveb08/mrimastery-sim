# Multi-slice imaging in the k-space explorer: design

Agreed with the user on 2026-11-04. Roadmap item 1 (`docs/roadmap.md`), k-space explorer part only. The contrast
simulator's slice count and scan time come afterwards, as a separate piece of work.

## Intent

Students should see how a real 2D scan covers a volume: several slices played one after another inside each TR, each
picked out by its own RF frequency offset, and the price paid for packing them closely — cross-talk, where one slice's
imperfect RF profile (the tails of a truncated sinc, and above all the wide 180° refocusing pulses) partly saturates its
neighbours. The physics must come from the pulses themselves (Bloch-simulated profiles), not a hand-tuned overlap
model, because the teaching point is *why* real pulses cause it and why slice order and gap change it.

**This is for 2D imaging only.** Per-slice RF offsets, slice order, gap and slice cross-talk belong to 2D multi-slice
scans. 3D imaging (roadmap item 2) excites one slab and encodes the partitions with a second phase-encode gradient,
so none of this applies there. The only thing it shares is the slab's own selection profile, which matters for
slab-edge wrap, and that is planned separately. The `multiSlice` wrapper and `shared/crosstalk.js` must not be
written so that they assume a later 3D mode will reuse them.

The user plans to bring BrainWeb back as a second phantom option later, so cross-talk is worked out **per tissue**, and
the image side must accept tissue fractions per pixel as well as the procedural phantom's one label per pixel.

## Goals

- Slice count N, slice gap and slice order controls in `/kspace/`; per-slice RF frequency offsets shown.
- The sequence's TR holds N slice blocks; the page reports the maximum N this TR allows and refuses more, in the same
  style as the existing "TR too short" errors.
- A slice-profile plot along z from Bloch-simulated pulses, with the overlap between neighbours visible.
- A strip of small images, one per slice at its own z, each scaled by its own per-tissue cross-talk loss. Edge slices
  lose less; interleaved order loses less than sequential.
- Interactive: every slider change recomputes the cross-talk in well under 100 ms.

## Non-goals (for this piece)

- Inversion recovery (FLAIR, STIR, DIR) with more than one slice: interleaving inversions across slices is a harder
  timing problem. With N > 1 the inversion options are disabled, with a short note.
- The contrast simulator (slice count, scan time) — next piece.
- Porting BrainWeb to the site (separate backlog work); only the interface is prepared here.
- Simultaneous multi-slice / multiband, concatenations, saturation bands, magnetisation transfer. (Real cross-talk also
  has an MT part; the caption says it is not modelled.)
- Changing how one slice's image looks in-plane; through-slice partial volume stays as `sampleSlice` does it.

## Anti-goals (failure even if it works)

- **N = 1 must behave exactly as today**: same events, diagram, images, URL. Existing tests stay green untouched.
- Sliders that lag. If the cross-talk takes seconds, the design has gone wrong (see Approaches).
- Any cross-talk number that is not traceable to the simulated pulses and relaxation (no fudge factors).

## Approaches (chosen: 1)

All three share the frame: a `multiSlice(build)` wrapper in `shared/sequence.js`, like `withInversion`, that lays N
copies of one slice's block into the TR, each RF event carrying its slice's `freqHz`. They differ in the cross-talk
engine.

1. **Per-pulse profiles composed with exact relaxation (chosen).** Simulate each pulse type once with the Bloch engine
   over a fine z grid; another slice's pulse is the same profile shifted by its offset. Step each z position through
   the TR (pulse effects, exact T1 recovery between them), solve for the steady state, per tissue. Milliseconds per
   change. Ignores relaxation during the 2–4 ms pulses, tiny against TR.
2. **Brute-force time-stepped Bloch through the whole TR** (`runProgram` at 0.05 ms, every z, every tissue, several
   TRs). Most literal, but seconds per slider move for no visible gain. Kept as the **test reference** for approach 1.
3. **Overlap × recovery formula.** Dropped: the user ruled out a simple overlap model.

## Decisions

### Geometry

- Slices are axial (the explorer's plane), positions along z. Slice spacing = thickness × (1 + gap). Gap control:
  0–100 % of the thickness in 10 % steps (the vendor "distance factor"), default 20 %; the info panel also gives it in mm.
- The stack is centred on the explorer's current slice position (14 mm). Slice 1 is the most inferior (lowest z).
- RF offset of slice j: `freqHz = GAMMA_BAR * 1000 * Gss * z_j` (GAMMA_BAR is per ms; Gss is the slice-select amplitude
  of that pulse). Excite and refocus pulses use their own Gss, so their offsets differ; both are shown on hover.
- N from 1 to 32 (strip readability). Default 1, so existing links are unchanged.

### Order and timing

- Orders: **sequential** (1, 2, 3 …) and **interleaved** (odd slices then even: 1, 3, 5, 2, 4). Builder's call noted
  below on even N.
- One slice's block runs from the start of its excitation (or the first event) to the end of its last gradient — the
  builder's existing `end`. Max slices = ⌊TR / block⌋.
- **Too many slices raises TR (user's decision).** As with the existing "TR too short" errors, the requested N is
  kept and TR is raised to N × block, with an error message such as "TR too short for 12 slices: the minimum TR is
  1 240 ms (or at most 9 slices at TR 950 ms)". Contrast, scan time and cross-talk then follow the TR actually played.
  The info panel always shows the max slices for the TR the user asked for.
- Blocks are packed back to back from t = 0, idle time after the last one, as now. (Builder's call; matches how the
  diagram already compresses the idle tail.)
- Every slice block in a TR uses the same phase-encode row(s), so one TR advances all slices' k-space together; scan
  time is unchanged by N, which is the teaching point.
- `withInversion` and `multiSlice` are not combined; with N > 1 the inversion setting is forced to "none".

### Cross-talk engine (`shared/crosstalk.js`, DOM-free, new)

- **Pulse profiles.** For each pulse role present (excite at its flip; refocus 180°), run `bloch.js runProgram` with
  the sequence's envelope (sinc, TBW 4 — the same `RF_TBW` as `sequence.js`), duration and slice-select gradient, over a
  z grid, relaxation off. Run it from three starting vectors (unit x, y, z) to get the full rotation matrix at each z.
  For the excitation, add the slice rephaser as a z-dependent rotation about z so the transverse phase across the slice
  is coherent. Cache by (role, flip, duration, Gss).
- **Grid.** Spacing at most thickness / 20; extent from the lowest slice − 3 thicknesses to the highest + 3. Shifting a
  profile to slice j interpolates linearly on the grid.
- **Spoiling.** Transverse magnetisation is treated as removed between pulses that belong to different slices, and
  between a slice's own pulses except where its own echo is formed (crushers and spoilers do this in the sequence).
  So outside a slice's own signal formation only Mz is tracked: each pulse multiplies Mz(z) by its rotation's zz
  element.
- **Steady state.** Over one TR the map for Mz at each z is affine: Mz → a(z)·Mz + b(z) (products of pulse zz factors
  and E1 = exp(−Δt/T1) recoveries between pulse centres, in time order). The steady state is solved in closed form,
  b / (1 − a), per z per tissue. No iteration.
- **Slice signal (coherent sum; designer's call after review).** Slice j's signal =
  | ∫ Mz_ss(z, just before j's excitation) × Mxy(z) × R(z) dz | over the whole grid, where Mxy(z) is the **complex**
  transverse magnetisation per unit Mz after j's excitation and rephaser (so the opposite-sign sinc side lobes partly
  cancel, as they do in a real receiver), and R(z) is 1 for GRE and EPI and, for SE, the complex spin-echo coefficient
  of j's 180 at z (β² from its Cayley–Klein form, = sin²(θ/2) for an ideal rotation about a transverse axis; the
  crushers keep only this term), applied to the conjugate of Mxy. The engine therefore stores complex weights per z.
  For FSE the first refocusing pulse stands for the train (stimulated echoes not modelled; noted). The brute-force
  reference is also a coherent sum, so the 1 % check compares like with like.
- **Loss factor.** factor[j][tissue] = signal with all N slices / signal with slice j alone (same pulses, same TR).
  Isolated slices therefore read 100 %, and the analytic contrast the explorer already uses is kept; only the
  cross-talk ratio comes from the Bloch model.
- **Tissues.** Every label in the phantom: the 3 T table (`contrast/physics.js`) plus `EXTRA_TISSUES` (muscle,
  lesion). T2 matters only through the existing analytic contrast, not the ratio, since spoiling removes transverse
  history.
- Output: `{ z, profiles: { excite, refocus }, slices: [{ z, freqHz, order, factor: { WM, GM, … }, mzBefore(z) }] }`.

### Images

- Each slice is sampled from the phantom at its own z (`sampleSlice(phantom, "axial", z_j, …)`), its tissue signals
  multiplied by its own factors, then through the existing k-space path.
- Image composition takes, per pixel, **tissue fractions** (a map tissue → fraction). The procedural phantom gives one
  label with fraction 1 (its existing slab partial volume becomes fractions); BrainWeb later supplies its fuzzy
  memberships through the same shape. Pixel signal = Σ fraction × tissueSignal × factor.

### Page

- **Controls** (right column, after "Slice (mm)"): Slices (1–32), Gap (%), Order (sequential / interleaved). Order and
  gap are hidden when N = 1.
- **Info panel:** max slices for this TR, slice spacing in mm, stack coverage in mm, the selected slice's RF offset, and
  its cross-talk loss for WM, GM and CSF.
- **Diagram:** the whole-TR view shows all N blocks; each excitation is labelled with its slice number. The centre-echo
  zoom shows the selected slice's block. The cursor plays through the whole TR.
- **K-space and image panels:** as now, for the selected slice (default: the middle one).
- **Slice-profile panel (new, Plotly via `shared/plot.js`):** along z, each slice's excitation profile |Mxy|, the
  refocusing profiles for SE/FSE (dashed), the steady-state Mz just before the selected slice's excitation (the line
  that shows what cross-talk did), and slice boundaries. A tissue selector (WM default) chooses which tissue's Mz is
  drawn.
- **Slice strip (new):** N small images in spatial order (inferior to superior), each labelled with slice number,
  acquisition position in the order, and WM loss %. Clicking one selects it.
  - **Speed (user's decision).** Sampling the phantom takes about 75–175 ms per slice, so strip images are 64 × 64,
    sampled separately from the main image, cached by (z, thickness, FOV), and filled in a few per animation frame
    after a change (a visible fill-in of about half a second, never a frozen page). The main image stays at full
    matrix through the existing path.
  - Strip images show the k-space rows acquired so far (the same row mask as the main image, applied to their own
    64 × 64 k-space) and refresh at each TR boundary and on Fill all, not every frame.
- **Settings in the address:** `slices`, `gap`, `order`, `sel`; absent when N = 1, so today's links round-trip unchanged.
- Captions: what cross-talk is, that MT effects and FSE stimulated echoes are not modelled, and why inversion is off.

## Tests

- `shared/sequence.test.js`: N = 1 output identical to the unwrapped builder; N blocks with the right offsets and
  `freqHz`; interleaved order; when N × block > TR, TR is raised to N × block and the error names both the minimum TR and the max slices at the
  requested TR; the k-space trajectory of each block is identical
  to the single-slice one.
- `shared/crosstalk.test.js` (new):
  - an ideal (huge) gap gives factors of 1.000;
  - edge slices lose less than middle ones; interleaved loses less than sequential at the same gap; loss grows as the
    gap shrinks; longer T1 loses more;
  - the excite profile's FWHM matches the requested thickness (cross-checked with `signal/rfslice.js`);
  - **reference check:** for SE and GRE at two small settings (N = 3, coarse grid), the factors agree with a
    brute-force `runProgram` run (time-stepped through several TRs, transverse zeroed between slice blocks) to within
    1 %.
  - speed: N = 32, FSE, all tissues computes in < 50 ms in Node.
- Strip: a 64 × 64 sample is cached by (z, thickness, FOV) and reused; a full strip of N = 32 never blocks a single
  frame for more than about 50 ms.
- `kspace/settings.test.js`: new keys round-trip; absent when N = 1.
- `tools/smoke.mjs`: the explorer with N = 5, interleaved, draws the profile plot and the strip with no errors.

## Also in this work

- Mark roadmap item 0 done in `docs/roadmap.md` (pending since 2026-11-04).
- README: mention `shared/crosstalk.js` among the DOM-free modules.

## Calls left to the builder

- Interleaved order with an even N starts with slice 1 (some vendors start with slice 2 for even N); noted in the caption.
- Strip image size and wrapping, and the profile plot's colours, following `shared/style.css` and the dark plot theme.
- Exact z-grid resolution within the stated bound, and caching strategy, as long as the speed test holds.
