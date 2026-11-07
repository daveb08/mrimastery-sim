// BrainWeb anatomy phantom core: label mapping, downsampling and lookup. No I/O.
// Volumes are in our orientation (+x patient left, +y anterior, +z superior), index = i + nx*(j + ny*k).
import { LABELS, EXAMPLE_LESIONS_MNI } from "./phantom.js";

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

export function brainwebPhantom(volume, meta, { lesions = false } = {}) {
  const [nx, ny, nz] = meta.dims;
  const { voxelMm, origin } = meta;
  // MNI (0,0,0) sits at our (0,17,4); MNI-style lesion coordinates already use our x sense. True size.
  const list = lesions
    ? EXAMPLE_LESIONS_MNI.map(([[cx, cy, cz], r]) => [cx, cy + 17, cz + 4, ...r])
    : [];
  const inLesion = (x, y, z) => list.some(([cx, cy, cz, a, b, c]) =>
    ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 + ((z - cz) / c) ** 2 < 1);

  function labelAt(x, y, z) {
    const i = Math.round((x - origin[0]) / voxelMm);
    const j = Math.round((y - origin[1]) / voxelMm);
    const k = Math.round((z - origin[2]) / voxelMm);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return AIR;
    const label = volume[i + nx * (j + ny * k)];
    return label === WM && list.length && inLesion(x, y, z) ? LESION : label;
  }
  return { labelAt, options: { source: "brainweb", lesions } };
}
