# BrainWeb phantom option: design

Agreed with the project owner on 2026-11-07. Branch `brainweb`, from `main` at 4b7cb47.

## Intent

Students should be able to see the simulated images on **recognisable brain anatomy**. The procedural ("generated")
phantom is stylised. BrainWeb's subject 04 is a segmentation of a real head, so a technologist sees anatomy they
know. The generated phantom stays the default. BrainWeb is an extra choice and must not change anything for users
who never pick it.

## Licence constraint (governs the whole design)

BrainWeb (https://brainweb.bic.mni.mcgill.ca/brainweb/) publishes no licence; it asks only for citations.
Redistribution is not addressed. The site's repository is public and GitHub Pages serves it, so **committing a
BrainWeb-derived file anywhere on GitHub publishes it**. On 2026-11-07 the owner chose to ask BrainWeb for permission
(email drafted, covering the free simulators now and a future paid part of the site) and to build meanwhile against
a local copy. BrainWeb's server sends no CORS headers, so the browser cannot fetch from it at run time.

Therefore:
- The data file lives in a git-ignored folder, `data/brainweb/` (add it to `.gitignore`). It is never committed until
  the owner reports permission.
- Each page offers BrainWeb **only if the data file loads**. Without it (as on the live site and in CI) the pages look
  and behave exactly as today. The code can therefore merge and go live before permission without exposing data.
- When permission arrives, committing the file (and removing it from `.gitignore`) switches the option on.

## Goals

- A "Phantom: Generated / BrainWeb" choice on three pages: contrast simulator (`contrast/`), phantom viewer
  (`phantom/`), k-space explorer (`kspace/`). Default Generated.
- BrainWeb anatomy appears through the existing seam: every consumer calls `phantom.labelAt(x, y, z)` (mm). A
  BrainWeb phantom is an object with the same `labelAt`, backed by a stored 1 mm label volume. Physics, cross-talk,
  multi-slice, k-space, window/level and planning lines are unchanged.
- A credit line wherever BrainWeb is shown: "Anatomy: BrainWeb (McGill), subject 04", linking to the BrainWeb site,
  with the citations (below) in the page's notes.
- An offline preparation script in `tools/` that downloads subject 04's discrete (crisp) model from BrainWeb,
  converts it, and writes the label file into `data/brainweb/`. The script is committed; its output is not.

## Non-goals

- Fuzzy (partial-volume) models. Hard labels only; recognisable anatomy is the goal.
- Other BrainWeb subjects, or BrainWeb's MS-lesion models.
- Publishing the data before permission.
- An OpenNeuro or other real-subject phantom (roadmap backlog; the fallback if BrainWeb refuses).

## Anti-goals

- Any change to what users of the generated phantom see, or to the golden physics tests.
- A broken or empty option on the live site when the file is absent.
- A new runtime dependency or a build step (the site is static, no framework).

## Approaches

1. **Stored label volume behind `labelAt` (chosen).** Nearest-voxel lookup in a 1 mm volume. It slots into the
   existing seam, so every page gets it for one loader.
2. Pre-rendered BrainWeb images. Rejected: slice position, plane and field of view would be fixed, removing the
   interactivity.
3. Fetch from BrainWeb in the browser at run time. Rejected: their server sends no CORS headers.

## Decided details

- **Data:** BrainWeb 20-normal-models subject 04, discrete (crisp) model, resampled to 1 mm isotropic by majority
  vote of the source voxels (the source is 0.5 mm; the builder confirms the grid, value encoding and origin from
  BrainWeb's documentation or file header). Store one byte per voxel already mapped to our labels, gzip-compressed,
  as `data/brainweb/subject04_labels_1mm.u8.gz`, plus a small JSON sidecar
  (`subject04_labels_1mm.json`: dimensions, voxel size, origin in our coordinates, label map used, source and
  citations). The browser decompresses with the native `DecompressionStream("gzip")`.
- **Label mapping** (BrainWeb crisp class → our `LABELS`):
  0 background → AIR; 1 CSF → CSF; 2 grey matter → GM; 3 white matter → WM; 4 fat → FAT; 5 muscle → MUSCLE;
  6 muscle/skin → MUSCLE; 7 skull → BONE; 8 vessels → MUSCLE (we have no blood label; owner's call is "soft tissue
  for now"); 9 around fat → FAT; 10 dura → MUSCLE; 11 bone marrow → FAT.
- **Coordinates:** our phantom uses mm with +x = patient LEFT, +y = anterior, +z = superior. MNI/BrainWeb use RAS
  (+x = patient RIGHT), so **x is mirrored**. BrainWeb is drawn at true size (1 mm = 1 mm; the generated phantom's
  0.94 × MNI scale applies only to the generated anatomy), translated so BrainWeb's anterior commissure lands on the
  generated phantom's (0, 17, 4) mm. That keeps the default slice positions and field of view sensible for both.
  Outside the volume `labelAt` returns AIR.
- **Lesions:** "Show example lesions" paints the generated phantom's lesion ellipsoids into BrainWeb **white matter
  only** (a lesion voxel becomes LESION only where BrainWeb has WM). The generated lesion geometry is exposed for
  this rather than duplicated.
- **Controls that do not apply to BrainWeb** (anatomy seed, sulcal depth) are disabled while BrainWeb is selected.
- **Loading:** the data loads only when BrainWeb is first selected (cached for the page's life), with a short
  "Loading BrainWeb anatomy…" state; until then nothing extra is downloaded. Availability is checked on page load
  with a lightweight request for the JSON sidecar; if it fails, the choice is not shown.
- **Code layout:** a DOM-free module `phantom/brainweb.js` with:
  `brainwebPhantom(volume, meta, { lesions })` → `{ labelAt(x, y, z) }`,
  `mapBrainwebLabel(cls)` → our label, and
  `loadBrainweb(baseUrl)` → Promise of `{ volume: Uint8Array, meta }` (the only part that touches `fetch`).
  Tests in `phantom/brainweb.test.js` use a tiny synthetic volume, not BrainWeb data.
- **Citations** (from BrainWeb's own pages): Cocosco et al., NeuroImage 5(4) S425, 1997; Kwan, Evans & Pike,
  IEEE TMI 18(11):1085–97, 1999; Collins et al., IEEE TMI 17(3):463–8, 1998; Aubert-Broche, Griffin, Pike, Evans &
  Collins, "Twenty new digital brain phantoms for creation of validation image data bases", IEEE TMI 2006 (builder
  checks the final publication details).

## Testing

- Unit tests (no BrainWeb data): label mapping for all 12 classes; `labelAt` x-mirroring, translation, true-size
  scale and AIR outside the volume; lesion painting only over WM; loader round-trip of a tiny gzipped fixture.
- Smoke (`tools/smoke.mjs`): with no data file (CI, live site) each of the three pages shows no BrainWeb choice and
  is otherwise unchanged. When the file is present locally, the smoke selects BrainWeb on each page and checks that
  images draw and the credit line is visible.
- All existing tests and golden values unchanged.

## Calls made after the builder check (designer's calls, not the owner's)

1. **Missing file must not fail the smoke test.** The availability probe (sidecar request) returns 404 wherever the
   data is absent. `tools/smoke.mjs` treats HTTP ≥ 400 and console errors as failures, so it gains a narrow allowance:
   a 404 (and the browser's matching "Failed to load resource" console message) for URLs under `data/brainweb/` is
   not a problem. Nothing else is relaxed.
2. **k-space explorer:** switching phantom rebuilds the scan exactly as changing any other setting does (the
   module-level phantom becomes reassignable). The choice is carried in the explorer's URL settings (key `phantom`,
   values `generated` | `brainweb`), and the contrast page's "Open in k-space explorer" link passes it on. If BrainWeb
   is requested but unavailable, the explorer falls back to Generated.
3. **Lesions:** the k-space explorer has no lesion control, so BrainWeb there has none. On the contrast page and the
   phantom viewer, toggling lesions rebuilds the BrainWeb phantom from the cached volume; it never re-downloads.
4. **Head extent:** BrainWeb covers the head down to about the skull base and upper neck. Below that `labelAt`
   returns AIR, so sagittal and coronal views show the head cut off there. This is accepted; no field-of-view or
   slider ranges change. The credit note says "BrainWeb covers the head down to about the skull base."
5. **Majority vote** is taken on the **mapped** labels (so merged classes vote together). Ties go to the first label
   in this order: WM, GM, CSF, LESION (unused here), FAT, MUSCLE, BONE, AIR, so brain tissue wins at boundaries.
6. **Lesion positions** are transformed to the same **anatomical** locations in BrainWeb: generated-phantom
   coordinates → MNI (the generated phantom's own mapping, inverted) → BrainWeb coordinates. They are then painted
   over BrainWeb WM only.
7. **Load failure** after a successful probe (corrupt file, no `DecompressionStream`): the page reverts to
   Generated and shows a short message, "BrainWeb anatomy could not be loaded".

## Left to the builder

- The exact BrainWeb download request and file format handling in the preparation script (Node, no new
  dependencies, preferred; it may fetch with the same form parameters BrainWeb's download page uses).
- Where the Phantom choice sits on each page and its exact wording, matching each page's existing controls.
- How the anterior commissure position in BrainWeb is determined (BrainWeb documentation, or MNI (0, 0, 0) if the
  model is in MNI space; state the source in the JSON sidecar).
