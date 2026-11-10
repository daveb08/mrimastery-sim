// Prepare the BrainWeb subject 04 label volume for the phantom (offline; no dependencies).
//   node tools/prepare-brainweb.mjs
// Downloads subject 04's crisp (discrete) model once into data/brainweb/source/, then writes
// data/brainweb/subject04_labels_1mm.u8.gz and .json. data/brainweb/ is git-ignored: BrainWeb data must not
// be committed or published without BrainWeb's permission.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { LABELS } from "../phantom/phantom.js";
import { BRAINWEB_DIR, BRAINWEB_FILE, mapBrainwebLabel, downsampleMajority } from "../phantom/brainweb.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, BRAINWEB_DIR);
const SRC_DIR = join(OUT_DIR, "source");
const SRC_FILE = join(SRC_DIR, "subject04_crisp.rawb.gz");

const SOURCE_URL = "https://brainweb.bic.mni.mcgill.ca/cgi/brainweb1?do_download_alias=subject04_crisp" +
  "&format_value=raw_byte&zip_value=gnuzip&download_for_real=%5BStart+download%21%5D";

// Source grid: unsigned bytes, x fastest then y then z (BrainWeb data-format page); 0.5 mm voxels;
// RAS world coordinate of voxel (0,0,0)'s centre (MNI space, +x = patient right).
const SRC_DIMS = [362, 434, 362];
const SRC_VOXEL_MM = 0.5;
const SRC_START_RAS = [-90.25, -126.25, -72.25];
const FACTOR = 2;
const AC_AT = [0, 17, 4]; // MNI (0,0,0), the anterior commissure, lands here in our coordinates

const CITATIONS = [
  "C.A. Cocosco, V. Kollokian, R.K.-S. Kwan, A.C. Evans: BrainWeb: Online Interface to a 3D MRI Simulated Brain Database. NeuroImage 5(4) part 2/4, S425, 1997.",
  "R.K.-S. Kwan, A.C. Evans, G.B. Pike: MRI simulation-based evaluation of image-processing and classification methods. IEEE Transactions on Medical Imaging 18(11):1085-97, 1999.",
  "D.L. Collins, A.P. Zijdenbos, V. Kollokian, J.G. Sled, N.J. Kabani, C.J. Holmes, A.C. Evans: Design and Construction of a Realistic Digital Brain Phantom. IEEE Transactions on Medical Imaging 17(3):463-468, 1998.",
  "B. Aubert-Broche, M. Griffin, G.B. Pike, A.C. Evans, D.L. Collins: Twenty new digital brain phantoms for creation of validation image data bases. IEEE Transactions on Medical Imaging 25(11):1410-1416, 2006.",
];

function fail(msg) {
  console.error(`prepare-brainweb: ${msg}`);
  process.exit(1);
}

async function sourceBytes() {
  if (!existsSync(SRC_FILE)) {
    mkdirSync(SRC_DIR, { recursive: true });
    console.log(`Downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) fail(`download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
      fail(`download is not gzip (content-type ${res.headers.get("content-type")}); check the BrainWeb download form`);
    }
    writeFileSync(SRC_FILE, buf);
  } else {
    console.log(`Using cached ${SRC_FILE}`);
  }
  return gunzipSync(readFileSync(SRC_FILE));
}

const src = await sourceBytes();
const [sx, sy, sz] = SRC_DIMS;
if (src.length !== sx * sy * sz) {
  fail(`decompressed ${src.length} bytes, expected ${sx}x${sy}x${sz} = ${sx * sy * sz}; the source grid differs`);
}

// Map classes and mirror x (RAS +x = patient right; ours +x = patient left).
const mirrored = new Uint8Array(src.length);
for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
  const row = sx * (y + sy * z);
  for (let x = 0; x < sx; x++) mirrored[row + (sx - 1 - x)] = mapBrainwebLabel(src[row + x]);
}
const { data, dims } = downsampleMajority(mirrored, SRC_DIMS, FACTOR);

// Centre of output voxel (0,0,0) in MNI mm with our x sense. Mirrored source voxel i' sits at
// x = -(start + (n-1-i')*v); a block of FACTOR source voxels is centred at the mean of their centres.
const mniStart = [
  -(SRC_START_RAS[0] + (sx - 1) * SRC_VOXEL_MM) + (FACTOR - 1) * SRC_VOXEL_MM / 2,
  SRC_START_RAS[1] + (FACTOR - 1) * SRC_VOXEL_MM / 2,
  SRC_START_RAS[2] + (FACTOR - 1) * SRC_VOXEL_MM / 2,
];
const origin = mniStart.map((v, a) => v + AC_AT[a]);

const meta = {
  dims,
  voxelMm: SRC_VOXEL_MM * FACTOR,
  origin,
  orientation: "x=left,y=anterior,z=superior",
  labels: LABELS,
  source: {
    url: SOURCE_URL,
    model: "BrainWeb 20 normal anatomical models, subject 04, discrete (crisp) model",
    grid: { dims: SRC_DIMS, voxelMm: SRC_VOXEL_MM, startRas: SRC_START_RAS, order: "x fastest, then y, then z" },
    processing: `classes mapped to our labels, x mirrored (RAS to patient-left +x), ${FACTOR}x majority downsampling`,
  },
  acPlacedAt: AC_AT,
  citations: CITATIONS,
  note: "Not for redistribution without BrainWeb's permission",
};

const gz = gzipSync(data, { level: 9 });
writeFileSync(join(OUT_DIR, `${BRAINWEB_FILE}.u8.gz`), gz);
writeFileSync(join(OUT_DIR, `${BRAINWEB_FILE}.json`), JSON.stringify(meta, null, 2) + "\n");

const counts = {};
for (const name of Object.keys(LABELS)) counts[name] = 0;
const names = Object.fromEntries(Object.entries(LABELS).map(([n, v]) => [v, n]));
for (const v of data) counts[names[v]]++;
console.log(`dims ${dims.join(" ")}`);
console.log(`origin ${origin.join(" ")} mm`);
console.log(`${BRAINWEB_FILE}.u8.gz: ${(gz.length / 1e6).toFixed(2)} MB (${gz.length} bytes)`);
console.log("label counts:", counts);
