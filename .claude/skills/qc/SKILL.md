---
name: qc
description: Quality check for the MRI Mastery simulators. Runs every unit test and the headless-Chrome page smoke test (tools/smoke.mjs), compares screenshots against the saved baseline, and reports pass/fail. Use when the user types /qc, /qc full or /qc baseline, or asks to check the simulators before a commit or push.
---

# /qc: quality check for the simulators

Report what you find; never fix silently and never commit or push as part of this skill. The user decides.

## Modes (from the argument)

- `/qc` (no argument): quick check, steps 1, 2 and 5. Read only the text output, not the screenshots, to keep
  it cheap.
- `/qc full`: the full check before a push, steps 1 to 5.
- `/qc baseline`: run step 2 with `--baseline` to save the current screenshots as the new reference. Do this
  only when the user asks, and only after a run they are happy with, because later runs compare against it.

## Steps

All commands run from the repo root (`C:\Dave\mrimastery-sim` locally). On Windows, use PowerShell.

1. **Unit tests**: `node --test "**/*.test.js"`. Note the pass/fail counts and the name and message of any
   failing test.
2. **Page smoke test**: `node tools/smoke.mjs`. You can pass page names to limit it (landing, contrast,
   kspace, bloch, coil, signal, phantom, tuning). It:
   - loads every page in headless Chrome;
   - exercises the main controls;
   - fails on JavaScript errors, failed loads, plots that did not draw, visible alerts on first load, or a page
     check that does not hold;
   - writes `qc-out/<date-time>/report.md`, with screenshots in `desktop/` and `phone/`;
   - writes red-on-grey difference images in `diff/` when `qc-out/baseline/` exists.

   It exits 1 if any page failed. Allow up to 5 minutes.
3. **Code review** (full only): run `/code-review` on the uncommitted changes, or on the commits not yet on
   `origin/main` if the tree is clean.
4. **Visual review** (full only):
   - Work out which pages the changes touch from the changed paths (`shared/` touches every page).
   - Look at those pages' desktop screenshots, and their phone screenshots if layout or CSS changed.
   - Where a page changed by more than about 1% against the baseline, look at its diff image. Say whether the
     change looks intended.
   - Animated or noisy pages (bloch, contrast noise, kspace) can show small differences from run to run, so do
     not treat a fraction of a percent there as a problem.
5. **Report** a short table, one row per check (unit tests, each page, code review, visual review). Each row
   gives pass, fail or warning and one line of detail. Add the path to `report.md`. Then list what needs
   attention, most serious first, and separate real bugs in the pages from problems in the smoke test itself.

## Maintaining the smoke test

- Page checks live in the `PAGES` table at the top of `tools/smoke.mjs`.
- When a page gains a control or a behaviour worth guarding, add a step there:
  - `set`, `cycle`, `click`, `wait`, `url`;
  - `expect` with a JS expression that returns `true`, or a string explaining the failure.
- A new page needs a new entry, plus a card on the landing page.
- The same script runs on GitHub Actions on every push (`.github/workflows/tests.yml`).
