# Bloch Lab-Frame View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rotating / Lab frame toggle to the Bloch simulator's 3D view and traces, plus a B1 arrow during pulses.

**Architecture:** A new DOM-free module `bloch/labframe.js` turns the engine's rotating-frame frames into lab-frame
vectors (rotation about z by a per-frame display angle) and reports the B1 direction and relative amplitude at each
frame. `bloch/ui.js` uses it for the 3D arrows, the trail and the Mx/My traces. `bloch/bloch.js` is not changed.

**Tech Stack:** Plain ES modules, Plotly 2.35.2 (already loaded), `node --test`, `tools/smoke.mjs` (headless Chrome).

**Spec:** `docs/superpowers/specs/2026-11-07-bloch-lab-frame-design.md`

## Global Constraints

- Do not change `bloch/bloch.js` or `bloch/bloch.test.js`.
- Default frame is Rotating; with the toggle on Rotating, the page must look and behave exactly as before, apart
  from the new B1 arrow during pulses.
- Lab rotation advances per simulation frame, not per simulated millisecond: `LAB_DEG_PER_FRAME = 8`.
- Lab rotation sense matches the engine's: positive off-resonance precesses clockwise seen from +z, so the lab
  angle at frame i is `−i × 8°` (clockwise).
- Lab label text (exact): `Lab frame: precession drawn at an illustrative rate, millions of times slower than the true Larmor frequency (γB0 ≈ 64 MHz at 1.5 T).`
- B1 arrow color `#ff9f43`, length `0.9 ×` relative amplitude (peak of that pulse = 1), lying in the xy plane.
- Traces follow the chosen frame: in Lab, Mx and My are lab-frame; Mz, |Mxy| and the T2 curve are unchanged.
- Tests: `node --test bloch/labframe.test.js` and `node --test bloch/bloch.test.js` (pass files, not the directory,
  on Node 24); `node tools/smoke.mjs bloch`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Toggling the frame while paused at mid-pulse: the arrows, trail and B1 arrow must redraw at the same frame without
  resimulating or jumping the time slider.
- Switching experiment or any parameter while in Lab: Lab stays selected and the lab label stays visible.
- Lab traces must use every frame (no `stride` decimation): decimating an 8°-per-frame oscillation aliases it.
  Programs today have at most about 1060 frames, so stride is 1; pin it so a future longer program cannot alias.
- Inversion recovery (180° along z): the lab view must not show a B1 arrow during delays, and Mz traces stay identical
  in both frames.
- A single spin (spread 0) and many spins: both rotate by the same lab angle, so their relative phases are unchanged.

---

### Task 1: Lab-frame math module

**Files:**
- Create: `bloch/labframe.js`
- Test: `bloch/labframe.test.js`

**Interfaces:**
- Consumes: `runProgram`, `envelope` from `bloch/bloch.js` (unchanged); the `events` array passed to `runProgram`
  (`{type, durMs, dtMs, shape, tbw, phaseDeg}`) and its `eventEnds`.
- Produces:
  - `export const LAB_DEG_PER_FRAME = 8;`
  - `export function labAngle(frameIndex: number): number` — radians, `−frameIndex × 8° × π/180`.
  - `export function toLab([x, y, z]: number[], angle: number): number[]` — rotate about z by `angle`.
  - `export function rfAt(events, eventEnds, frameIndex): {bx: number, by: number} | null` — the rotating-frame B1
    direction times relative amplitude (0..1, peak of that pulse = 1) for the step that produced `frameIndex`;
    `null` at frame 0 and during non-RF events. Step count per event must match `runProgram`:
    `Math.max(1, Math.round(durMs / (dtMs ?? 0.05)))`; frame `i` in event `k` is step `i − start − 1`, where
    `start` is the previous event's end (0 for the first event). Amplitude = `envelope(shape, steps, tbw)[step]` /
    the envelope's maximum.

- [ ] **Step 1: Write the failing tests** in `bloch/labframe.test.js`:

```js
test("labAngle is zero at frame 0 and clockwise", () => {
  assert.equal(labAngle(0), 0);
  near(labAngle(45), -(45 * 8 * Math.PI) / 180);
});
test("toLab preserves length and z, and rotates +x clockwise", () => {
  const v = toLab([1, 0, 0.3], labAngle(1));
  near(Math.hypot(v[0], v[1]), 1); near(v[2], 0.3); assert.ok(v[1] < 0);
});
test("lab sense matches the engine's positive off-resonance sense", () => {
  // +y after a 90x pulse; a short delay at +100 Hz moves it the same way as a lab step does.
  const r = runProgram([{ type: "rf", flipDeg: 90, durMs: 0.1 }, { type: "delay", durMs: 0.5 }],
                       { T1: Infinity, T2: Infinity, offResHz: [100] });
  const m = r.frames[r.frames.length - 1];
  const lab = toLab([0, 1, 0], labAngle(1));
  assert.equal(Math.sign(m[0]), Math.sign(lab[0]));
});
test("rfAt: null at frame 0 and in delays; phase and amplitude in pulses", () => {
  const events = [{ type: "rf", flipDeg: 90, phaseDeg: 90, durMs: 1, dtMs: 0.1, shape: "rect" },
                  { type: "delay", durMs: 1, dtMs: 0.1 }];
  const ends = [10, 20];
  assert.equal(rfAt(events, ends, 0), null);
  assert.equal(rfAt(events, ends, 15), null);
  const b = rfAt(events, ends, 5); near(b.bx, 0); near(b.by, 1);
});
test("rfAt: sinc peaks at 1 mid-pulse and is smaller near the ends", () => {
  const events = [{ type: "rf", flipDeg: 90, durMs: 1, dtMs: 0.0125, shape: "sinc", tbw: 4 }];
  const ends = [80];
  near(Math.max(...Array.from({ length: 80 }, (_, i) => rfAt(events, ends, i + 1).bx)), 1);
  assert.ok(Math.abs(rfAt(events, ends, 1).bx) < 0.2);
});
```

Use the same `near` helper as `bloch/bloch.test.js`. A sinc envelope has negative side lobes, so `bx`/`by` can be
negative; that is correct (the field reverses).

- [ ] **Step 2: Run** `node --test bloch/labframe.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `bloch/labframe.js` with the four exports above.
- [ ] **Step 4: Run** `node --test bloch/labframe.test.js` and `node --test bloch/bloch.test.js`. Expected: all PASS.
- [ ] **Step 5: Commit** `bloch/labframe.js`, `bloch/labframe.test.js`: "Bloch: lab-frame rotation and B1 direction helpers".

### Task 2: Frame toggle, B1 arrow and lab traces in the page

**Files:**
- Modify: `bloch/index.html` (transport bar, note paragraph)
- Modify: `bloch/ui.js` (`drawScene`, `drawTraces`, `showFrame`, listeners)
- Modify: `tools/smoke.mjs` (bloch steps)
- Modify: `README.md` (bloch row)

**Interfaces:**
- Consumes: `LAB_DEG_PER_FRAME`, `labAngle`, `toLab`, `rfAt` from Task 1.
- Produces: `<select id="frame">` with options `rot` ("Rotating frame", selected) and `lab` ("Lab frame") in the
  `.transport` bar after `#readout`; `<p id="labNote" class="note" hidden>` directly under `#scene` holding the exact
  lab label text.

- [ ] **Step 1: Add the smoke steps** to the `bloch` entry in `tools/smoke.mjs`, after the existing steps:

```js
["set", "frame", "lab"], ["click", "play"], ["wait", 1500], ["click", "play"],
["expect", "lab frame shows its label", `!document.getElementById("labNote").hidden`],
["set", "program", "ir"],
["expect", "lab frame survives a change of experiment", `document.getElementById("frame").value === "lab" && !document.getElementById("labNote").hidden`],
["set", "frame", "rot"],
["expect", "rotating frame hides the lab label", `document.getElementById("labNote").hidden`],
```

- [ ] **Step 2: Run** `node tools/smoke.mjs bloch`. Expected: FAIL (no `#frame`).
- [ ] **Step 3: Implement in `bloch/index.html` and `bloch/ui.js`:**
  - Add the `#frame` select and `#labNote` as in Interfaces. Append to the existing `.note` paragraph:
    "The orange arrow is the RF field B1 (the part rotating with the spins), drawn while a pulse plays."
  - `drawScene`: append two traces after the mean head, a B1 shaft (`scatter3d` line, `#ff9f43`, width 6) and a B1
    head (`headTrace("#ff9f43", …)`), both starting empty, so `DYNAMIC + 5` and `DYNAMIC + 6` index them.
  - A helper `view(v, i)` returns `v` in Rotating and `toLab(v, labAngle(i))` in Lab. `showFrame(i)` applies it to every
    spin vector, the mean vector and each trail point `j ≤ i` (trail point `j` uses `labAngle(j)`), and draws the B1
    arrow from `rfAt(sim.events, sim.eventEnds, i)` as the vector `[0.9·bx, 0.9·by, 0]` passed through `view`; when
    `rfAt` is `null`, restyle both B1 traces to empty arrays.
  - `drawTraces`: in Lab, replace `mx[i], my[i]` by the first two components of `toLab([mx[i], my[i], 0], labAngle(i))`
    and use `stride = 1`; in Rotating keep the current stride. Keep `sim.mean` in the rotating frame (showFrame
    applies `view` itself).
  - `$("frame")` `input` listener: show/hide `#labNote`, call `drawTraces()` and `showFrame(currentFrame())`. Do not
    call `refresh()` and do not stop playback.
  - Readout: append `" · lab frame"` when Lab is selected.
- [ ] **Step 4: Run** `node tools/smoke.mjs bloch`, `node --test bloch/labframe.test.js`, `node --test bloch/bloch.test.js`.
  Expected: all PASS. Open `bloch/` locally and check by eye: in Lab after a 90° pulse M spirals down and keeps
  circling; in Rotating it stands still on +y; the orange B1 arrow shows only during pulses.
- [ ] **Step 5: README:** in the `bloch/` row, add "rotating and lab frame views" to the description.
- [ ] **Step 6: Commit** the four files: "Bloch: rotating / lab frame toggle with a B1 arrow".
