// Stored-anatomy phantoms (Colin27, and BrainWeb when its local data is present): label mapping, downsampling, lookup
// and the data loader.
// Volumes are in our orientation (+x patient left, +y anterior, +z superior), index = i + nx*(j + ny*k).
import { LABELS, EXAMPLE_LESIONS_MNI, createPhantom } from "./phantom.js";
import { COLIN27_DIR, COLIN27_FILE } from "./colin27.js";

const { AIR, WM, GM, CSF, FAT, BONE, LESION, MUSCLE } = LABELS;

// BrainWeb class (0..11) -> LABELS.
const CLASS_MAP = [AIR, CSF, GM, WM, FAT, MUSCLE, MUSCLE, BONE, MUSCLE, FAT, MUSCLE, FAT];

export function mapBrainwebLabel(cls) {
  return cls >= 0 && cls < CLASS_MAP.length ? CLASS_MAP[cls] : AIR;
}

// Majority-vote tie priority, first wins.
export const TIE_PRIORITY = [WM, GM, CSF, LESION, FAT, MUSCLE, BONE, AIR];

export function downsampleMajority(src, dims, factor = 2) {
  const [nx, ny, nz] = dims;
  const ox = Math.ceil(nx / factor), oy = Math.ceil(ny / factor), oz = Math.ceil(nz / factor);
  const data = new Uint8Array(ox * oy * oz);
  const counts = new Uint32Array(256);
  for (let k = 0; k < oz; k++) for (let j = 0; j < oy; j++) for (let i = 0; i < ox; i++) {
    counts.fill(0);
    const z1 = Math.min((k + 1) * factor, nz), y1 = Math.min((j + 1) * factor, ny), x1 = Math.min((i + 1) * factor, nx);
    for (let z = k * factor; z < z1; z++) for (let y = j * factor; y < y1; y++) for (let x = i * factor; x < x1; x++) {
      counts[src[x + nx * (y + ny * z)]]++;
    }
    let best = AIR, bestCount = -1;
    for (const label of TIE_PRIORITY) {
      if (counts[label] > bestCount) { best = label; bestCount = counts[label]; }
    }
    data[i + ox * (j + oy * k)] = best;
  }
  return { data, dims: [ox, oy, oz] };
}

// A phantom that looks up a stored label volume (nearest voxel). The example lesions replace white matter only.
export function atlasPhantom(volume, meta, { lesions = false, source = "brainweb" } = {}) {
  const [nx, ny, nz] = meta.dims;
  const { voxelMm, origin } = meta;
  // MNI (0,0,0) sits at our (0,17,4); MNI-style lesion coordinates already use our x sense. True size.
  const list = lesions
    ? EXAMPLE_LESIONS_MNI.map(([[cx, cy, cz], r]) => [cx, cy + 17, cz + 4, ...r])
    : [];
  const inLesion = (x, y, z) => list.some(([cx, cy, cz, a, b, c]) =>
    ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 + ((z - cz) / c) ** 2 < 1);
  const inv = 1 / voxelMm, [ox, oy, oz] = origin;

  function labelAt(x, y, z) {
    const i = Math.round((x - ox) * inv);
    const j = Math.round((y - oy) * inv);
    const k = Math.round((z - oz) * inv);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return AIR;
    const label = volume[i + nx * (j + ny * k)];
    return label === WM && list.length && inLesion(x, y, z) ? LESION : label;
  }
  return { labelAt, options: { source, lesions } };
}
export const brainwebPhantom = (volume, meta, opts = {}) => atlasPhantom(volume, meta, { ...opts, source: "brainweb" });

// ---- Loader. Colin27 ships with the site. BrainWeb's data is git-ignored (not redistributable yet); pages offer it
// only if it loads. ----
export const BRAINWEB_DIR = "data/brainweb/";
export const BRAINWEB_FILE = "subject04_labels_1mm";
export const ATLASES = {
  colin27: { dir: COLIN27_DIR, file: COLIN27_FILE, title: "Colin27" },
  brainweb: { dir: BRAINWEB_DIR, file: BRAINWEB_FILE, title: "BrainWeb" },
};

const fileUrl = (name, rootUrl, ext) => `${rootUrl}${ATLASES[name].dir}${ATLASES[name].file}${ext}`;

// True only when the atlas's sidecar loads as JSON. Never throws.
export async function atlasAvailable(name, rootUrl, fetchFn = fetch) {
  try {
    if (!ATLASES[name]) return false;
    const res = await fetchFn(fileUrl(name, rootUrl, ".json"));
    if (!res.ok) return false;
    await res.json();
    return true;
  } catch {
    return false;
  }
}
export const brainwebAvailable = (rootUrl, fetchFn = fetch) => atlasAvailable("brainweb", rootUrl, fetchFn);

const loads = new Map(); // name + rootUrl -> Promise<{ volume, meta }>: one download per page life

async function fetchAtlas(name, rootUrl, fetchFn) {
  const title = ATLASES[name].title;
  const metaRes = await fetchFn(fileUrl(name, rootUrl, ".json"));
  if (!metaRes.ok) throw new Error(`${title} sidecar: HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const volRes = await fetchFn(fileUrl(name, rootUrl, ".u8.gz"));
  if (!volRes.ok) throw new Error(`${title} volume: HTTP ${volRes.status}`);
  const stream = volRes.body.pipeThrough(new DecompressionStream("gzip"));
  const volume = new Uint8Array(await new Response(stream).arrayBuffer());
  const expected = meta.dims[0] * meta.dims[1] * meta.dims[2];
  if (volume.length !== expected) throw new Error(`${title} volume: ${volume.length} bytes, expected ${expected}`);
  return { volume, meta };
}

// Memoised per atlas and rootUrl; a failed load is forgotten so the next call retries.
export function loadAtlas(name, rootUrl, fetchFn = fetch) {
  const key = `${name}|${rootUrl}`;
  let p = loads.get(key);
  if (!p) {
    p = fetchAtlas(name, rootUrl, fetchFn);
    loads.set(key, p);
    p.catch(() => { if (loads.get(key) === p) loads.delete(key); });
  }
  return p;
}
export const loadBrainweb = (rootUrl, fetchFn = fetch) => loadAtlas("brainweb", rootUrl, fetchFn);

export async function makePhantom(name, { rootUrl, lesions = false, seed = 1, sulcalDepthMm = 14, fetchFn } = {}) {
  if (ATLASES[name]) {
    const { volume, meta } = await loadAtlas(name, rootUrl, fetchFn);
    return atlasPhantom(volume, meta, { lesions, source: name });
  }
  return createPhantom({ seed, sulcalDepthMm, lesions });
}
