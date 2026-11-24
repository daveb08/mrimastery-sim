// Cuts the home page's showcase slice out of the Colin27 head, so the home page loads about 20 kB instead of the
// 2.4 MB volume. One axial slice (z = 22 mm, the lateral ventricles and deep grey matter), exactly as scanned (no
// example lesions), sampled exactly as the phantom viewer does (sliceLabels, 250 mm field of view, view centre [0, 8]) at two matrices:
// 256 x 256 for the contrast slide and 128 x 128 for the k-space slide, stored one after the other.
//
//   node tools/prepare-home-slice.mjs
//
// Writes data/colin27/home-axial-slice.u8.gz and its .json sidecar. Rerun if the Colin27 labels or the phantom's
// sampling change. The output is derived from Colin27, so it lives beside data/colin27/LICENSE.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { atlasPhantom } from "../phantom/brainweb.js";
import { sliceLabels } from "../phantom/phantom.js";
import { COLIN27_FILE } from "../phantom/colin27.js";

const DIR = fileURLToPath(new URL("../data/colin27/", import.meta.url));
const SLICE = { plane: "axial", positionMm: 22, fovMm: 250, center: [0, 8], sizes: [256, 128], lesions: false };

const meta = JSON.parse(readFileSync(DIR + COLIN27_FILE + ".json", "utf8"));
const volume = new Uint8Array(gunzipSync(readFileSync(DIR + COLIN27_FILE + ".u8.gz")));
const phantom = atlasPhantom(volume, meta, { lesions: SLICE.lesions, source: "colin27" });
const parts = SLICE.sizes.map((n) => sliceLabels(phantom, SLICE.plane, SLICE.positionMm, n, SLICE.fovMm, SLICE.center));
const bytes = Buffer.concat(parts.map((p) => Buffer.from(p)));

writeFileSync(DIR + "home-axial-slice.u8.gz", gzipSync(bytes, { level: 9 }));
writeFileSync(DIR + "home-axial-slice.json", JSON.stringify({
  ...SLICE,
  layout: "label bytes (phantom LABELS values), row-major, the 256 x 256 slice then the 128 x 128 slice",
  derivedFrom: COLIN27_FILE + ".u8.gz",
  made: "tools/prepare-home-slice.mjs",
}, null, 2) + "\n");
console.log(`wrote home-axial-slice.u8.gz: ${bytes.length} label bytes`);
