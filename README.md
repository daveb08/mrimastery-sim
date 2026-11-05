# MRI Mastery simulators

Free, browser-based MRI physics simulators. Static HTML/JS; no build step, no framework.
Plotly (pinned, from jsDelivr) draws the plots.

| Path | Simulator |
|---|---|
| `/` | Landing page linking to each simulator |
| `bloch/` | Bloch-equation magnetization simulator (3D vector, spin echo, inversion recovery) |
| `signal/` | Fourier transforms, sampling/aliasing, RF pulse and slice profile |
| `coil/` | Biot-Savart coil fields, B1+ and flip-angle maps (coil geometry to excitation) |
| `kspace/` | K-space explorer: pulse sequences from real gradient events (`shared/sequence.js`), exact k-space paths (`shared/ktraj.js`), a to-scale diagram (`shared/seqdiagram.js`) and 2D multi-slice with cross-talk from Bloch-simulated pulses (`shared/crosstalk.js`) |
| `tuning/` | Coil tuning and matching: loop inductance, coil and patient losses, parallel-tune / series-match to 50 ohm, S11 and Smith chart (`tuning/tuning.js`) |
| `phantom/` | Procedural 3D head phantom (labels as a function of position) with a three-plane viewer |
| `contrast/` | Contrast simulator and multi-slice protocol page: physics core, trade-off meters, controls (slices, gap, order, concatenations), signal plots, phantom images, pulse-sequence diagrams, TR timeline strip and k-space; see `docs/contrast-port-plan.md` |
| `shared/` | Common stylesheet, Plotly dark-theme helpers, FFT |

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

Hosted with GitHub Pages at the domain in `CNAME`.
