import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { LABELS } from "./phantom.js";
import { mapColin27Label, COLIN27_DIR, COLIN27_FILE, COLIN27_COPYRIGHT, COLIN27_CITATIONS } from "./colin27.js";
import { atlasAvailable, loadAtlas, makePhantom, ATLASES } from "./brainweb.js";

const { AIR, WM, GM, CSF, FAT, BONE, MUSCLE } = LABELS;

test("every Colin27 class maps to a supported tissue label", () => {
  const expected = [AIR, CSF, GM, WM, FAT, MUSCLE, MUSCLE, BONE, AIR, FAT, MUSCLE, FAT, MUSCLE];
  expected.forEach((e, cls) => assert.equal(mapColin27Label(cls), e, `class ${cls}`));
  assert.equal(mapColin27Label(13), AIR);
  assert.equal(mapColin27Label(-1), AIR);
});

test("the Colin27 data location, copyright notice and citations", () => {
  assert.equal(COLIN27_DIR, "data/colin27/");
  assert.match(COLIN27_FILE, /^colin27_labels_(1|0\.5)mm$/);
  assert.match(COLIN27_COPYRIGHT, /Copyright \(C\) 1993-2009 Louis Collins/);
  assert.equal(COLIN27_CITATIONS.length, 2);
  assert.deepEqual(Object.keys(ATLASES), ["colin27", "brainweb"]);
});

const META = { dims: [2, 2, 2], voxelMm: 1, origin: [0, 0, 0] };
const VOL = new Uint8Array([AIR, WM, GM, CSF, FAT, BONE, MUSCLE, WM]);
function fakeFetch() {
  const seen = [];
  const fn = async (url) => {
    seen.push(url);
    if (!url.includes("data/colin27/")) return new Response("not found", { status: 404 });
    if (url.endsWith(".json")) return new Response(JSON.stringify(META), { status: 200 });
    return new Response(gzipSync(VOL), { status: 200 });
  };
  fn.seen = seen;
  return fn;
}

test("atlasAvailable asks for the named atlas's sidecar and never throws", async () => {
  const f = fakeFetch();
  assert.equal(await atlasAvailable("colin27", "../", f), true);
  assert.deepEqual(f.seen, [`../data/colin27/${COLIN27_FILE}.json`]);
  assert.equal(await atlasAvailable("brainweb", "../", f), false);
  assert.equal(await atlasAvailable("colin27", "x/", async () => { throw new TypeError("network"); }), false);
  assert.equal(await atlasAvailable("nonsense", "../", f), false);
});

test("loadAtlas downloads each atlas once", async () => {
  const f = fakeFetch();
  const a = await loadAtlas("colin27", "c1/", f), b = await loadAtlas("colin27", "c1/", f);
  assert.equal(a.volume, b.volume);
  assert.deepEqual([...a.volume], [...VOL]);
  assert.equal(f.seen.filter((u) => u.endsWith(".u8.gz")).length, 1);
});

test('makePhantom("colin27") samples the loaded volume and names its source', async () => {
  const p = await makePhantom("colin27", { rootUrl: "c2/", fetchFn: fakeFetch() });
  assert.equal(p.labelAt(1, 0, 0), WM);
  assert.equal(p.labelAt(0, 1, 0), GM);
  assert.equal(p.labelAt(9, 9, 9), AIR);
  assert.deepEqual(p.options, { source: "colin27", lesions: false });
});
