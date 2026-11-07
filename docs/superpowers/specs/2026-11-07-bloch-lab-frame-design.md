# Bloch simulator: lab-frame view (short design)

Approved by the project owner 2026-11-07. Small change.

## Intent

Students should see precession as it happens in the lab frame, like a tipped toy top, and then switch to the
rotating frame to see why MRI uses it: the whirling vector stands still. This is step 1 of a larger idea. Step 2
(later, separate design) adds the RF field as a plane wave with B1 and its perpendicular E field, followed by a
"what actually happens in a coil" panel (near-field B1, induced E, heating). The owner chose that plane-wave-then-
coil order (option 3). The lab frame comes first because the wave only exists in the lab frame.

## Goals

- A Rotating / Lab frame toggle beside the 3D view. Default Rotating, so current behaviour is unchanged.
- Lab view: spins and the net M precess about z at an illustrative rate, with a label such as
  "Precession slowed ≈10⁶–10⁷× (true rate γB0)".
- A B1 arrow drawn during RF pulses: fixed along its phase direction in the rotating frame, rotating with the
  spins in the lab frame, so the nutation spiral has a visible cause.
- Mx/My/Mz traces follow the chosen frame (owner's decision for the first pass). In the lab frame, Mx and My show
  oscillation inside the decay envelope.

## Non-goals

- Plane wave, E field, heating or SAR (step 2).
- An equilibrium cone of random-phase spins (possible later).
- Any change to the physics engine `bloch/bloch.js` or its tests.

## Approaches

1. **Display transform (chosen).** Rotate the rotating-frame results already computed by `runProgram` about z by
   a display angle. Physics untouched, cheap.
2. Put the true Larmor term in the engine. Rejected: it needs about 10⁶ times more steps for no visible gain, and
   the true rate cannot be animated anyway.

## Decided details

- The lab rotation advances at a fixed rate per animation frame (per simulation frame), not per simulated
  millisecond, because the animation already stretches short pulses far more than long delays.
- Precession sense follows the engine convention (positive off-resonance precesses clockwise); the lab rotation
  is in the Larmor sense for a positive γ, consistent with that convention.

## Known risk (accepted, to evaluate)

Because the rotation follows frames, lab-frame traces plotted against time show different apparent oscillation
rates during the pulse and during delays. If it confuses students, label it or revisit.

## Left to the builder

- The exact display rate (degrees per frame) and the label wording.
- B1 arrow styling, and how its length shows pulse amplitude or shape.
- Where the toggle sits in `bloch/index.html`.

## Where

Live repo `C:\Dave\mrimastery-sim`, branch `bloch-lab-frame` from `main`. The `multislice` branch changes only
`bloch/bloch.js` (Hann-sinc envelope), so the two do not overlap.
