# Multi-slice Imaging (k-space explorer, 2D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** N interleaved 2D slices per TR in `/kspace/`, with per-slice RF offsets, order and gap, the TR-limited slice
count, and per-tissue cross-talk computed from Bloch-simulated slice profiles, shown as a profile plot and a slice strip.

**Architecture:** A `multiSlice(build)` wrapper in `shared/sequence.js` lays N copies of one slice's block into the
TR. A new DOM-free `shared/crosstalk.js` simulates each pulse type once with the Bloch engine, then solves the
steady-state Mz along z in closed form (affine map per z per tissue) to get each slice's signal ratio against an
isolated slice. The explorer multiplies its label signal table by those ratios per slice.

**Tech Stack:** Plain ES modules, no build step; `node:test`; Plotly 2.35.2 (already loaded via `shared/plot.js`);
headless-Chrome smoke test `tools/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-04-multislice-design.md` — read it with this plan.

## Global Constraints

- 2D only; nothing here is shaped for reuse by the later 3D mode.
- **N = 1 behaves exactly as today:** identical event lists, diagram, images and URL. Existing tests pass untouched.
- N range 1–32, default 1. Gap 0–100 % of thickness in 10 % steps, default 20 %. Orders `sequential` and
  `interleaved` (default `interleaved`; odd slices first, starting with slice 1 even when N is even).
- Stack centred on z = 14 mm (the explorer's current slice position); slice index 0 is the most inferior.
- `freqHz = GAMMA_BAR * 1000 * gss * zMm` (GAMMA_BAR is per ms).
- Too many slices raises TR to N × block, keeps N, and reports an error naming the minimum TR and the max slices at the
  requested TR.
- With N > 1 the inversion is forced to `"none"` and its control is hidden, with a note.
- Cross-talk is per tissue (every phantom label with signal), from simulated pulses only — no fudge factors.
- Cross-talk recompute < 50 ms in Node at N = 32 FSE; no animation frame blocked for more than ~50 ms by the strip.
- Strip thumbnails are `min(64, ny)` square at the same FOV, cached by (z, thickness, FOV), filled progressively.
- Not modelled, and said so in captions: magnetisation transfer, FSE stimulated echoes, relaxation during pulses.
- Run tests with `node --test "**/*.test.js"` from the repo root; smoke with `node tools/smoke.mjs`.

## Review Focus

1. **A stack far larger than the head** (N = 32, 10 mm, gap 100 % spans 630 mm): computes, slices outside the head
   show black thumbnails, no NaN, no crash. → Task 4 test `huge stack stays finite`.
2. **Reducing N below the selected slice:** selection falls back to the middle slice, never an out-of-range index.
   → Task 2 test `clampSel`.
3. **Asking for too many slices, then fewer:** TR returns to the user's requested TR (the raise is never written back
   into the settings). → Task 1 test `requested TR is kept in info`; Task 6 keeps `state.TR` untouched.
4. **Matrix smaller than 64 or larger:** thumbnail row mapping is correct for ny = 32 and ny = 256.
   → Task 8 test `thumbRow maps central rows`.
5. **Cross-talk can never brighten a slice:** every factor ≤ 1 + 1e-9 even at gap 0 % with thin slices.
   → Task 4 test `factors never exceed 1`.

---

### Task 1: `multiSlice` wrapper and slice-aware k-space samples

**Files:**
- Modify: `shared/sequence.js` (DEFAULTS, new `slicePositions`, `acquisitionOrder`, `multiSlice`; BUILDERS)
- Modify: `shared/ktraj.js` (`adcSamples` passes `slice` through)
- Test: `shared/sequence.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS` gains `slices: 1, gapPct: 20, sliceOrder: "interleaved", stackCenterMm: 14`.
  - `slicePositions(n, sliceMm, gapPct, centerMm) -> number[]` (mm, ascending; index 0 most inferior).
  - `acquisitionOrder(n, order) -> number[]` — slice index played at each acquisition position.
  - `multiSlice(build) -> (P0, rows) => seq`. For N > 1:
    - RF events gain `slice` (index), `zMm`, `gss` (mT/m of the slice-select lobe under it), `freqHz`;
    - ADC events gain `slice`;
    - `seq.info` gains `slices: [{ index, zMm, acq }]`, `block` (ms), `maxSlices` (⌊requested TR / block⌋),
      `requestedTR`, `sliceMm`, `order`.
  - `BUILDERS.X = multiSlice(withInversion(x))` for all four.
  - `adcSamples` items gain `slice: adc.slice ?? 0`.

- [ ] **Step 1: Write the failing tests** in `shared/sequence.test.js`:

```js
test("multiSlice with one slice returns the unwrapped builder's sequence unchanged", () => {
  for (const k of ["SE", "GRE"]) {
    const plain = k === "SE" ? withInversion(spinEcho)(P, 32) : withInversion(gradientEcho)(P, 32);
    assert.deepEqual(BUILDERS[k]({ ...P, slices: 1 }, 32), plain);
  }
});
test("slice positions are centred, spaced by thickness x (1 + gap)", () => {
  assert.deepEqual(slicePositions(3, 5, 20, 14), [8, 14, 20]);
});
test("interleaved order plays odd slices first, starting with slice 1", () => {
  assert.deepEqual(acquisitionOrder(5, "interleaved"), [0, 2, 4, 1, 3]);
  assert.deepEqual(acquisitionOrder(4, "interleaved"), [0, 2, 1, 3]);
  assert.deepEqual(acquisitionOrder(3, "sequential"), [0, 1, 2]);
});
test("N slice blocks back to back, each with its own offset and the same k-space path", () => {
  const one = BUILDERS.SE({ ...P, TR: 3000 }, 32), seq = BUILDERS.SE({ ...P, TR: 3000, slices: 3 }, 32);
  const ex = seq.events.filter((e) => e.kind === "rf" && e.role === "excite");
  assert.equal(ex.length, 3);
  // ex[a] is acquisition a: interleaved 0, 2, 1
  assert.deepEqual(ex.map((e) => e.slice), [0, 2, 1]);
  ex.forEach((e, a) => assert.ok(near(e.center, ex[0].center + a * seq.info.block)));
  for (const e of ex) assert.ok(near(e.freqHz, GAMMA_BAR * 1000 * e.gss * e.zMm));
  // every block samples exactly the single-slice k positions
  const s1 = adcSamples(one), s3 = adcSamples(seq);
  for (let j = 0; j < 3; j++) {
    const mine = s3.filter((s) => s.slice === j);
    assert.equal(mine.length, s1.length);
    mine.forEach((s, i) => { assert.ok(near(s.colExact, s1[i].colExact, 1e-6)); assert.ok(near(s.rowExact, s1[i].rowExact, 1e-6)); });
  }
});
test("too many slices raises TR to N x block and names the limit; requested TR is kept in info", () => {
  const probe = BUILDERS.GRE({ ...P, TR: 50, slices: 2 }, 32);
  const n = probe.info.maxSlices + 3, seq = BUILDERS.GRE({ ...P, TR: 50, slices: n }, 32);
  assert.ok(near(seq.tr, n * seq.info.block));
  assert.equal(seq.info.requestedTR, 50);
  assert.match(seq.errors.join(" "), new RegExp(`TR too short for ${n} slices.*at most ${probe.info.maxSlices} slices`));
});
test("multi-slice forces the inversion off", () => {
  const seq = BUILDERS.FSE({ ...P, ETL: 8, TR: 9000, inversion: "IR", slices: 3 }, rowsAll(8));
  assert.ok(!seq.events.some((e) => e.kind === "rf" && e.role === "invert"));
});
```

- [ ] **Step 2: Run** `node --test shared/sequence.test.js` — Expected: the new tests FAIL (`slicePositions` not
  exported); existing 18 PASS.

- [ ] **Step 3: Implement** in `shared/sequence.js`. `multiSlice`: if `(P.slices ?? 1) <= 1` return
  `build(P0, rows)` untouched. Otherwise build once with `{ ...P0, TR: Infinity, inversion: "none" }`; `block` =
  latest gradient end; copy the events N times shifted by `a * block` for acquisition position `a`
  (`rf.center`, `adc.tc`, `grad.start`), tagging slice fields. `gss` for an RF event is the amplitude of the z
  gradient whose flat top contains `rf.center`. Error text when `P.TR < N * block`:
  `` `TR too short for ${N} slices: the minimum TR is ${Math.ceil(N * block)} ms (at most ${max} slices fit in TR ${P.TR} ms)` ``
  where `max = Math.floor(P.TR / block)`; TR becomes `N * block`. In `ktraj.js`, add `slice: adc.slice ?? 0` to each
  sample.

- [ ] **Step 4: Run** `node --test "**/*.test.js"` — Expected: all PASS.

- [ ] **Step 5: Commit** — `git add shared/sequence.js shared/ktraj.js shared/sequence.test.js && git commit -m "Multi-slice: N slice blocks per TR with per-slice RF offsets"`

---

### Task 2: Settings in the page address

**Files:**
- Modify: `kspace/settings.js`
- Test: `kspace/settings.test.js`

**Interfaces:**
- Consumes: `DEFAULTS` slice keys from Task 1.
- Produces: `RANGES.slices = [1, 32]`, `RANGES.gapPct = [0, 100]`; `ORDERS = ["sequential", "interleaved"]`; query
  keys `slices`, `gap` (gapPct), `order` (sliceOrder), `sel`; `applies(key, s)` is false for `gapPct`, `sliceOrder`,
  `sel` when `(s.slices ?? 1) <= 1`, false for `slices` when it is 1, and false for `inversion`/`TI*` when slices > 1;
  `clampSel(sel, n) -> number` (integer in 0..n-1; `null`/`undefined`/out of range → `Math.floor((n - 1) / 2)`).

- [ ] **Step 1: Write the failing tests:**

```js
test("multi-slice settings round-trip and vanish when there is one slice", () => {
  const s = { seq: "SE", slices: 7, gapPct: 30, sliceOrder: "sequential", sel: 2 };
  assert.deepEqual(pick(fromQuery(`?${toQuery(s)}`), ["slices", "gapPct", "sliceOrder", "sel"]), pick(s, ["slices", "gapPct", "sliceOrder", "sel"]));
  assert.equal(toQuery({ seq: "SE", slices: 1, gapPct: 30, sliceOrder: "sequential", sel: 0 }), "seq=SE");
  assert.equal(fromQuery("?slices=99").slices, 32);
});
test("clampSel", () => {
  assert.equal(clampSel(7, 5), 2);
  assert.equal(clampSel(undefined, 4), 1);
  assert.equal(clampSel(3, 5), 3);
});
```
(`pick` is a two-line helper in the test file.)

- [ ] **Step 2: Run** `node --test kspace/settings.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** in `kspace/settings.js` (add `slices`, `gapPct` to `NUMERIC`; `sel` parsed as an integer
  0–31; `order` validated against `ORDERS`).
- [ ] **Step 4: Run** `node --test "**/*.test.js"` — Expected: all PASS (the existing 6 settings tests unchanged).
- [ ] **Step 5: Commit** — `git commit -am "Multi-slice settings in the explorer's address"`

---

### Task 3: Bloch-simulated pulse profiles

**Files:**
- Create: `shared/crosstalk.js`
- Test: `shared/crosstalk.test.js`

**Interfaces:**
- Consumes: `envelope`, `scaleToFlip`, `blochStep`, `HZ_PER_MT_M_MM` from `bloch/bloch.js`.
- Produces: `pulseProfile({ role, flipDeg, durMs, gss, tbw = 4, shape = "sinc", phaseDeg = 0, u }) -> profile`, where `u` is a `Float64Array` of
  positions (mm) relative to the slice centre, and `profile` is
  `{ u, zz: Float64Array, mxyRe, mxyIm, b2Re, b2Im }` (Float64Arrays):
  - `zz` — the rotation's zz element (Mz after / Mz before, transverse spoiled);
  - `mxy` — transverse per unit Mz after the pulse **and** the slice rephaser (excite only; zeros for refocus);
  - `b2` — the spin-echo coefficient (refocus only; zeros for excite):
    `b2 = (Rxx − Ryy)/2 + i (Ryx + Rxy)/2`, the factor multiplying conj(M+) after the pulse with crushers.

- [ ] **Step 1: Write the failing tests:**

```js
test("excite profile: FWHM matches the slice thickness and phase is flat after the rephaser", () => {
  const gss = 4 / 2 / (GAMMA_BAR * 5); // TBW 4, 2 ms, 5 mm — as sequence.js computes it
  const u = grid(-15, 15, 0.05), p = pulseProfile({ role: "excite", flipDeg: 90, durMs: 2, gss, u });
  assert.ok(Math.abs(fwhm(u, abs(p.mxyRe, p.mxyIm)) - 5) < 0.25);
  assert.ok(Math.abs(abs(p.mxyRe, p.mxyIm)[centre(u)] - 1) < 0.01);
  assert.ok(phaseSpread(p, u, 1.5) < 0.1); // radians, within the central ±1.5 mm
});
test("refocus profile: zz ≈ −1 and |b2| ≈ 1 at the centre, zz → 1 and b2 → 0 far away", () => { /* 180°, same gss */ });
test("an ideal hard 180 about x gives b2 = 1, about y gives b2 = −1", () => { /* shape "rect", gss 0, phaseDeg 0 / 90 */ });
```
(`grid`, `abs`, `fwhm`, `centre`, `phaseSpread` are small helpers in the test file; `GAMMA_BAR` from
`shared/sequence.js`.)

- [ ] **Step 2: Run** `node --test shared/crosstalk.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `pulseProfile`.** Step `blochStep` directly (not `runProgram`, which stores every frame)
  with 400 steps over the pulse, off-resonance `HZ_PER_MT_M_MM * gss * u[i]`, relaxation off, from starting vectors
  unit x, y and z, to get the 3×3 rotation at each u. Excite: then rotate about z by the net rephasing phase
  `φ(u) = +2π · HZ_PER_MT_M_MM · gss · (durMs / 2) · u · 1e-3` (sign fixed by the flat-phase test). Cache results in a
  `Map` keyed by `role|flip|dur|gss|u0|du|n`.
- [ ] **Step 4: Run** `node --test shared/crosstalk.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add shared/crosstalk.* && git commit -m "Cross-talk: Bloch-simulated excite and refocus profiles"`

---

### Task 4: Steady-state cross-talk factors per tissue

**Files:**
- Modify: `shared/crosstalk.js`
- Test: `shared/crosstalk.test.js`

**Interfaces:**
- Consumes: Task 1's multi-slice `seq` (RF `slice`, `zMm`, `gss`, `role`, `flip`, `duration`, `center`;
  `info.slices`, `info.sliceMm`); Task 3's `pulseProfile`.
- Produces:
  - `crossTalk(seq, tissues) -> { z, slices, profiles }`, `tissues` = `{ name: T1ms }`.
    `z`: Float64Array grid, spacing `sliceMm / 20`, from lowest slice − 3 × thickness to highest + 3 × thickness.
    `slices[j]` (spatial index j): `{ index, zMm, acq, freqHz, factor: { [name]: number }, mzBefore: { [name]: Float64Array } }`.
    `profiles: { excite: Float64Array[], refocus: Float64Array[] }` — per slice, |Mxy| and zz on `z` (refocus empty
    for GRE/EPI), for plotting.
  - `labelFactors(factor) -> Float32Array(8)` indexed by `LABELS` (`phantom/phantom.js`): WM, GM, CSF, FAT ← `Fat`,
    MUSCLE ← `muscle`, LESION ← `lesion`; AIR and BONE = 1.
  - `TISSUE_T1(field = "3.0T") -> { WM, GM, CSF, Fat, muscle, lesion }` from `tissuesAt` and `EXTRA_TISSUES`.

- [ ] **Step 1: Write the failing tests:**
  - `isolated slices read 1`: SE, N = 3, sliceMm 3, `gapPct: 1000` (the builder does not clamp; only the settings
    do) → every factor within 1e-3 of 1.
  - `edges lose less than the middle`: SE, N = 5, gap 0 %, sequential, TR 500 → WM factor of slices 0 and 4 > slice 2.
  - `interleaved beats sequential`: SE, N = 6, gap 0 %, TR 600 → mean WM factor interleaved > sequential.
  - `loss grows as the gap shrinks`: mean WM factor at gap 0 % < 20 % < 50 %.
  - `longer T1 loses more`: CSF factor < WM factor for the middle slice (SE, N = 5, gap 0 %).
  - `factors never exceed 1`: SE, GRE, FSE, EPI at gap 0 %, sliceMm 1, N = 8 → every factor ≤ 1 + 1e-9.
  - `huge stack stays finite`: FSE, N = 32, sliceMm 10, gap 100 % → all factors finite and in [0, 1].
  - `speed`: FSE ETL 16, N = 32, sliceMm 5, all six tissues → `crossTalk` under 50 ms (median of 5 runs, after one
    warm-up so profiles are cached as in the page).
  - `matches brute-force Bloch within 1 %`: SE and GRE, N = 3, gap 0 % and 20 %, coarse grid. Reference, written in the
    test file with `blochStep`:
    each z cell holds 16 isochromats with crusher phases 2πk/16; play the TR's pulses time-stepped (dt 0.02 ms,
    gradient on during the pulse, exact relaxation with zero field over gaps), apply the crusher as a rotation about z
    by +φk before and after each 180, zero Mx/My at the end of each slice block, run 40 TRs, and take
    slice j's signal as |mean over isochromats and z of M+| at its echo (after its rephaser for GRE; after the 180 and
    second crusher for SE). Compare signal(all N) / signal(slice alone) with `crossTalk`'s factor.

- [ ] **Step 2: Run** `node --test shared/crosstalk.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement `crossTalk`.** Profiles from `pulseProfile` on one local grid u spanning ±(stack span +
  6 × thickness), shifted to each slice by linear interpolation; pass each RF event's `phase` as `phaseDeg` (the
  sequence's refocusing pulses are at 90°). Per tissue and z, compose the TR as an affine map on Mz
  — pulses `Mz ← zz·Mz`, gaps `Mz ← 1 − (1 − Mz)·exp(−Δt/T1)` between pulse centres, wrapping at TR — solve
  `Mz_ss = b / (1 − a)` at t = 0, then propagate to just before each excitation. Slice j's signal:
  `| Σ_z Mz_before_j(z) · m_j(z) · R_j(z) · dz |` with `R = 1` (GRE, EPI) or `R = b2` of j's first refocusing pulse
  applied to `conj(m_j)` (SE, FSE). Isolated reference: the same with only slice j's pulses (the same for every j,
  compute once). Factor = ratio.
- [ ] **Step 4: Run** `node --test "**/*.test.js"` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -am "Cross-talk: per-tissue steady-state factors, checked against brute-force Bloch"`

---

### Task 5: Slice labels on the diagram

**Files:**
- Modify: `shared/seqdiagram.js:146-160` (RF drawing)
- Test: `shared/seqdiagram.test.js`

**Interfaces:**
- Consumes: RF `slice`, `freqHz` from Task 1.
- Produces: excitation labels `S{slice + 1}` beside the flip label when `rf.slice !== undefined`; RF hover title gains
  `` `, slice ${slice + 1}, offset ${freqHz.toFixed(0)} Hz` ``.

- [ ] **Step 1: Write the failing test:** `diagramSvg(BUILDERS.SE({ ...P, TR: 3000, slices: 3 }, 32))` contains `S3`
  and `offset`; for `slices: 1` it contains neither.
- [ ] **Step 2: Run** `node --test shared/seqdiagram.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "**/*.test.js"` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -am "Diagram: slice number and RF offset on multi-slice pulses"`

---

### Task 6: Explorer — controls, selected slice, cross-talk-scaled image, info

**Files:**
- Modify: `kspace/ui.js`, `kspace/index.html`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (`crossTalk`, `labelFactors`, `TISSUE_T1`), 5.
- Produces (for Tasks 7–8): `scan.xt` (the `crossTalk` result, or `null` when N = 1), `state.sel` (spatial index),
  `selectSlice(j)`, and `sliceKspace(P, seq, zMm, lut)`-style caching in `phantomKspace` keyed by z and factors.

- [ ] **Step 1: Controls.** Add after `sliceMm` in `CONTROLS`: `slices` (range 1–32, step 1), `gapPct` (range 0–100,
  step 10, label "Slice gap (% of thickness)"), `sliceOrder` (select: Sequential / Interleaved). `gapPct` and
  `sliceOrder` follow `applies`. The `inversion` control is hidden when `slices > 1`, and a `.info` note says:
  "Inversion is off with more than one slice: interleaving inversions across slices is not modelled yet."
- [ ] **Step 2: Scan.** `params()` passes `slices`, `gapPct`, `sliceOrder` and `inversion: "none"` when slices > 1.
  `state.TR` is never overwritten by the raised TR. `state.sel = clampSel(state.sel, slices)` on every rebuild.
  `scan.xt = crossTalk(first, TISSUE_T1())` when N > 1. Samples keep `slice`; `mask()` counts only samples of
  `state.sel`. `phantomKspace` samples the phantom at `info.slices[sel].zMm` (14 when N = 1) and multiplies
  `labelSignals(...)` element-wise by `labelFactors(scan.xt.slices[sel].factor)`; the cache key adds z and the factors
  to 4 decimals.
- [ ] **Step 3: Diagram and status.** Centre-echo zoom picks the ADC with `row === ny / 2` **and**
  `slice === state.sel`. Status line: `ADC sampling line ${row} of slice ${slice + 1}`; RF note names the slice and
  its offset.
- [ ] **Step 4: Info panel** (N > 1): Slices `N (max ${info.maxSlices} at TR ${info.requestedTR} ms)`, Slice spacing
  mm, Coverage mm (`N × thickness + (N − 1) × gap`), Selected slice `j + 1`, RF offset Hz, Cross-talk loss WM / GM /
  CSF as `(1 − factor) × 100` to 1 decimal %.
- [ ] **Step 5: Check by hand** with `python -m http.server 8000`: `?seq=SE&slices=5&gap=0&order=sequential` shows
  five blocks labelled S1…S5, loss figures, and the image changes when `sel` changes; `?seq=SE` looks exactly as
  before. Then `node --test "**/*.test.js"` — Expected: all PASS.
- [ ] **Step 6: Commit** — `git commit -am "Explorer: slice count, gap and order, with cross-talk-scaled images"`

---

### Task 7: Explorer — slice-profile panel

**Files:**
- Modify: `kspace/ui.js`, `kspace/index.html`

**Interfaces:**
- Consumes: `scan.xt`, `state.sel` (Task 6); `draw`, `layout`, `axisStyle`, `COLORS` from `shared/plot.js`.

- [ ] **Step 1: Panel** (shown only when N > 1), new `<div id="profilePlot">` under the k-space panel, with a tissue
  `<select id="profileTissue">` (WM default; GM, CSF, Fat). Traces on z (mm): each slice's excite |Mxy| (thin gold,
  the selected slice thicker); refocusing profiles `(1 − zz) / 2` dashed red (SE/FSE only); the selected tissue's
  `mzBefore` for the selected slice (blue, labelled "Mz just before slice j's excitation"); slice boundaries as light
  shaded rectangles. Clicking a slice's trace selects it.
- [ ] **Step 2: Caption:** what cross-talk is; that magnetisation transfer, FSE stimulated echoes and relaxation
  during the pulses are not modelled; that interleaved order starts with slice 1 (some scanners start with slice 2
  when N is even).
- [ ] **Step 3: Check by hand** at `?seq=SE&slices=5&gap=0`: the blue Mz curve dips at neighbours' positions, and the
  dips shrink with `gap=50`. Then `node --test "**/*.test.js"` — all PASS.
- [ ] **Step 4: Commit** — `git commit -am "Explorer: Bloch slice-profile plot with steady-state Mz"`

---

### Task 8: Explorer — slice strip with progressive fill, and smoke test

**Files:**
- Create: `kspace/strip.js` (DOM-free helpers)
- Test: `kspace/strip.test.js`
- Modify: `kspace/ui.js`, `kspace/index.html`, `tools/smoke.mjs`

**Interfaces:**
- Consumes: `sampleSlice`, `composeSignal`, `labelSignals` (`contrast/image.js`); `kspaceOf`, `reconstruct`
  (`contrast/kspace.js`); `scan.xt`, `state.sel`, `selectSlice` (Task 6).
- Produces:
  - `thumbMatrix(ny) -> Math.min(64, ny)`.
  - `thumbRow(row, ny, m) -> number | -1` — main k-space row → thumbnail row `row − ny/2 + m/2`, or −1 outside.
  - `createSampleCache(sampler) -> { get(zMm, sliceMm, fov) }` — memoises `sampler(z, sliceMm, fov)`.
  - `pump(queue, work, budgetMs, now = () => performance.now()) -> number` — runs `work(queue.shift())` until the
    queue is empty or the budget is spent (always at least one item); returns how many ran.

- [ ] **Step 1: Write the failing tests:**

```js
test("thumbRow maps central rows", () => {
  assert.equal(thumbMatrix(32), 32); assert.equal(thumbMatrix(256), 64);
  assert.equal(thumbRow(128, 256, 64), 32); assert.equal(thumbRow(96, 256, 64), 0); assert.equal(thumbRow(95, 256, 64), -1);
  assert.equal(thumbRow(5, 32, 32), 5);
});
test("sample cache reuses a sampling", () => { /* sampler counted; get(…) twice → 1 call; other z → 2 */ });
test("pump stops at the budget but always runs one", () => { /* fake clock advancing 30 ms per call, budget 40 → 2 */ });
```

- [ ] **Step 2: Run** `node --test kspace/strip.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `kspace/strip.js`.**
- [ ] **Step 4: Strip in the page** (N > 1): a wrapping row of canvases in spatial order, each labelled
  `S{j+1} · #{acq+1} · WM −{loss}%`, the selected one outlined; click → `selectSlice(j)`. On a rebuild, queue all
  slices; each `requestAnimationFrame` calls `pump(queue, renderThumb, 40)`. `renderThumb(j)`: cached 64 × 64 (or ny)
  sampling at `zMm`, signal × `labelFactors`, `kspaceOf`, then `reconstruct` with the main row mask mapped by
  `thumbRow` (a row counts once any of its samples is taken). Thumbnails refresh at each TR boundary and on Fill all,
  not every frame; one shared window/level from the isolated-slice signals so the dimming is visible.
- [ ] **Step 5: Smoke steps** in `tools/smoke.mjs` kspace entry: `["url", "?seq=SE&slices=5&order=interleaved"]`,
  `["click", "fillAll"]`, `["expect", "strip shows five slices", "document.querySelectorAll('#strip canvas').length === 5"]`,
  `["expect", "profile plot drawn", "!!document.querySelector('#profilePlot .main-svg')"]`.
- [ ] **Step 6: Run** `node --test "**/*.test.js"` and `node tools/smoke.mjs` — Expected: all PASS, smoke report
  clean.
- [ ] **Step 7: Commit** — `git add kspace tools/smoke.mjs && git commit -m "Explorer: slice strip with progressive fill"`

---

### Task 9: Docs

**Files:**
- Modify: `docs/roadmap.md`, `README.md`, `docs/kspace-module-plan.md`

- [ ] **Step 1:** `docs/roadmap.md` — mark item 0 done (2026-11-04, commit b5216e2); item 1: "k-space explorer part
  done (2D only; design `docs/superpowers/specs/2026-11-04-multislice-design.md`); contrast simulator next."
- [ ] **Step 2:** `README.md` — add `shared/crosstalk.js` to the DOM-free modules list and multi-slice to the
  `kspace/` row. `docs/kspace-module-plan.md` — a phase 6 line pointing at the spec.
- [ ] **Step 3: Commit** — `git commit -am "Docs: multi-slice in the k-space explorer; roadmap item 0 done"`
