# MRI Mastery simulators

Free, browser-based MRI physics simulators. Static HTML/JS; no build step.

- `index.html`, `ui.js` — Bloch-equation magnetization simulator (Plotly 3D, loaded from jsDelivr)
- `bloch.js` — DOM-free Bloch engine (ms, Hz, mT/m, mm)
- `bloch.test.js` — analytic checks: `node --test bloch.test.js`

Run locally: `python -m http.server 8000`, then open http://localhost:8000/.

Hosted with GitHub Pages at the domain in `CNAME`.
