// Prepare the Colin27 (2008, high resolution) discrete tissue model for the phantom (offline; no dependencies).
//   node tools/prepare-colin27.mjs [voxel mm: 1 or 0.5] [path to mni_colin27_2008_nifti.zip]
// Downloads the NIfTI archive once (291 MB) into data/colin27-source/ (git-ignored) unless a path is given, reads the
// discrete classification volume from it, and writes data/colin27/colin27_labels_<res>.u8.gz and .json.
//
// Source: "Colin 27 Average Brain, Stereotaxic Registration Model, high-resolution version 2008",
// https://nist.mni.mcgill.ca/colin-27-average-brain-2008/ . One normal adult scanned repeatedly; tissue classes from
// Aubert-Broche, Evans and Collins (2006). Licence (see data/colin27/LICENSE): use, copy, modify and distribute for any
// purpose, provided the copyright notice appears in all copies.
import { existsSync, mkdirSync, openSync, readSync, fstatSync, closeSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync, inflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LABELS } from "../phantom/phantom.js";
import { COLIN27_DIR, colin27File, mapColin27Label, COLIN27_CITATIONS, COLIN27_COPYRIGHT } from "../phantom/colin27.js";
import { downsampleMajority } from "../phantom/brainweb.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, COLIN27_DIR);
const SRC_DIR = join(ROOT, "data", "colin27-source");
const SOURCE_URL = "https://packages.bic.mni.mcgill.ca/mni-models/colin27/mni_colin27_2008_nifti.zip";
const AC_AT = [0, 17, 4]; // MNI (0,0,0), the anterior commissure, lands here in our coordinates

const voxelMm = Number(process.argv[2] ?? 1);
if (voxelMm !== 1 && voxelMm !== 0.5) fail("voxel size must be 1 or 0.5");
let zipPath = process.argv[3];

function fail(msg) { console.error(`prepare-colin27: ${msg}`); process.exit(1); }

if (!zipPath) {
  zipPath = join(SRC_DIR, "mni_colin27_2008_nifti.zip");
  if (!existsSync(zipPath)) {
    mkdirSync(SRC_DIR, { recursive: true });
    console.log(`Downloading ${SOURCE_URL} (291 MB)`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) fail(`download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  }
}

// ---- minimal zip reader: the central directory, then one stored or deflated entry ----
function readAt(fd, pos, len) { const b = Buffer.alloc(len); readSync(fd, b, 0, len, pos); return b; }
function zipEntries(fd) {
  const size = fstatSync(fd).size, tailLen = Math.min(size, 65557), tail = readAt(fd, size - tailLen, tailLen);
  const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) fail("not a zip file");
  const count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdPos = tail.readUInt32LE(e + 16);
  const cd = readAt(fd, cdPos, cdSize), out = [];
  for (let p = 0, i = 0; i < count; i++) {
    const nameLen = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32);
    out.push({ name: cd.toString("utf8", p + 46, p + 46 + nameLen), method: cd.readUInt16LE(p + 10),
      packed: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), at: cd.readUInt32LE(p + 42) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
function zipRead(fd, entry) {
  const h = readAt(fd, entry.at, 30), start = entry.at + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  const raw = readAt(fd, start, entry.packed);
  return entry.method === 0 ? raw : inflateRawSync(raw);
}

const fd = openSync(zipPath, "r");
const entries = zipEntries(fd);
console.log("archive:", entries.map((e) => `${e.name} (${(e.size / 1e6).toFixed(0)} MB)`).join(", "));
const entry = entries.find((e) => /cls/i.test(e.name) && /\.nii(\.gz)?$/i.test(e.name));
if (!entry) fail("no classification volume (…cls….nii) in the archive");
let nii = zipRead(fd, entry);
closeSync(fd);
if (nii[0] === 0x1f && nii[1] === 0x8b) nii = gunzipSync(nii);

// ---- NIfTI-1 header ----
if (nii.readInt32LE(0) !== 348) fail("not a little-endian NIfTI-1 file");
const dims = [nii.readInt16LE(42), nii.readInt16LE(44), nii.readInt16LE(46)];
const datatype = nii.readInt16LE(70), voxOffset = nii.readFloatLE(108);
const slope = nii.readFloatLE(112) || 1, inter = nii.readFloatLE(116);
const srow = [280, 296, 312].map((o) => [0, 4, 8, 12].map((k) => nii.readFloatLE(o + k)));
if (nii.readInt16LE(254) <= 0) fail("no sform in the NIfTI header");
const step = srow.map((r, a) => r[a]), start = srow.map((r) => r[3]);
if (srow.some((r, a) => r.some((v, b) => b < 3 && b !== a && Math.abs(v) > 1e-6)) || step.some((s) => Math.abs(s - 0.5) > 1e-4)) {
  fail(`unexpected orientation or voxel size: ${JSON.stringify(srow)}`);
}
const [sx, sy, sz] = dims, n = sx * sy * sz;
const read = { 2: (i) => nii[voxOffset + i], 4: (i) => nii.readInt16LE(voxOffset + 2 * i), 512: (i) => nii.readUInt16LE(voxOffset + 2 * i),
  8: (i) => nii.readInt32LE(voxOffset + 4 * i), 16: (i) => nii.readFloatLE(voxOffset + 4 * i), 64: (i) => nii.readDoubleLE(voxOffset + 8 * i) }[datatype];
if (!read) fail(`unsupported NIfTI datatype ${datatype}`);
console.log(`${entry.name}: ${dims.join(" x ")} at ${step.join(", ")} mm, start ${start.join(", ")}, datatype ${datatype}`);

// Map classes and mirror x (world +x = patient right; ours +x = patient left).
const mirrored = new Uint8Array(n), classCounts = {};
for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
  const row = sx * (y + sy * z);
  for (let x = 0; x < sx; x++) {
    const cls = Math.round(read(row + x) * slope + inter);
    classCounts[cls] = (classCounts[cls] ?? 0) + 1;
    mirrored[row + (sx - 1 - x)] = mapColin27Label(cls);
  }
}
console.log("source class counts:", classCounts);

const factor = voxelMm / 0.5;
const { data, dims: outDims } = factor === 1 ? { data: mirrored, dims } : downsampleMajority(mirrored, dims, factor);
// Centre of output voxel (0,0,0) in MNI mm with our x sense: mirrored voxel i' sits at x = -(start + (n-1-i') * step).
const mniStart = [-(start[0] + (sx - 1) * step[0]), start[1], start[2]].map((v) => v + ((factor - 1) * 0.5) / 2);
const origin = mniStart.map((v, a) => v + AC_AT[a]);

const meta = {
  dims: outDims, voxelMm, origin, orientation: "x=left,y=anterior,z=superior", labels: LABELS,
  source: {
    name: "Colin 27 Average Brain, Stereotaxic Registration Model, high-resolution version 2008: discrete tissue classification",
    page: "https://nist.mni.mcgill.ca/colin-27-average-brain-2008/", url: SOURCE_URL, file: entry.name,
    grid: { dims, voxelMm: 0.5, start, order: "x fastest, then y, then z" },
    processing: `classes mapped to the simulator's tissue labels, x mirrored (world +x = right to patient-left +x)`
      + (factor > 1 ? `, ${factor}x majority downsampling` : "") + "; no intensity data kept",
  },
  acPlacedAt: AC_AT, copyright: COLIN27_COPYRIGHT, citations: COLIN27_CITATIONS,
};
mkdirSync(OUT_DIR, { recursive: true });
const gz = gzipSync(data, { level: 9 });
writeFileSync(join(OUT_DIR, `${colin27File(voxelMm)}.u8.gz`), gz);
writeFileSync(join(OUT_DIR, `${colin27File(voxelMm)}.json`), JSON.stringify(meta, null, 2) + "\n");

const counts = Object.fromEntries(Object.keys(LABELS).map((k) => [k, 0]));
const names = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [v, k]));
for (const v of data) counts[names[v]]++;
console.log(`dims ${outDims.join(" ")}, origin ${origin.join(" ")} mm`);
console.log(`${colin27File(voxelMm)}.u8.gz: ${(gz.length / 1e6).toFixed(2)} MB`);
console.log("label counts:", counts);
