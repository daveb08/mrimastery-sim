# MRI Mastery simulators (mrimastery-sim)

Free, browser-based MRI physics simulators: static HTML and ES-module JavaScript, no build step, no framework.
Plotly 2.35.2 (pinned, from jsDelivr) draws the plots. Live at https://sim.mrimastery.com (GitHub Pages, domain in
`CNAME`), published from `main`. This repo replaces the old Streamlit app (`daveb08/mri-simulator`, archived on GitHub
2026-11-15; its code, including the AI "Explain contrast" feature, is in that repo's history). `README.md` has the page
table and the BrainWeb details; `docs/roadmap.md` is the agreed order of future work. Nothing on the roadmap starts without
the owner's go-ahead.

## Run / test

```
python -m http.server 8000                       # then open http://localhost:8000/
node --test --test-concurrency=1 "**/*.test.js"  # every unit test; keep the quotes (Node expands the pattern)
node tools/smoke.mjs [page]                      # every page (or one) in headless Chrome, screenshots in qc-out/
node tools/smoke.mjs --baseline                  # run, then save the screenshots as the reference
```

- Pass `--test-concurrency=1`: the cross-talk timing tests are noisy in parallel runs. On Node 24, pass a file or a
  pattern, not a directory.
- `tools/smoke.mjs` serves the repo root, allows HTTP 404s under `/data/brainweb/`, and each page entry is a list of steps
  (`click`, `url`, `expect`, ...). Backslashes inside the `expect` template strings must be doubled (`\\d`).
- A smoke check that times a slider redraw (under 500 ms) can miss by a few ms on this machine; it fails on older
  commits too, so it is the machine, not the change.
- `/qc` (project skill in `.claude/skills/qc`) runs the tests and the smoke test. GitHub Actions runs both on every push but
  does not stop Pages from publishing.

## Layout

`bloch/` Bloch-equation simulator (`bloch.js` engine, `program.js` TR/repetition programs, `labframe.js`, `ui.js`,
`hints.js`) · `coil/` Biot-Savart fields and B1+ maps · `signal/` Fourier, sampling, RF slice profile · `tuning/` coil tuning
and matching · `phantom/` procedural 3D head phantom and viewer, optional BrainWeb · `contrast/` contrast simulator and
multi-slice protocol page · `kspace/` k-space explorer (`scan.js` shots and rows, `settings.js`, `strip.js`, `ui.js`) ·
`shared/` stylesheet, plot helpers, FFT, `sequence.js` (event-list pulse sequences), `ktraj.js` (k-space paths),
`seqdiagram.js` (to-scale diagram), `crosstalk.js`, `hint.js` (hover, focus and tap explanations) · `tools/` smoke test and
BrainWeb preparation · `docs/` plans, specs and plans under `docs/superpowers/`.

Each simulator keeps its numbers in DOM-free modules with tests beside them (`*.test.js`); the UI files only draw.
Units: ms, Hz, mT/m, mm. Add physics as pure functions with a test first.

## Rules (the owner's, do not break)

- **Never commit or push `data/brainweb/`** (it is git-ignored) until the owner confirms BrainWeb's permission. The repo is
  public, so committing it publishes it. The BrainWeb option shows only when the data file is present.
- **Pushing `main` publishes the live site.** Do not push, merge a PR, or change `CNAME` or the Pages setup without asking.
  Work on a branch in `.worktrees/<name>` (git-ignored); merge to local `main` only when the owner says so.
- **Offer a local preview after page changes**, and if the owner says yes, start a server on a free port and open Chrome
  yourself. Do not stop servers without the owner's say-so, except old previews when asked to.
- **Robustness before features.** Remind the owner to stabilise and test the current build before significant new
  enhancements.
- Commit messages end with the attribution trailer given in the session's system reminder. PR descriptions end with
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)".

## Conventions and gotchas

- Page checks cover behaviour the unit tests cannot (layout, `hidden`, slider widths). When a control's text can change
  width, keep it off the slider's row, or dragging resizes the slider under the mouse and the cursor jumps (fixed twice:
  Bloch, k-space explorer).
- `shared/seqdiagram.js` is used by both the contrast and k-space pages; new drawing options must be opt-in
  (`opts.ladder`, ...) so the other page's output does not change.
- Bloch convention: `dM/dt = γ M×B` in the rotating frame; +x RF tips Mz toward +y; positive off-resonance precesses clockwise.
  The spoiled-GRE test hard-codes a value from the contrast physics; update it if that equation changes.
- k-space explorer: with several concatenations, slices are split into passes (pass k holds slices k, k + C, ...), passes
  run one after another, and slice order only sets the order within a pass.
- Ideas that are paused (not to be started unprompted) are kept in the owner's memory notes: resizable k-space panes, a fixed
  window and level for the reconstructed image, the sequence designer, the B1 + E field panel for the Bloch page.
