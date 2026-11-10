# k-space explorer: phase-encode ladder, live Gpe value, jump to any TR — short design

Approved by the project owner 2026-11-10.

## Intent

Students watching the spin-echo (or GRE / FSE) diagram in the k-space explorer could not see the phase encode change
from TR to TR. The physics was already right: every TR plays its own row, the lobe is scaled to it, and the k-space path
follows. But near the edge of k-space the lobe changes by about 1.6 % per TR at 128 lines, and the "30.7 mT/m" under
the Gpe label is the row's full-scale height (the largest phase encode in the scan), so it never changes. Make the
stepping visible and the number honest.

## Goals

1. **Ladder.** In the Gpe row, each phase-encode lobe and phase rewinder (SE, GRE, every echo of an FSE train) is drawn
   over a faint "textbook ladder": 9 evenly spaced outlines of the same lobe timing from −peak to +peak (always
   including both extremes and zero), with this TR's lobe solid on top. Peak = the scan-wide largest phase-encode
   amplitude, so the ladder is the same every TR. Not drawn for EPI (single shot; blips are constant) or for the EPI
   phase prephaser.
2. **Live Gpe value.** Under the Gpe label: this TR's phase-encode amplitude with its sign (e.g. "+29.7 mT/m") and, on a
   second line, the row's scale ("of ±30.7"). In an FSE train it follows the playback cursor: the value of the most
   recent phase-encode lobe that has started (the first one before any has). Gss and Gfe labels are unchanged.
3. **Jump to any TR.** A slider beside ◀ TR / TR ▶, 1…N TRs, with a read-out "TR k of N · line r" (SE / GRE; "(centre)"
   added at ky = 0) or "TR k of N" plus "· holds the centre line" for an FSE shot that contains it. Jumping stops
   playback and goes to the start of that TR; earlier TRs show as acquired (as stepping there would). Hidden when the
   scan has one TR (EPI). With several slices it jumps the whole TR, all slice blocks.

## Non-goals / anti-goals

- No change to the physics, timing, k-space path or reconstruction; this is display only.
- The contrast simulator's diagram (same shared/seqdiagram.js) is unchanged: the ladder and live value are opt-in.
- Not one outline per line: at 128–256 lines that is a solid band and teaches nothing.

## Approaches considered

- Ladder: one outline per line (rejected, unreadable), a fixed 9-step ladder (chosen), or a ladder only on hover
  (rejected, students would not find it).
- Live value: re-render the whole diagram each frame (rejected, costly during playback) vs drawing the value in the
  cursor overlay that is already redrawn every frame (chosen); the static diagram keeps only the "of ±peak" line.
- Jump: a number box (fiddly to sweep) vs a slider with a read-out (chosen).

## Left to the builder

Exact styling of the ladder outlines (faint, same colour as the row), slider placement within the transport bar, and
how the read-out is laid out, consistent with the page.
