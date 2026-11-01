# Future: pulse-sequence designer (idea, not scheduled)

Recorded 2026-11-01 at the user's request, to build after the k-space explorer. Its own page, aimed at people learning
to write pulse sequences.

## What the user described

- **Edit the sequence directly:** move gradient pulses in time, change their amplitudes and durations.
- **Hardware realism:** choose ramp times from gradient-amplifier capabilities (maximum gradient, slew rate).
- **RF pulses:** choose pulse types and design RF pulses (shape, duration, flip angle, bandwidth).
- **See the result:** an image of a phantom acquired with the designed sequence.
- **Built-in Bloch simulator:** watch spin isochromats respond as the RF pulses and gradients act on them.

## How it builds on what exists

- The event-list sequence model (`shared/sequence.js`) and the exact k-space trajectory (`shared/ktraj.js`) are the
  core: the designer edits the same events the k-space explorer draws, and the diagram (`shared/seqdiagram.js`) renders
  them to scale.
- The Bloch engine (`bloch/bloch.js`) already integrates RF and off-resonance per isochromat; driving it from the same
  events (with gradients turned into position-dependent off-resonance) gives the isochromat view and slice profiles.
- The image comes from the phantom: either the k-space trajectory sampled on the phantom's k-space (fast), or a full
  Bloch simulation over the phantom (slow but complete, includes relaxation and imperfect pulses).

## Open questions for when it is planned

- Editing model: free placement with validation, or blocks that snap to the sequence structure?
- Which RF design methods (sinc, Gaussian, SLR, adiabatic)?
- How much of the image should come from full Bloch simulation versus k-space sampling?
- Saving and sharing designs (would need storage; ties into the account-based platform plan).
