import test from "node:test";
import assert from "node:assert/strict";
import { LABELS, EXAMPLE_LESIONS_MNI } from "./phantom.js";
import { mapBrainwebLabel, TIE_PRIORITY, downsampleMajority, brainwebPhantom } from "./brainweb.js";

const { AIR, WM, GM, CSF, FAT, BONE, LESION, MUSCLE } = LABELS;

test("mapBrainwebLabel maps all 12 classes", () => {
  const expected = [AIR, CSF, GM, WM, FAT, MUSCLE, MUSCLE, BONE, MUSCLE, FAT, MUSCLE, FAT];
  expected.forEach((e, cls) => assert.equal(mapBrainwebLabel(cls), e, `class ${cls}`));
  assert.equal(mapBrainwebLabel(12), AIR);
});

test("TIE_PRIORITY order", () => {
  assert.deepEqual(TIE_PRIORITY, [WM, GM, CSF, LESION, FAT, MUSCLE, BONE, AIR]);
});

test("downsampleMajority takes the majority", () => {
  const src = new Uint8Array([GM, GM, GM, GM, GM, GM, WM, WM]);
  const out = downsampleMajority(src, [2, 2, 2]);
  assert.deepEqual(out.dims, [1, 1, 1]);
  assert.equal(out.data[0], GM);
});

test("downsampleMajority breaks ties by priority", () => {
  assert.equal(downsampleMajority(new Uint8Array([WM, WM, WM, WM, CSF, CSF, CSF, CSF]), [2, 2, 2]).data[0], WM);
  assert.equal(downsampleMajority(new Uint8Array([AIR, FAT, AIR, FAT, AIR, FAT, AIR, FAT]), [2, 2, 2]).data[0], FAT);
});

test("downsampleMajority output dims", () => {
  assert.deepEqual(downsampleMajority(new Uint8Array(4 * 6 * 2), [4, 6, 2]).dims, [2, 3, 1]);
  const r = downsampleMajority(new Uint8Array(5 * 4 * 4), [5, 4, 4]);
  assert.deepEqual(r.dims, [3, 2, 2]);
  assert.equal(r.data.length, 12);
});

test("downsampleMajority uses partial trailing blocks", () => {
  // dims [3,1,1]: second output voxel is the single trailing voxel.
  const r = downsampleMajority(new Uint8Array([GM, GM, WM]), [3, 1, 1]);
  assert.deepEqual([...r.data], [GM, WM]);
});

function vol(dims, fill) {
  return new Uint8Array(dims[0] * dims[1] * dims[2]).fill(fill);
}

test("brainwebPhantom looks up the nearest voxel", () => {
  const v = vol([3, 3, 3], AIR);
  v[2 + 3 * (1 + 3 * 1)] = WM;
  const p = brainwebPhantom(v, { dims: [3, 3, 3], voxelMm: 1, origin: [-1, -1, -1] });
  assert.deepEqual(p.options, { source: "brainweb", lesions: false });
  assert.equal(p.labelAt(1, 0, 0), WM);
  assert.equal(p.labelAt(0.6, 0, 0), WM);
  assert.equal(p.labelAt(-1, 0, 0), AIR);
});

test("brainwebPhantom is AIR outside the volume", () => {
  const p = brainwebPhantom(vol([3, 3, 3], WM), { dims: [3, 3, 3], voxelMm: 1, origin: [-1, -1, -1] });
  assert.equal(p.labelAt(5, 0, 0), AIR);
  assert.equal(p.labelAt(-1.6, 0, 0), AIR);
  assert.equal(p.labelAt(0, 0, 0), WM);
});

test("lesions paint WM only", () => {
  const [[cx, cy, cz]] = EXAMPLE_LESIONS_MNI[0];
  const pt = [cx, cy + 17, cz + 4];
  const meta = { dims: [80, 80, 80], voxelMm: 1, origin: [-40, -20, -20] };
  const wm = vol(meta.dims, WM);
  assert.equal(brainwebPhantom(wm, meta, { lesions: true }).labelAt(...pt), LESION);
  assert.equal(brainwebPhantom(wm, meta, { lesions: false }).labelAt(...pt), WM);
  assert.equal(brainwebPhantom(vol(meta.dims, GM), meta, { lesions: true }).labelAt(...pt), GM);
});

// ---- loader (Task 2) ----
import { gzipSync } from "node:zlib";
import { createPhantom } from "./phantom.js";
import { BRAINWEB_DIR, BRAINWEB_FILE, brainwebAvailable, loadBrainweb, makePhantom } from "./brainweb.js";

const FIX_META = { dims: [2, 2, 2], voxelMm: 1, origin: [0, 0, 0] };
const FIX_VOL = new Uint8Array([AIR, WM, GM, CSF, FAT, BONE, MUSCLE, WM]);

// Fake fetch serving a sidecar and a gzipped volume under rootUrl; records requested URLs.
function fakeFetch({ meta = FIX_META, volume = FIX_VOL } = {}) {
  const seen = [];
  const fn = async (url) => {
    seen.push(url);
    if (url.endsWith(".json")) return new Response(JSON.stringify(meta), { status: 200 });
    if (url.endsWith(".u8.gz")) return new Response(gzipSync(volume), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  fn.seen = seen;
  return fn;
}

test("BRAINWEB_DIR and BRAINWEB_FILE", () => {
  assert.equal(BRAINWEB_DIR, "data/brainweb/");
  assert.equal(BRAINWEB_FILE, "subject04_labels_1mm");
});

test("brainwebAvailable is false for 404, bad JSON or a network error, true for a good sidecar", async () => {
  assert.equal(await brainwebAvailable("r404/", async () => new Response("no", { status: 404 })), false);
  assert.equal(await brainwebAvailable("rbad/", async () => new Response("{not json", { status: 200 })), false);
  assert.equal(await brainwebAvailable("rnet/", async () => { throw new TypeError("network"); }), false);
  const f = fakeFetch();
  assert.equal(await brainwebAvailable("../", f), true);
  assert.deepEqual(f.seen, ["../data/brainweb/subject04_labels_1mm.json"]);
});

test("loadBrainweb returns the volume and meta", async () => {
  const { volume, meta } = await loadBrainweb("rt/", fakeFetch());
  assert.ok(volume instanceof Uint8Array);
  assert.deepEqual([...volume], [...FIX_VOL]);
  assert.deepEqual(meta.dims, [2, 2, 2]);
});

test("loadBrainweb downloads once", async () => {
  const f = fakeFetch();
  const a = await loadBrainweb("once/", f);
  const b = await loadBrainweb("once/", f);
  assert.equal(a.volume, b.volume);
  assert.equal(f.seen.filter((u) => u.endsWith(".u8.gz")).length, 1);
});

test("loadBrainweb rejects a wrong-size volume and retries next time", async () => {
  const bad = fakeFetch({ volume: new Uint8Array(7) });
  await assert.rejects(loadBrainweb("retry/", bad));
  const good = fakeFetch();
  const { volume } = await loadBrainweb("retry/", good);
  assert.equal(volume.length, 8);
  assert.equal(good.seen.filter((u) => u.endsWith(".u8.gz")).length, 1);
});

test('makePhantom("generated") matches createPhantom', async () => {
  const p = await makePhantom("generated");
  assert.equal(p.labelAt(0, 17, 30), createPhantom().labelAt(0, 17, 30));
});

test('makePhantom("brainweb") uses the loaded volume', async () => {
  const p = await makePhantom("brainweb", { rootUrl: "mk/", fetchFn: fakeFetch() });
  assert.equal(p.labelAt(1, 0, 0), WM);
  assert.equal(p.labelAt(5, 5, 5), AIR);
  assert.equal(p.options.source, "brainweb");
});
