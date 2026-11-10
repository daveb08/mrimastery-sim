# MRI Mastery simulators

Free, browser-based MRI physics simulators. Static HTML/JS; no build step, no framework.
Plotly (pinned, from jsDelivr) draws the plots.

| Path | Simulator |
|---|---|
| `/` | Landing page linking to each simulator |
| `bloch/` | Bloch-equation magnetization simulator (3D vector, spin echo, inversion recovery; rotating and lab frame views) |
| `signal/` | Fourier transforms, sampling/aliasing, RF pulse and slice profile |
| `coil/` | Biot-Savart coil fields, B1+ and flip-angle maps (coil geometry to excitation) |
| `kspace/` | K-space explorer: pulse sequences from real gradient events (`shared/sequence.js`), exact k-space paths (`shared/ktraj.js`), a to-scale diagram (`shared/seqdiagram.js`) and 2D multi-slice with cross-talk from Bloch-simulated pulses (`shared/crosstalk.js`) |
| `tuning/` | Coil tuning and matching: loop inductance, coil and patient losses, parallel-tune / series-match to 50 ohm, S11 and Smith chart (`tuning/tuning.js`) |
| `phantom/` | Procedural 3D head phantom (labels as a function of position) with a three-plane viewer; optional BrainWeb anatomy (local data only, see `tools/prepare-brainweb.mjs`) |
| `contrast/` | Contrast simulator and multi-slice protocol page: physics core, trade-off meters, controls (slices, gap, order, concatenations), signal plots, phantom images, pulse-sequence diagrams, TR timeline strip and k-space; see `docs/contrast-port-plan.md` |
| `shared/` | Common stylesheet, Plotly dark-theme helpers, FFT, hover/focus/tap explanations for controls (`shared/hint.js`) |

Each simulator keeps its numerics in DOM-free modules (`bloch/bloch.js`, `signal/fourier.js`,
`signal/rfslice.js`, `coil/coilfields.js`, `coil/rfexcitation.js`, `phantom/phantom.js`, `contrast/physics.js`, `contrast/protocol.js`, `contrast/trstrip.js`, `shared/crosstalk.js`) with tests beside them. The signal tests check against values computed
with the original Python implementation (the coil tests port the original pytest cases).

```
node --test "**/*.test.js"      # every unit test (the quotes matter: Node expands the pattern)
node tools/smoke.mjs            # every page in headless Chrome; screenshots and report in qc-out/
python -m http.server 8000      # then open http://localhost:8000/
```

`tools/smoke.mjs` loads each page, exercises its main controls, and fails on JavaScript errors, failed loads,
plots that do not draw, or a page check that does not hold. `node tools/smoke.mjs --baseline` saves the
screenshots as a reference; later runs report how much each page changed, with difference images. In Claude
Code, `/qc` runs both (`/qc full` adds a code review and a look at the screenshots). GitHub Actions runs the
tests and the smoke test on every push (`.github/workflows/tests.yml`); it reports problems but does not stop
GitHub Pages from publishing.

## Optional BrainWeb anatomy

The phantom viewer, contrast simulator and k-space explorer can show a real head's anatomy (BrainWeb subject 04)
instead of the generated phantom. The choice appears only when the data file is present; without it every page is
unchanged and uses the generated phantom.

**Do not commit `data/brainweb/` (or push it) until BrainWeb grants permission to redistribute it.** The folder is
git-ignored, so the data stays local and the hosted site does not offer the choice.

To prepare the data locally, run the script below. It downloads subject 04's discrete model from BrainWeb once into
`data/brainweb/source/` and then writes the files:

```
node tools/prepare-brainweb.mjs
```

The result is `data/brainweb/subject04_labels_1mm.u8.gz` and `data/brainweb/subject04_labels_1mm.json`.

Citations (BrainWeb asks that these are cited):

- C.A. Cocosco, V. Kollokian, R.K.-S. Kwan, A.C. Evans: BrainWeb: Online Interface to a 3D MRI Simulated Brain Database. NeuroImage 5(4) part 2/4, S425, 1997.
- R.K.-S. Kwan, A.C. Evans, G.B. Pike: MRI simulation-based evaluation of image-processing and classification methods. IEEE Transactions on Medical Imaging 18(11):1085-97, 1999.
- D.L. Collins, A.P. Zijdenbos, V. Kollokian, J.G. Sled, N.J. Kabani, C.J. Holmes, A.C. Evans: Design and Construction of a Realistic Digital Brain Phantom. IEEE Transactions on Medical Imaging 17(3):463-468, 1998.
- B. Aubert-Broche, M. Griffin, G.B. Pike, A.C. Evans, D.L. Collins: Twenty new digital brain phantoms for creation of validation image data bases. IEEE Transactions on Medical Imaging 25(11):1410-1416, 2006. (publication details to be confirmed)

Hosted with GitHub Pages at the domain in `CNAME`.
