# MRI Physics Bench simulators

Free, browser-based MRI physics simulators. Static HTML/JS; no build step, no framework.
Plotly (pinned, from jsDelivr) draws the plots.

| Path | Simulator |
|---|---|
| `/` | Home page: rotating showcase (Bloch bench, contrast, k-space), site tour, guided sessions and links to each simulator (`home/`: `tour-data.js` content, `bench.js` and `showcase.js` physics, `home.js` drawing) |
| `bloch/` | Bloch-equation magnetization simulator (3D vector, spin echo, inversion recovery; rotating and lab frame views) |
| `signal/` | Fourier transforms, sampling/aliasing, RF pulse and slice profile |
| `coil/` | Biot-Savart coil fields, B1+ and flip-angle maps (coil geometry to excitation) |
| `kspace/` | K-space explorer: pulse sequences from real gradient events (`shared/sequence.js`), exact k-space paths (`shared/ktraj.js`), a to-scale diagram (`shared/seqdiagram.js`) and 2D multi-slice with cross-talk from Bloch-simulated pulses (`shared/crosstalk.js`) |
| `tuning/` | Coil tuning and matching: loop inductance, coil and patient losses, parallel-tune / series-match to 50 ohm, S11 and Smith chart (`tuning/tuning.js`) |
| `phantom/` | 3D head phantom with a three-plane viewer: Colin27 tissue classes (real anatomy, `data/colin27/`), a procedural phantom (labels as a function of position), and optional BrainWeb anatomy (local data only, see `tools/prepare-brainweb.mjs`) |
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

## Colin27 anatomy (the default phantom)

The phantom viewer, contrast simulator and k-space explorer image a real head's anatomy: the tissue classes of the
"Colin 27 Average Brain, Stereotaxic Registration Model, high-resolution version 2008" (McConnell Brain Imaging Centre,
Montreal Neurological Institute), one normal adult scanned repeatedly. Source and licence:
<https://nist.mni.mcgill.ca/colin-27-average-brain-2008/>; the notice is reproduced in `data/colin27/LICENSE` and must
stay with the data. The generated (procedural) phantom is still there: pages draw it until the data has loaded, fall back
to it if the file is missing, and offer it under "Phantom".

- `data/colin27/colin27_labels_0.5mm.u8.gz` (2.4 MB; 362 x 434 x 362 voxels of 0.5 mm, one byte each) holds a tissue
  label per voxel, and `colin27_labels_0.5mm.json` its grid, origin, source and processing. No image intensities are
  stored: the simulators compute signal from the labels and their own tissue tables.
- Preparation (`node tools/prepare-colin27.mjs 0.5`): downloads the 291 MB NIfTI archive once into
  `data/colin27-source/` (git-ignored), reads the discrete classification volume, maps its classes to the simulator's
  labels, and mirrors x so that +x is patient left. The anterior commissure (MNI 0, 0, 0) is placed at (0, 17, 4) mm,
  the same as the generated phantom. Nothing is resampled or smoothed.
- Class mapping (`phantom/colin27.js`): CSF, grey matter, white matter, fat and skull map directly. Approximations:
  "skin and muscle", dura and vessels use the muscle / soft-tissue values (flow is not modelled); marrow and "fat 2"
  use the fat values.
- Limits: the volume ends near the skull base, so there is no neck; the deep grey nuclei and much of the brainstem are in the
  grey-matter class, as the source's classifier assigned them, and individual nuclei are not labelled separately; it is one person's anatomy and has not been validated here as an
  anatomical reference.

## Optional BrainWeb anatomy

The phantom viewer, contrast simulator and k-space explorer can show a real head's anatomy (BrainWeb subject 04)
as a third choice. It appears only when the data file is present; without it every page is
unchanged.

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
