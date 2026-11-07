# BrainWeb Phantom Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer BrainWeb subject 04 as a second phantom ("Generated / BrainWeb") on the contrast simulator, the
phantom viewer and the k-space explorer, shown only when a locally prepared, git-ignored label file is present.

**Architecture:** A DOM-free module `phantom/brainweb.js` turns a stored 1 mm label volume into an object with the
same `labelAt(x, y, z)` the generated phantom has, so every consumer works unchanged. An offline Node script downloads
BrainWeb's crisp model, maps and downsamples it, and writes `data/brainweb/` (git-ignored). Each page probes for the
file and only then shows the choice.

**Tech Stack:** Plain ES modules, native `fetch` and `DecompressionStream("gzip")`, Node ≥ 18 for the script and tests
(`node:zlib` in the script only), `node --test`, `tools/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-07-brainweb-phantom-design.md`

## Global Constraints

- **Never commit or push anything under `data/brainweb/`.** Add `data/brainweb/` to `.gitignore` in Task 2 before the
  script first writes there; before every commit run `git status --short` and confirm no `data/` path is staged.
- No new dependencies, no build step. Generated stays the default on every page.
- With the data absent, every page looks and behaves exactly as on `main`; the golden physics tests and existing
  smoke steps are unchanged.
- File names: `data/brainweb/subject04_labels_1mm.u8.gz` and `data/brainweb/subject04_labels_1mm.json`.
- Exact copy:
  - choice label `Phantom`, options `Generated` (value `generated`) and `BrainWeb` (value `brainweb`);
  - credit `Anatomy: BrainWeb (McGill), subject 04` linking to `https://brainweb.bic.mni.mcgill.ca/brainweb/`,
    followed by `BrainWeb covers the head down to about the skull base.`;
  - loading `Loading BrainWeb anatomy…`; failure `BrainWeb anatomy could not be loaded`.
- Label map, BrainWeb class → `LABELS`: 0→AIR, 1→CSF, 2→GM, 3→WM, 4→FAT, 5→MUSCLE, 6→MUSCLE, 7→BONE, 8→MUSCLE, 9→FAT,
  10→MUSCLE, 11→FAT.
- Majority-vote tie priority (first wins): WM, GM, CSF, LESION, FAT, MUSCLE, BONE, AIR.
- Coordinates (ours): mm, +x patient LEFT, +y anterior, +z superior. BrainWeb is RAS (+x patient RIGHT): mirror x.
  True size (1 mm = 1 mm). MNI (0, 0, 0) (anterior commissure) is placed at our (0, 17, 4). Outside the volume → AIR.
- Volume storage order (ours, after mirroring): index = i + nx·(j + ny·k), i along +x, j along +y, k along +z;
  sidecar `origin` is our coordinate (mm) of voxel (0, 0, 0)'s centre.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `node --test "**/*.test.js"` (quotes matter); `node tools/smoke.mjs <page>`.

## Review Focus

- Switching Generated ↔ BrainWeb quickly while the first load is in flight: the last choice wins; no stale render.
- `?phantom=brainweb` in a URL when the data is absent: the page silently stays on Generated, with no error.
- Toggling lesions on BrainWeb (contrast, phantom viewer): reuses the cached volume, no second download.
- k-space explorer caches (`kCache`, strip thumbnails) must be keyed by phantom, so a switch never shows stale
  Generated thumbnails.
- With the data absent, no extra console errors or failed requests other than the allowed sidecar 404.

---

### Task 1: BrainWeb phantom core (no I/O)

**Files:**
- Modify: `phantom/phantom.js` (export the example-lesion list; no behaviour change)
- Create: `phantom/brainweb.js`, `phantom/brainweb.test.js`

**Interfaces:**
- Produces, from `phantom/phantom.js`: `export const EXAMPLE_LESIONS_MNI` — the existing list of
  `[[cx, cy, cz], [a, b, c]]` (MNI-style centre and semi-axes, mm) that `createPhantom` already maps with `mni()`;
  `createPhantom` must use this constant, so its output is unchanged.
- Produces, from `phantom/brainweb.js`:
  - `export function mapBrainwebLabel(cls: number): number`
  - `export const TIE_PRIORITY: number[]` (the label order above)
  - `export function downsampleMajority(src: Uint8Array, dims: [nx, ny, nz], factor = 2): { data: Uint8Array, dims }`
    — src already in our labels; each output voxel takes the most frequent label of its factor³ block, ties by
    `TIE_PRIORITY`; trailing partial blocks use the voxels they have.
  - `export function brainwebPhantom(volume: Uint8Array, meta: { dims, voxelMm, origin }, { lesions = false } = {}):
    { labelAt(x, y, z): number, options: { source: "brainweb", lesions } }` — nearest-voxel lookup; AIR outside;
    with lesions, a point inside any `EXAMPLE_LESIONS_MNI` ellipsoid placed at true size at our coordinates
    `(cx, cy + 17, cz + 4)` with semi-axes `(a, b, c)` returns LESION **only where the volume has WM**.

- [ ] **Step 1: Write the failing tests** in `phantom/brainweb.test.js`:
  - `mapBrainwebLabel maps all 12 classes` — the exact table in Global Constraints; an unknown class (12) → AIR.
  - `downsampleMajority takes the majority` — a 2×2×2 block of six GM and two WM → GM.
  - `downsampleMajority breaks ties by priority` — four WM and four CSF → WM; four FAT and four AIR → FAT.
  - `downsampleMajority output dims` — dims [4, 6, 2] → [2, 3, 1]; dims [5, 4, 4] → [3, 2, 2].
  - `brainwebPhantom looks up the nearest voxel` — volume dims [3, 3, 3], voxelMm 1, origin [-1, -1, -1], voxel
    (2, 1, 1) set to WM: `labelAt(1, 0, 0) === WM`, `labelAt(0.6, 0, 0) === WM`, `labelAt(-1, 0, 0) === AIR` (not
    mirrored again: the stored volume is already in our orientation).
  - `brainwebPhantom is AIR outside the volume` — `labelAt(5, 0, 0)` and `labelAt(-1.6, 0, 0)` are AIR.
  - `lesions paint WM only` — a volume all WM around the first lesion centre `(cx, cy + 17, cz + 4)` returns LESION
    there with `{ lesions: true }` and WM with `{ lesions: false }`; the same point in an all-GM volume stays GM.
  - In `phantom/phantom.test.js` (existing file) add: `EXAMPLE_LESIONS_MNI has six lesions` and keep every existing
    test passing (generated output unchanged).
- [ ] **Step 2: Run** `node --test phantom/brainweb.test.js phantom/phantom.test.js`. Expected: FAIL (module/exports missing).
- [ ] **Step 3: Implement** the exports above in `phantom/phantom.js` and `phantom/brainweb.js`.
- [ ] **Step 4: Run** `node --test "**/*.test.js"`. Expected: all PASS, including every existing phantom and golden test.
- [ ] **Step 5: Commit** `phantom/phantom.js phantom/brainweb.js phantom/brainweb.test.js phantom/phantom.test.js`:
  "BrainWeb phantom core: label map, downsampling, labelAt".

### Task 2: Loader, availability probe and the preparation script

**Files:**
- Modify: `phantom/brainweb.js`, `phantom/brainweb.test.js`, `.gitignore`
- Create: `tools/prepare-brainweb.mjs`

**Interfaces:**
- Consumes: Task 1's `mapBrainwebLabel`, `downsampleMajority`, `brainwebPhantom`.
- Produces, in `phantom/brainweb.js`:
  - `export const BRAINWEB_DIR = "data/brainweb/"`, `BRAINWEB_FILE = "subject04_labels_1mm"`.
  - `export async function brainwebAvailable(rootUrl: string, fetchFn = fetch): Promise<boolean>` — GET
    `${rootUrl}${BRAINWEB_DIR}${BRAINWEB_FILE}.json`; true only for an OK response with valid JSON; never throws.
  - `export function loadBrainweb(rootUrl: string, fetchFn = fetch): Promise<{ volume: Uint8Array, meta }>` —
    memoised per `rootUrl` (one download per page life); decompresses with `DecompressionStream("gzip")`; rejects
    (and clears the memo) if the byte count ≠ `meta.dims` product.
  - `export async function makePhantom(name: "generated" | "brainweb", { rootUrl, lesions = false, seed = 1,
    sulcalDepthMm = 14, fetchFn } = {}): Promise<phantom>` — Generated → `createPhantom(...)`; BrainWeb →
    `brainwebPhantom(...)` from the memoised load.
  - Pages pass `rootUrl = "../"`.
- Sidecar JSON fields: `dims`, `voxelMm` (1), `origin`, `orientation: "x=left,y=anterior,z=superior"`,
  `labels` (our label names), `source` (BrainWeb URL, subject 04 crisp), `acPlacedAt: [0, 17, 4]`, `citations`
  (the spec's list), `note: "Not for redistribution without BrainWeb's permission"`.

- [ ] **Step 1: Add `data/brainweb/` to `.gitignore`** and confirm with `git check-ignore -v data/brainweb/x.json`
  (Expected: prints the `.gitignore` rule).
- [ ] **Step 2: Write the failing tests** (fake `fetchFn` returning `new Response(...)`; gzip the fixture with
  `node:zlib` in the test):
  - `brainwebAvailable is false for 404, bad JSON or a network error, true for a good sidecar`.
  - `loadBrainweb returns the volume and meta` — a 2×2×2 fixture round-trips byte for byte.
  - `loadBrainweb downloads once` — two calls with the same rootUrl → the fake fetch saw the `.u8.gz` once.
  - `loadBrainweb rejects a wrong-size volume and retries next time` — first call rejects; a later call fetches again.
  - `makePhantom("generated")` returns a phantom whose `labelAt(0, 17, 30)` equals `createPhantom()`'s.
- [ ] **Step 3: Run** `node --test phantom/brainweb.test.js`. Expected: FAIL.
- [ ] **Step 4: Implement** the loader functions.
- [ ] **Step 5: Run** `node --test "**/*.test.js"`. Expected: all PASS.
- [ ] **Step 6: Write `tools/prepare-brainweb.mjs`** (no dependencies; `node:zlib`, global `fetch`):
  1. Download subject 04's crisp model as gzipped raw bytes. Expected request (verify against BrainWeb's download
     form if it fails): `https://brainweb.bic.mni.mcgill.ca/cgi/brainweb1?do_download_alias=subject04_crisp&format_value=raw_byte&zip_value=gnuzip&download_for_real=%5BStart+download%21%5D`.
     Cache the download in `data/brainweb/source/` so reruns do not re-download.
  2. Check the decompressed length equals 362 × 434 × 362 (0.5 mm grid); stop with a clear message otherwise.
     Source order is x fastest, then y, then z; world start (−90.25, −126.25, −72.25) mm RAS — confirm on BrainWeb's
     data-format page and record what was used in the sidecar.
  3. Map classes with `mapBrainwebLabel`, mirror x, downsample with `downsampleMajority` (factor 2 → 181 × 217 × 181),
     compute `origin` so MNI (0, 0, 0) lands at our (0, 17, 4), write the two files with gzip.
  4. Print dims, compressed size and label counts.
- [ ] **Step 7: Run** `node tools/prepare-brainweb.mjs` (downloads BrainWeb locally; allowed: nothing is published).
  Expected: dims `181 217 181`, a `.u8.gz` of about 0.5–2 MB, nonzero WM, GM and CSF counts.
- [ ] **Step 8: Alignment check:** run a one-off Node command (not committed) that loads the file with
  `brainwebPhantom` and prints labels along the midline at z = 4 every 10 mm of y, and at (±25, 17, 15). Expected:
  brain tissue (WM/GM/CSF) at our (0, 17, 4) and lateral-ventricle CSF within ±10 mm of (±15, 5, 20); AIR beyond
  |y| ≈ 110. If the anatomy is off by more than ~10 mm or mirrored, fix the origin/orientation and rerun.
- [ ] **Step 9: Commit** `.gitignore phantom/brainweb.js phantom/brainweb.test.js tools/prepare-brainweb.mjs` after
  `git status --short` shows no `data/` path staged: "BrainWeb loader, availability probe and preparation script".

### Task 3: Phantom viewer page, and the smoke allowance

**Files:**
- Modify: `phantom/index.html`, `phantom/ui.js`, `tools/smoke.mjs`

**Interfaces:**
- Consumes: `brainwebAvailable`, `makePhantom` (Task 2).
- Produces: in each page that offers it, `<select id="phantomSrc">` (hidden until available) and
  `<p id="bwCredit" hidden>` with the credit copy; a `#bwStatus` element for loading/failure text. Tasks 4 and 5 use
  the same ids. URL param `phantom=brainweb` selects BrainWeb when available.

- [ ] **Step 1: Smoke allowance:** in `tools/smoke.mjs`'s `record`, ignore an HTTP 404 whose URL contains
  `/data/brainweb/` (comment why: the BrainWeb file is git-ignored until permission). Nothing else changes.
- [ ] **Step 2: Add smoke steps** to the `phantom` page entry:

```js
["expect", "BrainWeb choice shown only when its data is present", `(async () => {
  const ok = (await fetch("../data/brainweb/subject04_labels_1mm.json")).ok;
  await new Promise((r) => setTimeout(r, 300));
  return document.getElementById("phantomSrc").hidden === !ok; })()`],
["expect", "BrainWeb draws with its credit (skipped without data)", `(async () => {
  const s = document.getElementById("phantomSrc"); if (s.hidden) return true;
  s.value = "brainweb"; s.dispatchEvent(new Event("input", { bubbles: true }));
  for (let i = 0; i < 50 && document.getElementById("bwCredit").hidden; i++) await new Promise((r) => setTimeout(r, 100));
  return !document.getElementById("bwCredit").hidden && document.getElementById("seed").disabled; })()`],
```

- [ ] **Step 3: Run** `node tools/smoke.mjs phantom`. Expected: FAIL (no `#phantomSrc`).
- [ ] **Step 4: Implement:** the select (with the `Phantom` label) beside the existing controls; probe on load;
  `draw()` gets its phantom from `makePhantom` keyed by `source|seed|sulcal|lesions`, ignoring results that arrive
  after a newer choice; seed and sulcal-depth controls disabled for BrainWeb; credit shown for BrainWeb; failure
  reverts the select to Generated and shows the failure copy. The page subtitle gains: "Choose BrainWeb for a real
  head's anatomy." only while the choice is visible.
- [ ] **Step 5: Run** `node tools/smoke.mjs phantom` with the data present, then again after temporarily renaming
  `data/brainweb` (restore it afterwards). Expected: pass both times, no problems listed.
- [ ] **Step 6: Commit** `phantom/index.html phantom/ui.js tools/smoke.mjs`: "Phantom viewer: BrainWeb choice".

### Task 4: Contrast simulator, and the hand-over to the k-space explorer

**Files:**
- Modify: `contrast/index.html`, `contrast/ui.js`, `kspace/settings.js`, `kspace/settings.test.js`, `tools/smoke.mjs`

**Interfaces:**
- Consumes: Task 2's `makePhantom`, `brainwebAvailable`; Task 3's element ids.
- Produces: `kspace/settings.js` `KEYS.phantom = "phantom"`; `fromQuery` accepts only `generated` | `brainweb`;
  `fromContrast(p, timing)` copies `p.phantom` when it is `"brainweb"`; `applies("phantom", s)` is always true, so
  `toQuery` emits it whenever it is set.

- [ ] **Step 1: Failing tests** in `kspace/settings.test.js`:
  - `fromQuery reads phantom=brainweb and ignores other values` (`phantom=xyz` → no `phantom` key).
  - `fromContrast carries phantom brainweb into the explorer URL` — `explorerUrl("../kspace/", { ...p, phantom: "brainweb" }, timing)` contains `phantom=brainweb`; without it, no `phantom=` appears.
- [ ] **Step 2: Smoke steps** for `contrast`: the same two expectations as Task 3, the second checking that the
  image canvases still draw (reuse the page's existing image check) and the credit shows.
- [ ] **Step 3: Run** `node --test kspace/settings.test.js` and `node tools/smoke.mjs contrast`. Expected: FAIL.
- [ ] **Step 4: Implement:** the `Phantom` select next to "Show lesions"; the module-level `phantom` comes from
  `makePhantom` (lesions toggle rebuilds from the cache); all renders wait for the current phantom and ignore stale
  results; the credit under the images while BrainWeb is shown; the explorer link passes `phantom: "brainweb"`.
- [ ] **Step 5: Run** `node --test "**/*.test.js"` and `node tools/smoke.mjs contrast`, with and without the data
  (rename/restore as in Task 3). Expected: all pass.
- [ ] **Step 6: Commit** the five files: "Contrast simulator: BrainWeb choice, carried to the k-space explorer".

### Task 5: K-space explorer, docs

**Files:**
- Modify: `kspace/index.html`, `kspace/ui.js`, `tools/smoke.mjs`, `README.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: `makePhantom`, `brainwebAvailable` (Task 2); `state.phantom` from `fromQuery` (Task 4); the Task 3 ids.

- [ ] **Step 1: Smoke steps** for `kspace`: the two expectations as in Task 3 (BrainWeb case: the image canvas
  redraws and the credit shows), plus `["url", "phantom=brainweb"]` followed by an expect that, without data, the
  select is hidden and the page shows no error.
- [ ] **Step 2: Run** `node tools/smoke.mjs kspace`. Expected: FAIL.
- [ ] **Step 3: Implement:** `const phantom` becomes the current phantom from `makePhantom` (no lesions);
  `state.phantom` (default `generated`; an unavailable `brainweb` falls back silently); switching clears `kCache`
  and any strip thumbnail cache and rebuilds the scan as any setting change does; include the phantom in every cache
  key that depends on the image; credit shown for BrainWeb.
- [ ] **Step 4: Run** `node --test "**/*.test.js"` and `node tools/smoke.mjs` (all pages), with and without the data.
  Expected: all pass, every page unchanged without the data.
- [ ] **Step 5: Docs:** README — `phantom/` row gains "optional BrainWeb anatomy (local data only, see
  `tools/prepare-brainweb.mjs`)", and a short section: how to prepare the data, that `data/brainweb/` must not be
  committed until BrainWeb grants permission, and the citations. `docs/roadmap.md` backlog: note the BrainWeb option
  and the pending permission.
- [ ] **Step 6: Commit** the five files: "K-space explorer: BrainWeb choice; docs".
