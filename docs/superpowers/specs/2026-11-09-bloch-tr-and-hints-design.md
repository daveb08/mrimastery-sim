# Bloch simulator: repetitions (TR) and hover explanations (short design)

Approved by the project owner on 2026-11-09. Small change. Branch `bloch-tr`, from local `main` at 891ada0.

## Intent

1. **Repetition.** Students should see what happens to the spins across more than one TR. For spin echo that is
   90°, τ, 180°, τ (echo), recovery to TR, then the next 90°, 180° and echo. Mz has not fully recovered when the next
   excitation arrives, so the next signal is smaller (T1 saturation). Over several TRs it settles to a steady state.
2. **Explanations.** Every control explains itself in a small box on hover, keyboard focus or tap.

## Approaches

1. **Repeat each experiment's event list N times inside the existing engine (chosen).** Add one engine event,
   `spoil`, which zeroes the transverse magnetization. The event list is already the intended route to a future
   sequence designer.
2. Rebuild the page around a sequence timeline. Rejected: much larger, and not needed for this.

## Decided

- **New controls:**
  - TR (ms): 50–5000, default 500.
  - Repetitions: 1–5, default 2.
- **Minimum TR.** If TR is shorter than the experiment needs, it is raised to the minimum and a short note says so:
  - spin echo: 2τ plus both pulses;
  - inversion recovery: TI plus both pulses;
  - pulse: the pulse.
- **Experiments**, each repeated N times:
  - **Pulse, then free precession:** 90° (or the set flip), then precession until TR. The Delay control is disabled
    for this experiment, because TR now sets the time.
  - **Spin echo:** 90°, τ, 180° (phase +90°), τ (the echo), then recovery until TR.
  - **Inversion recovery:** 180°, TI, 90°, then recovery until TR.
- **Spoiling.** At the end of each TR, before the next excitation, a `spoil` event sets Mx = My = 0 for every
  isochromat. A note explains that real sequences use crusher or spoiler gradients for this. An unspoiled option may
  come later. It is not part of this change.
- **Display:**
  - The time slider, playback, lab frame, B1 field and traces cover the whole run.
  - Each RF pulse keeps its band on the traces.
  - The dashed T2 decay curve restarts at each excitation pulse (not at inversions or refocusing pulses).
  - The readout adds "TR k of N".
  - The whole run still plays in about 12 s.
- **Hover explanations:**
  - A small shared component (`shared/hint.js` plus CSS) shows a styled box anchored to the control.
  - It opens on mouse hover, on keyboard focus and on tap, and closes on leaving, blur, Escape or tapping elsewhere.
  - Each control gets a small "?" marker next to its label, so touch users know to tap.
  - The text lives in one table in `bloch/ui.js` (or a `bloch/hints.js` data file), keyed by control id, so it is
    easy to edit.
  - No text appears in the page until it is opened.

## Draft hover text (for the owner to review and edit before building)

| Control | Text |
|---|---|
| Experiment | Which RF pulse sequence to run. *Pulse* shows a single excitation and the free induction decay. *Spin echo* adds a 180° pulse that refocuses dephasing, so an echo forms at TE = 2τ. *Inversion recovery* starts with a 180° pulse that flips Mz to −z, then excites after TI to show T1 recovery. |
| Set the pulse by | Choose what you control. The flip angle and the B1 strength are linked by θ = 360° × γ̄ × B1 × duration (× a shape factor), so fixing one sets the other. |
| Flip angle | How far the pulse tips the magnetization away from B0 (the z axis), for spins exactly on resonance. 90° puts it all into the transverse plane, which gives the most signal. 180° inverts it, or refocuses it in a spin echo. |
| B1 amplitude (peak) | The strength of the RF magnetic field, B1, at its peak, in microtesla. A stronger B1 tips the spins faster. Clinical scanners typically use roughly 5–25 µT. |
| Pulse duration | How long the RF pulse is on. For the same flip angle, a longer pulse needs less B1. That deposits less RF energy (lower SAR) and excites a narrower range of frequencies. |
| Pulse shape | How B1 varies during the pulse. A rectangular ("hard") pulse is simplest. Sinc and Gaussian pulses concentrate the excitation on a band of frequencies, which is how a slice is selected when a gradient is on. Try them with off-resonance spins to see the difference. |
| RF phase | The direction B1 points in the rotating frame (0° = along x, 90° = along y). It sets the axis the magnetization tips about. The spin echo's 180° is shifted 90° from the excitation. |
| Delay / τ / TI | *Spin echo:* τ, the time from the 90° to the 180°. The echo forms τ after the 180°, at TE = 2τ. *Inversion recovery:* TI, the time from the 180° inversion to the 90° excitation. Choose TI ≈ 0.69 × T1 to null a tissue (when TR is much longer than T1). *Pulse:* not used; TR sets the time. |
| Center off-resonance | How far the spins' precession frequency is from the RF frequency, in hertz. In the rotating frame, off-resonance spins keep precessing, clockwise for positive values. Real causes include B0 inhomogeneity and chemical shift (fat is about 440 Hz below water at 3 T). |
| Isochromat spread (±) | A range of frequencies across the spins in a voxel, from small field differences. The spins fan out and the signal decays faster than T2. This is T2* decay. A 180° pulse reverses the fan-out and forms an echo. |
| T1 | The longitudinal relaxation time. After a 90° pulse, Mz regrows towards its equilibrium value, recovering 63 % in one T1. Short TR relative to T1 leaves less Mz for the next pulse. |
| T2 | The transverse relaxation time. Spin–spin interactions irreversibly decay Mxy, losing 63 % in one T2. Unlike T2* dephasing, a 180° pulse cannot undo T2 decay, so echo peaks fall along the T2 curve. |
| TR | The repetition time: the time from one excitation to the next. If TR is short compared with T1, Mz has not fully recovered and the next signal is smaller. This is T1 weighting. |
| Repetitions | How many TRs to simulate (1–5). Over a few TRs, the signal settles to the steady state that real imaging runs in. Leftover transverse magnetization is spoiled at the end of each TR, as crusher gradients do on a scanner. |
| Rotating / Lab frame | The lab frame shows precession about B0, slowed down millions of times. The rotating frame turns with the spins at the Larmor frequency, so on-resonance spins stand still and only the effects of RF, off-resonance and relaxation remain. |
| Show B1 field | Show or hide the RF field B1 (orange, outside the sphere) while a pulse plays. Its length shows B1 strength relative to the strongest pulse, not the tip angle. |
| Play / Reset | Play runs the experiment (about 12 s). Reset pauses and returns to the start, with M at equilibrium along z. |
| Time slider | Steps through the simulation. Short RF pulses get as much of the slider as long delays, so you can watch them. |

## Testing

- **Engine unit tests:**
  - `spoil` zeroes Mx and My and leaves Mz unchanged.
  - A repeated 90° (spoiled) with TR = 500 ms and T1 = 1000 ms gives a second-TR Mz before excitation of
    1 − e^(−0.5) ≈ 0.393.
  - The steady state after N repetitions approaches (1 − E1) / (1 − cos α · E1), where E1 = e^(−TR/T1).
  - The spin-echo minimum-TR rule holds.
- **Smoke:**
  - The TR and Repetitions controls exist, and the readout shows "TR 2 of 2" near the end.
  - TR is raised when it is set below the minimum.
  - A hint opens on focus and closes on Escape.
- Existing Bloch tests are unchanged.

## Left to the builder

- Exact layout of the new controls, and hint box styling (match the page's dark theme).
- Wording of the minimum-TR note.
