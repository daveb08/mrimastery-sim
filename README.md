# MRI Mastery simulators

Free, browser-based MRI physics simulators. Static HTML/JS; no build step, no framework.
Plotly (pinned, from jsDelivr) draws the plots.

| Path | Simulator |
|---|---|
| `/` | Landing page linking to each simulator |
| `bloch/` | Bloch-equation magnetization simulator (3D vector, spin echo, inversion recovery) |
| `signal/` | Fourier transforms, sampling/aliasing, RF pulse and slice profile |
| `coil/` | Biot-Savart coil fields, B1+ and flip-angle maps (coil geometry to excitation) |
| `phantom/` | Procedural 3D head phantom (labels as a function of position) with a three-plane viewer |
| `contrast/` | Contrast simulator: physics core, trade-off meters, controls, signal plots, phantom images, pulse-sequence diagrams and k-space; see `docs/contrast-port-plan.md` |
| `shared/` | Common stylesheet, Plotly dark-theme helpers, FFT |

Each simulator keeps its numerics in DOM-free modules (`bloch/bloch.js`, `signal/fourier.js`,
`signal/rfslice.js`, `coil/coilfields.js`, `coil/rfexcitation.js`, `phantom/phantom.js`, `contrast/physics.js`) with tests beside them. The signal tests check against values computed
with the original Python implementation (the coil tests port the original pytest cases).

```
node --test shared/plot.test.js bloch/bloch.test.js signal/signal.test.js coil/coil.test.js phantom/phantom.test.js contrast/physics.test.js contrast/meters.test.js contrast/curves.test.js contrast/image.test.js contrast/psd.test.js contrast/kspace.test.js contrast/acquisition.test.js   # pass files, not directories (Node 24)
python -m http.server 8000                              # then open http://localhost:8000/
```

Hosted with GitHub Pages at the domain in `CNAME`.
