// Procedural 3D head-and-neck phantom. DOM-free; deterministic for a given seed.
//
// The phantom is a function of position, labelAt(x, y, z), so any plane,
// thickness or matrix size is sampled directly: no stored volume, no resampling.
//
// Coordinates are millimetres with the head centred near the origin:
//   +x = patient LEFT, +y = ANTERIOR, +z = SUPERIOR.
// Brain structures are placed from approximate standard-atlas (MNI-style) coordinates, scaled to an average adult
// head: phantom mm = 0.94 x MNI mm, with the anterior commissure at about (0, 17, 4). See mni() below.
//
// Labels: 0 air, 1 white matter, 2 gray matter, 3 CSF (also eye vitreous),
//         4 fat (scalp, marrow, orbital fat), 5 cortical bone, 6 lesion (optional),
//         7 muscle / soft tissue (face, neck).
// The anatomy is stylised, not a segmentation of a real person.

export const LABELS = { AIR: 0, WM: 1, GM: 2, CSF: 3, FAT: 4, BONE: 5, LESION: 6, MUSCLE: 7 };
const { AIR, WM, GM, CSF, FAT, BONE, LESION, MUSCLE } = LABELS;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Improved Perlin gradient noise in 3D; output roughly in [-1, 1].
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const p = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => {
    const u = (h & 15) < 8 ? x : y;
    const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const a = perm[xi] + yi, aa = perm[a] + zi, ab = perm[a + 1] + zi;
    const b = perm[xi + 1] + yi, ba = perm[b] + zi, bb = perm[b + 1] + zi;
    return 1.15 * lerp(
      lerp(lerp(grad(perm[aa], x, y, z), grad(perm[ba], x - 1, y, z), u),
           lerp(grad(perm[ab], x, y - 1, z), grad(perm[bb], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[aa + 1], x, y, z - 1), grad(perm[ba + 1], x - 1, y, z - 1), u),
           lerp(grad(perm[ab + 1], x, y - 1, z - 1), grad(perm[bb + 1], x - 1, y - 1, z - 1), u), v), w);
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, t) => { const u = clamp((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const lerp = (a, b, t) => a + (b - a) * t;

// Approximate signed distance (mm, negative inside) to an axis-aligned ellipsoid.
function sdEllipsoid(x, y, z, a, b, c) {
  const k0 = Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
  if (k0 < 1e-9) return -Math.min(a, b, c);
  const k1 = Math.sqrt((x / (a * a)) ** 2 + (y / (b * b)) ** 2 + (z / (c * c)) ** 2);
  return (k0 * (k0 - 1)) / k1;
}

// Distance (mm, negative inside) to a capsule between two points.
function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / (dx * dx + dy * dy + dz * dz)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy, pz - az - t * dz) - r;
}

// ---- atlas frame ---------------------------------------------------------------------------------------------------
const S = 0.94, OY = 17, OZ = 4;
// An MNI-style point (mm) in phantom coordinates.
const mni = (x, y, z) => [S * x, S * y + OY, S * z + OZ];

// A tube swept through nodes [x, y, z, radius, kz] given in MNI mm: the radius and a vertical squash kz (> 1 flattens,
// < 1 makes it taller) vary linearly along each segment. Returns an approximate signed distance in phantom mm.
function makeTube(nodesMni) {
  return tubeP(nodesMni.map(([x, y, z, r, kz = 1]) => [...mni(x, y, z), S * r, kz]));
}
// The same with nodes in phantom mm.
function tubeP(nodes) {
  const n = nodes.map(([x, y, z, r, kz = 1]) => [x, y, z, r, kz]);
  const segs = [];
  for (let i = 0; i < n.length - 1; i++) {
    const a = n[i], b = n[i + 1], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    segs.push({ a, b, d, l2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1 });
  }
  const pad = Math.max(...n.map((p) => p[3] / Math.min(1, p[4]))) + 2;
  const lo = [0, 1, 2].map((k) => Math.min(...n.map((p) => p[k])) - pad);
  const hi = [0, 1, 2].map((k) => Math.max(...n.map((p) => p[k])) + pad);
  return (x, y, z) => {
    if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) return 99;
    let best = 99;
    for (const { a, b, d, l2 } of segs) {
      const t = clamp(((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / l2, 0, 1);
      const r = lerp(a[3], b[3], t), kz = lerp(a[4], b[4], t);
      const v = Math.hypot(x - a[0] - t * d[0], y - a[1] - t * d[1], (z - a[2] - t * d[2]) * kz) - r;
      if (v < best) best = v;
    }
    return best;
  };
}
// An ellipsoid given by its MNI centre and semi-axes.
function makeEllipsoid([cx, cy, cz], [a, b, c]) {
  return ellP(mni(cx, cy, cz), [S * a, S * b, S * c]);
}
// The same with centre and semi-axes in phantom mm.
function ellP([px, py, pz], [sa, sb, sc]) {
  return (x, y, z) => {
    // far outside: a cheap lower bound is enough (callers only test the sign or small distances)
    if (Math.abs(x - px) > sa + 3 || Math.abs(y - py) > sb + 3 || Math.abs(z - pz) > sc + 3) return 99;
    return sdEllipsoid(x - px, y - py, z - pz, sa, sb, sc);
  };
}

// ---- deep anatomy (left hemisphere, x > 0; evaluated at |x|) ---------------------------------------------------------
// Lateral ventricle: frontal horn, body, atrium, occipital horn, and the temporal horn curving down and forward.
const VENT_MAIN = makeTube([[8, 28, 4, 3, 0.8], [9, 17, 8, 6.5, 0.55], [11, 4, 14, 6, 0.8], [15, -14, 17, 5.5, 1.15],
  [22, -30, 16, 6.5, 1.0], [28, -40, 12, 7.5, 0.9], [26, -56, 7, 4.5, 1.0], [21, -70, 5, 1.5, 1.0]]);
const VENT_TEMPORAL = makeTube([[28, -40, 12, 6, 1.0], [34, -32, 0, 4.5, 1.2], [34, -18, -12, 3.5, 1.4], [31, -6, -19, 1.8, 1.4]]);
const THIRD_VENT = makeEllipsoid([0, -10, 2], [2.1, 14, 10]);
const MONRO = makeTube([[0, -1, 10, 2.2], [8, 1, 14, 2.2]]);
// Deep grey nuclei.
const CAUDATE = makeTube([[16, 15, 7, 6, 0.8], [16, 2, 14, 4.5, 0.9], [19, -14, 19, 3, 1], [25, -30, 17, 2, 1], [31, -38, 8, 1.5, 1]]);
const PUTAMEN = makeEllipsoid([25.5, 2, 1], [5.5, 16, 10]);
const PALLIDUM = makeEllipsoid([19.5, -3, -1], [3.8, 8, 5.5]);
const THALAMUS = makeEllipsoid([11.5, -18, 6], [9.4, 15, 9.5]); // its medial face is the third ventricle's wall
const CLAUSTRUM = makeEllipsoid([33.2, 1, 3], [0.9, 18, 13]);
const HIPPOCAMPUS = makeTube([[25, -9, -20, 4.5, 1.2], [29, -22, -13, 4.5, 1.2], [28, -36, -3, 3.5, 1], [23, -42, 4, 2.5, 1]]);
const AMYGDALA = makeEllipsoid([22, -3, -18], [7, 7, 6.5]);
// Corpus callosum, a midline arch in (y, z): rostrum, genu, body and splenium (centreline and half-thickness, MNI).
const CC = makeTube([[0, 18, -6, 2.5], [0, 28, 0, 4], [0, 32, 9, 5], [0, 25, 19, 4], [0, 8, 23, 3], [0, -12, 24, 3],
  [0, -28, 21, 3.5], [0, -36, 16, 5.5], [0, -40, 9, 6], [0, -36, 4, 4]]);
const CC_HALF_WIDTH = S * 19; // lateral reach of the callosal label before it merges with the hemispheric white matter
// Top of the callosal arch (phantom z) as a function of phantom y; points below it lie under the arch.
const ARCH = [[33, 10], [25, 23], [8, 26.5], [-12, 27.5], [-28, 25], [-36, 21], [-42, 10]].map(([y, z]) => mni(0, y, z).slice(1));
function underArch(y, z) {
  if (y > ARCH[0][0] || y < ARCH[ARCH.length - 1][0]) return false;
  for (let i = 0; i < ARCH.length - 1; i++) {
    const [y0, z0] = ARCH[i], [y1, z1] = ARCH[i + 1];
    if (y <= y0 && y >= y1) return z < lerp(z0, z1, (y0 - y) / (y0 - y1));
  }
  return false;
}
// Brainstem: midbrain with the cerebral peduncles in front of the tectum, the pons bulging forward, the medulla with
// its olives, then the cord. The middle cerebellar peduncles carry the pons into the cerebellar white matter.
const MIDBRAIN = makeTube([[0, -30, 2, 8, 1], [0, -30, -12, 8.5, 1]]);
const PEDUNCLE = makeTube([[7, -16, 4, 4.5, 1], [7, -22, -10, 5, 1]]); // evaluated at |x|
const PONS = makeEllipsoid([0, -28, -27], [15, 12, 11]);
const MEDULLA = makeTube([[0, -34, -36, 8, 1], [0, -38, -48, 6.5, 1], [0, -44, -66, 5.5, 1]]);
const OLIVE = makeEllipsoid([5.5, -32, -44], [3, 3.5, 6]); // evaluated at |x|
const MCP = makeTube([[11, -28, -27, 7, 1], [19, -42, -28, 6.5, 1], [17, -52, -30, 5, 1]]); // evaluated at |x|
const STEM = (x, y, z) => {
  const ax = Math.abs(x);
  return Math.min(MIDBRAIN(x, y, z), PEDUNCLE(ax, y, z), PONS(x, y, z), MEDULLA(x, y, z), OLIVE(ax, y, z));
};
const AQUEDUCT = makeTube([[0, -32, 0, 1.3, 1], [0, -36, -12, 1.3, 1], [0, -40, -20, 1.8, 1]]);
// Fourth ventricle: a tent over the back of the pons, its roof peaking at the fastigium, with lateral recesses.
const FOURTH_VENT = (x, y, z) => Math.min(FOURTH_BODY(x, y, z), FOURTH_RECESS(Math.abs(x), y, z));
const FOURTH_BODY = makeTube([[0, -40, -20, 1.8, 1], [0, -40, -28, 5, 0.8], [0, -47, -27, 1.5, 1], [0, -40, -28, 5, 0.8],
  [0, -40, -38, 3, 1], [0, -42, -45, 1, 1]]);
const FOURTH_RECESS = makeTube([[0, -40, -31, 3, 1], [12, -40, -34, 1.8, 1], [17, -38, -37, 1, 1]]);
const CISTERNA_MAGNA = makeEllipsoid([0, -62, -52], [12, 9, 7]);
const DENTATE = makeEllipsoid([14, -56, -34], [6, 8, 6]); // evaluated at |x|
// Cerebellar fissures fan round a transverse axis through the fastigium; folia arc forward laterally.
const [, CB_Y, CB_Z] = mni(0, -48, -27);
const PRIMARY_STEP = (24 * Math.PI) / 180, FOLIUM_STEP = (4.2 * Math.PI) / 180;
// Sylvian fissure: its lateral sheet rises posteriorly; the insula lies under the opercula at |x| ~ 37 MNI.
const INSULA_X = S * 36;
const insulaX = (e) => INSULA_X + 2.5 * (1 - e); // e: 0 at the insula's centre, 1 at its circular sulcus
const INSULA_C = mni(0, -4, 7).slice(1), INSULA_R = [S * 25, S * 15];
const sylvianZ = (y) => { const m = (y - OY) / S; return S * (-4 + 0.4 * (12 - m)) + OZ; };
const SYLVIAN_C = mni(0, -12, 0)[1], SYLVIAN_HALF = S * 36;

// ---- named sulci ----------------------------------------------------------------------------------------------------
// Distance (mm) from a sulcal sheet whose CSF is hw mm either side of it, running in to depth D, where the cortex wraps
// round its fundus. dSheet: distance from the sheet; depth: below the pial surface it opens onto.
function sheetSulcus(dSheet, depth, D, hw) {
  if (!(D > 0)) return Infinity;
  if (depth <= D) return dSheet - hw * Math.sqrt(1 - (depth / D) ** 2);
  return Math.hypot(dSheet, depth - D);
}
// Central sulcus on the lateral convexity: from near the midline at the vertex, down and forward to just above the
// Sylvian fissure, with the posteriorly bulging "hand knob". Its MNI y as a function of MNI |x|.
const SLOPE_CS = 0.42;
const MEANDER = makeNoise(977); // fixed (not seeded): the named sulci keep their shape for every seed
const centralY = (axm) => -36 + SLOPE_CS * axm - 5 * Math.exp(-(((axm - 36) / 7) ** 2)) + 1.5 * Math.sin(axm / 5);
const CENTRAL = [{ off: 0, D: S * 21 }, { off: 15, D: S * 14 }, { off: -14, D: S * 14 }]; // central, pre-, postcentral
// Medial sulci, as segments in the midsagittal (y, z) plane (MNI): calcarine, parieto-occipital and marginal ramus.
const MEDIAL_SULCI = [
  { pts: [[-102, 6], [-88, 3], [-72, 2], [-60, 4], [-50, 0]], D: S * 17 },
  { pts: [[-58, 4], [-66, 22], [-74, 38], [-80, 50]], D: S * 18 },
  { pts: [[-34, 40], [-40, 56], [-44, 70]], D: S * 12 },
].map(({ pts, D }) => ({ pts: pts.map(([y, z]) => mni(0, y, z).slice(1)), D }));
function segDist2(py, pz, pts) {
  let best = Infinity, along = 0, total = 0, at = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ay, az] = pts[i], [by, bz] = pts[i + 1], dy = by - ay, dz = bz - az, l = Math.hypot(dy, dz);
    const t = clamp(((py - ay) * dy + (pz - az) * dz) / (l * l), 0, 1);
    const d = Math.hypot(py - ay - t * dy, pz - az - t * dz);
    if (d < best) { best = d; at = total + t * l; }
    total += l;
  }
  return [best, at / total]; // distance and the position along the sulcus, 0..1
}

// ---- skull base and tentorium ----------------------------------------------------------------------------------------
// Height of the cranial floor: anterior fossa (orbital roofs either side of a lower cribriform plate), middle fossa
// (deep laterally, the sphenoid body medially), the petrous ridge, and the bowl of the posterior fossa with the clivus.
const sphenoidRidgeY = (ax) => 33 - 0.08 * ax;
const petrousY = (ax) => (ax < 16 ? 6 : 6 - 0.8 * (ax - 16));
function tentoriumZ(ax, y) {
  const h = y > 0 ? -8 : y > -35 ? -8 + (12 * -y) / 35 : y > -75 ? 4 - (10 * (-35 - y)) / 40 : -6 - 0.3 * (-75 - y);
  return h - 0.32 * ax;
}
function skullFloor(x, y, withForamen = true) {
  const ax = Math.abs(x);
  const ant = -15 + 5 * Math.exp(-(((ax - 24) / 12) ** 2)) - 6 * Math.exp(-((ax / 6) ** 2));
  const mid = -38 + 22 * smoothstep(24, 12, ax);
  const clivus = -16 + 1.9 * (y - 6);
  const post = Math.max(-54 + 0.006 * x * x + 0.004 * (y + 52) ** 2, ax < 18 ? clivus : -99);
  const yp = petrousY(ax), ys = sphenoidRidgeY(ax);
  let z = lerp(lerp(post, mid, smoothstep(yp - 3, yp + 3, y)), ant, smoothstep(ys - 3, ys + 3, y));
  if (ax > 16) z = Math.max(z, tentoriumZ(ax, yp) - 2 - 0.12 * (y - yp) ** 2); // petrous ridge
  if (ax < 8 && y > 10 && y < 25) z = Math.min(z, -16 - 8 * Math.sqrt(Math.max(0, 1 - (ax / 8) ** 2 - ((y - 17.5) / 7.5) ** 2))); // sella
  if (withForamen && Math.hypot(x, y + 24) < 11) z = -200; // foramen magnum
  return z;
}

const GRAD = 1.25; // typical |grad(noise)| per lattice unit: converts a noise level to a distance
const R0 = 70;     // radius of the sphere on which the sulcal pattern is defined
const CORTEX = 2.7; // grey-matter thickness (mm) along pial surfaces

// ---- face and neck (phantom mm; bilateral parts are given for the left side and evaluated at |x|) -----------------
// Proportions of an average adult: nasion near z = -24, eyes at -34, palate -70, mouth -86, chin -128, neck cut -150.
function smin(a, b, k) { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }
const BROW = ellP([31, 62, -32], [21, 20, 17]); // eyelids and brow over each eye
const FACE = [ellP([0, 50, -60], [64, 40, 42]), ellP([0, 40, -100], [50, 40, 30]), ellP([0, 70, -117], [22, 14, 13]),
  ellP([0, 92, -86], [24, 6, 8]), (x, y, z) => BROW(Math.abs(x), y, z)]; // midface, lower face and jaw, chin, lips, eyes
const NOSE = tubeP([[0, 84, -28, 4], [0, 98, -50, 7], [0, 103, -60, 8]]);
const ALA = ellP([10, 96, -62], [7, 8, 6]);
const EAR = (ax, y, z) => Math.min(EAR_PLATE(ax, y, z), EAR_CONCHA(ax, y, z));
const EAR_PLATE = ellP([76, -12, -46], [5, 15, 26]), EAR_CONCHA = ellP([67, -8, -48], [10, 9, 9]);
const EAM = tubeP([[58, -8, -48, 3.5], [86, -8, -46, 4]]);
function sdFaceNeck(x, y, z) {
  const ax = Math.abs(x);
  let d = FACE[0](x, y, z);
  for (const f of FACE.slice(1)) d = smin(d, f(x, y, z), 6);
  d = smin(smin(d, NOSE(x, y, z), 9), ALA(ax, y, z), 7); // the nose as a wedge blended into the face
  d = Math.min(d, EAR(ax, y, z));
  // neck: an elliptic column below the skull, cut flat 2 cm below the chin
  const neck = Math.max(sdEllipsoid(x, y + 2, 0, 52, 50, 1e9), z + 20, -150 - z);
  return smin(d, neck, 10);
}
const ORBIT = ellP([30, 56, -34], [18, 26, 17]);
const GLOBE = ellP([31, 66, -34], [12, 12, 12]);
const LENS = ellP([31, 76.5, -34], [4.5, 1.8, 4.5]);
const OPTIC = tubeP([[31, 54, -34, 2.2], [22, 40, -28, 2.2], [13, 30, -24, 2.2]]);
const RECTI = [[31, 62, -21.5], [31, 62, -46.5], [19.5, 62, -34], [42.5, 62, -34]]
  .map((p) => tubeP([[14, 32, -26, 1.6], [...p, 2.2]]));
const MAXILLARY = ellP([29, 56, -62], [13, 15, 11]);
const SPHENOID = ellP([0, 24, -32], [13, 11, 9]);
const FRONTAL_SINUS = ellP([0, 80, -10], [15, 5, 11]);
// inferior, middle and superior turbinates, scrolling in from the lateral wall almost to the septum
const TURBINATES = [tubeP([[10, 90, -62, 5], [10, 48, -61, 5.5]]), tubeP([[8, 84, -49, 4], [8, 50, -47, 4.5]]),
  tubeP([[6, 70, -38, 2.5], [6, 48, -37, 3]])];
const NOSTRIL = tubeP([[6, 94, -62, 3.5], [6, 101, -65, 3], [6, 102, -72, 2.5]]);
const NASOPHARYNX = ellP([0, 30, -62], [15, 11, 8]);
const AIRWAY = tubeP([[0, 24, -66, 7], [0, 19, -90, 7.5], [0, 24, -112, 6], [0, 30, -128, 5.5], [0, 34, -152, 6.5]]);
const ORAL = ellP([0, 62, -77], [20, 22, 2]);
const MANDIBLE = tubeP([[0, 78, -110, 8], [22, 64, -108, 7], [38, 38, -106, 6.5], [46, 6, -102, 6]]);
const RAMUS = ellP([47, 4, -76], [3.5, 12, 28]), CONDYLE = ellP([48, -4, -50], [5, 6, 5]);
const ZYGOMA = tubeP([[44, 62, -44, 4], [50, 40, -46, 3.5], [60, 0, -46, 3]]), ZYG_BODY = ellP([42, 64, -46], [7, 8, 10]);
const PETROUS = tubeP([[16, 2, -28, 6], [34, -8, -34, 9], [50, -20, -40, 8]]);
const INNER_EAR = ellP([33, -8, -34], [4, 3, 3]);
const MASTOID = ellP([54, -20, -56], [9, 12, 13]);
const HYOID = tubeP([[0, 46, -124, 2.5], [16, 36, -124, 2.5], [22, 26, -124, 2]]);
const SCM = tubeP([[54, -22, -60, 6], [38, 10, -110, 7], [14, 40, -150, 6]]);
const PAROTID = ellP([46, -16, -80], [10, 10, 18]), PARAPHARYNGEAL = ellP([22, 20, -80], [5, 10, 14]);
const BUCCAL = ellP([40, 60, -84], [7, 10, 10]), SUBMENTAL = ellP([0, 50, -118], [16, 13, 5]);
const DENS = tubeP([[0, -4, -76, 5], [0, -4, -60, 5]]);
const C1_ANTERIOR = ellP([0, 6, -63], [7, 4, 5]);
const SPINE_LEVELS = [-64, -80, -97.5, -115, -132.5, -150]; // C1 ring, then C2 to C6
// Optic chiasm and nerves inside the skull, and the pituitary in its fossa.
const CHIASM = tubeP([[13, 30, -24, 2.3], [5, 24, -16, 2.3], [0, 21, -14, 2.5]]);

// options: seed (anatomy variation), sulcalDepthMm (0 gives a smooth brain), lesions (bool)
// Example white-matter lesions (MNI-style centre, semi-axes; mm): periventricular, deep and near the cortex.
export const EXAMPLE_LESIONS_MNI = [
  [[-24, 12, 24], [4, 5, 4]], [[22, -6, 28], [3, 3, 3]], [[-30, -30, 26], [5, 4, 4]], [[30, -50, 18], [3.5, 3.5, 3.5]],
  [[-18, 34, 18], [2.5, 2.5, 2.5]], [[-36, 2, 34], [3, 3, 3]],
];

export function createPhantom({ seed = 1, sulcalDepthMm = 14, lesions = false } = {}) {
  const nWarp = makeNoise(seed * 7919 + 1), nA = makeNoise(seed * 7919 + 2);
  const nB = makeNoise(seed * 7919 + 3), nC = makeNoise(seed * 7919 + 4), nCb = makeNoise(seed * 7919 + 5);
  const depthScale = sulcalDepthMm / 14;

  // example white-matter lesions (see EXAMPLE_LESIONS_MNI)
  const lesionList = lesions ? EXAMPLE_LESIONS_MNI.map(([c, r]) => [...mni(...c), ...r.map((v) => S * v)]) : [];
  const inside = (list, x, y, z) => list.some(([cx, cy, cz, a, b, c]) => sdEllipsoid(x - cx, y - cy, z - cz, a, b, c) < 0);

  // Sulci are thin sheets around the zero level of a noise field sampled on a sphere around the
  // brain centre. Because the field depends on direction, not depth, the sheets run radially
  // into the brain like real sulci; each one tapers to nothing at its own depth limit.
  function sulcalDistance(qx, qy, qz, depth, lambda, D, w0, nz, off) {
    if (depth > D + 4) return Infinity;
    const n = nz(qx / lambda + off, qy / lambda + off * 0.7, qz / lambda - off * 0.4);
    const w = w0 * Math.sqrt(Math.max(0, 1 - (depth / D) ** 2)); // rounded fundus
    return (((Math.abs(n) - w) * lambda) / GRAD) * Math.max(0.35, 1 - depth / R0);
  }

  // Cortical sulcus from one octave of noise: the distance (mm) from the sulcal CSF, using the local gradient so
  // that every sulcus has the same width and the grey matter around it the same thickness. The sulcus is a sheet
  // hw mm either side of the noise's zero level, running in to depth D, where the cortex wraps round its fundus.
  // cd: depth below the pial surface. Returns Infinity when too deep to matter.
  function sulcus(qx, qy, qz, cd, lambda, D, nz, off, hw) {
    if (cd > D + CORTEX + 1) return Infinity;
    const u = qx / lambda + off, v = qy / lambda + off * 0.7, w = qz / lambda - off * 0.4, h = 0.2;
    const n = nz(u, v, w);
    const g = Math.hypot(nz(u + h, v, w) - n, nz(u, v + h, w) - n, nz(u, v, w + h) - n) / (h * lambda) + 1e-4;
    const sheet = (Math.abs(n) / g) * Math.max(0.4, 1 - cd / R0);
    if (cd <= D) return sheet - hw * Math.sqrt(1 - (cd / D) ** 2);
    return Math.hypot(sheet, cd - D);
  }

  // Cerebellum: lobules separated by primary fissures, each lobule a fan of folia, with white-matter laminae (the arbor
  // vitae) running from the deep white matter up the middle of each lobule. Angles are measured round a transverse
  // axis through the fastigium; the seed only nudges the fissures.
  const cbJitter = (k) => 0.25 * nCb(k * 1.7, 0.5, 0.5);
  function cerebellumLabel(x, y, z, depth) {
    const ax = Math.abs(x);
    if (FOURTH_VENT(x, y, z) < 0 || CISTERNA_MAGNA(x, y, z) < 0) return CSF;
    if (MCP(ax, y, z) < 0) return WM;
    if (ax < 1.5 && y < mni(0, -76, 0)[1] && z < mni(0, 0, -30)[2]) return CSF; // posterior cerebellar notch
    if (DENTATE(ax, y, z) < 0) return GM;
    const ye = y - 0.011 * x * x; // folia arc forward laterally, round the fourth ventricle
    const dy = ye - CB_Y, dz = z - CB_Z, rho = Math.hypot(dy, dz);
    // fissures are curved surfaces: they undulate and dip laterally rather than lying in planes
    const th = Math.atan2(dz, -dy) - 0.004 * ax + 0.07 * MEANDER(x / 14, y / 18, z / 18);
    // primary fissures, deep: distance along the arc from the nearest one
    const kp = Math.round(th / PRIMARY_STEP), thp = (kp + cbJitter(kp)) * PRIMARY_STEP;
    const dPrimary = rho * Math.abs(th - thp);
    const primary = sheetSulcus(dPrimary, depth, Math.min(16, rho - 10) * depthScale, 0.5);
    if (primary < 0) return CSF;
    // folial sulci, shallow
    // (none close to the fan's axis, where they would crowd together)
    const folium = rho < 24 ? Infinity
      : sheetSulcus(rho * Math.abs(th - Math.round(th / FOLIUM_STEP) * FOLIUM_STEP), depth, 4.5 * depthScale * clamp((rho - 24) / 8, 0, 1), 0.35);
    if (folium < 0) return CSF;
    // white matter: the deep core, and a lamina up the middle of each lobule, thinning towards the surface
    if (depth > 20) return WM;
    if (rho < 18) return depth > 4 ? WM : GM; // central white matter round the fastigium, where the laminae converge
    const thm = thp + (th > thp ? 0.5 : -0.5) * PRIMARY_STEP;
    const lamina = rho * Math.abs(th - thm), half = 0.25 + 1.1 * clamp((depth - 2.5) / 14, 0, 1);
    if (depth > 2.5 && lamina < half) return WM;
    // secondary laminae branch off towards the folia
    const branch = rho * Math.abs(th - thm - Math.sign(th - thm || 1) * 0.25 * PRIMARY_STEP);
    if (depth > 3 && depth < 11 && branch < 0.25 + 0.5 * clamp((depth - 3) / 8, 0, 1)) return WM;
    return GM;
  }

  function cerebrumLabel(x, y, z, depth) {
    const ax = Math.abs(x);
    const third = THIRD_VENT(x, y, z);
    if (third < 0 || MONRO(ax, y, z) < 0) return CSF;
    if (third < 1.5) return GM; // its walls are grey: thalamus above, hypothalamus below
    const arch = underArch(y, z);
    const dcc = CC(0, y, z);
    if (dcc < 0 && ax < CC_HALF_WIDTH) return WM;

    // pial surfaces other than the outer one: the interhemispheric fissure, the callosal and cingulate sulci and the
    // Sylvian fissure with the insula beneath it (distances in mm, negative inside the CSF)
    let pial = depth, medial = Infinity; // medial: depth below the medial surface, beyond the cingulate gyrus
    if (!arch && dcc > 0) {
      const fis = Math.abs(x - 0.8 * Math.sin(y / 17 + z / 23)) - 0.9;
      if (fis < 0) return CSF;
      pial = Math.min(pial, fis);
      if (dcc > S * 15) medial = fis;
      // sulci on the medial surface taper to a rounded fundus at their lateral depth
      if (ax < 7) {
        const cal = Math.abs(dcc - 1.1) - 0.6 * Math.sqrt(1 - (ax / 7) ** 2);
        if (cal < 0) return CSF;
        pial = Math.min(pial, cal);
      }
      if (ax < 16 && y > mni(0, -42, 0)[1] && z > mni(0, 0, -6)[2]) {
        const dm = CC(0, y + 3 * MEANDER(ax / 6, y / 14, z / 14), z + 3 * MEANDER(ax / 6 + 5, y / 14, z / 14));
        const cing = Math.abs(dm - S * 11.5) - 0.75 * Math.sqrt(1 - (ax / 16) ** 2);
        if (cing < 0) return CSF;
        pial = Math.min(pial, cing);
      }
    }
    if (ax > INSULA_X - 6) {
      // the insula: an oval of cortex, bulging laterally at its centre, covered by CSF and the opercula
      let syl = Infinity;
      const e = ((y - INSULA_C[0]) / INSULA_R[0]) ** 2 + ((z - INSULA_C[1]) / INSULA_R[1]) ** 2;
      if (e < 1) syl = Math.abs(ax - insulaX(e)) - 0.8;
      // the Sylvian fissure: a sheet from the insula out to the surface, fading at its ends
      const ey = (y - SYLVIAN_C) / SYLVIAN_HALF;
      if (Math.abs(ey) < 1) {
        const zs = sylvianZ(y) + 1.8 * Math.sin(ax / 6 + y / 13) + 1.2 * Math.sin(y / 5.5);
        const es = ((y - INSULA_C[0]) / INSULA_R[0]) ** 2 + ((zs - INSULA_C[1]) / INSULA_R[1]) ** 2;
        if (ax > insulaX(Math.min(1, es)) - 0.5) syl = Math.min(syl, Math.abs(z - zs) - 0.9 * Math.sqrt(1 - ey * ey));
      }
      if (syl < 0) return CSF;
      pial = Math.min(pial, syl);
    }

    // named sulci: the central region on the convexity, and the calcarine, parieto-occipital and marginal sulci medially
    let named = Infinity, quiet = false;
    if (depthScale > 0) {
      const axm = ax / S, ym = (y - OY) / S;
      if (depth < S * 21 + CORTEX + 1 && axm > 2 && axm < 62 && z > sylvianZ(y) + 3) {
        const u = (axm - 32) / 30, fade = Math.sqrt(Math.max(0, 1 - u ** 4)); // shallow at both ends
        const dy = ym - centralY(axm) - 3.5 * MEANDER(axm / 11, z / 11, 3.7) - 1.5 * MEANDER(axm / 4, z / 4, 8.1);
        quiet = Math.abs(dy) < 21; // no random folds across the pre- and postcentral gyri
        for (const { off, D } of CENTRAL) {
          const d = (Math.abs(dy - off) * S) / Math.hypot(1, SLOPE_CS);
          named = Math.min(named, sheetSulcus(d, depth, D * depthScale * fade, 0.8));
        }
      }
      if (medial < S * 18 + CORTEX + 1) {
        const wy = y + 2.5 * MEANDER(ax / 7, y / 16, z / 16), wz = z + 2.5 * MEANDER(ax / 7 + 5, y / 16, z / 16);
        for (const { pts, D } of MEDIAL_SULCI) {
          const [d, t] = segDist2(wy, wz, pts);
          if (d < 6) quiet = true;
          named = Math.min(named, sheetSulcus(d, medial, D * depthScale * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 6)), 0.8));
        }
      }
      if (named < 0) return CSF;
    }

    let s = Infinity;
    const cortical = Math.min(depth, medial);
    if (depthScale > 0 && !quiet && cortical < 20 * depthScale + CORTEX + 1) {
      let qx, qy, qz;
      if (medial < depth) {
        // medial surface: the pattern lies in the sagittal plane, so the sulci run straight in from the midline
        qx = R0; qy = y; qz = z;
      } else {
        // outer surface: the pattern lies on a sphere round the brain centre, so the sulci run radially inward
        const dx = x / 63.4, dy = (y - 1) / 82.5, dz = (z - 13.5) / 62;
        const L = Math.hypot(dx, dy, dz) || 1;
        qx = (dx / L) * R0; qy = (dy / L) * R0; qz = (dz / L) * R0;
      }
      // Two domain warps make the pattern meander like gyri: one in surface position (curving
      // the sulci along the cortex) and one in 3-D position (bending them as they go deeper).
      const wx = 6 * nWarp(qx / 20, qy / 20, qz / 20), wy = 6 * nWarp(qx / 20 + 9, qy / 20, qz / 20);
      const wz = 6 * nWarp(qx / 20, qy / 20 + 9, qz / 20);
      const ux = 9 * nWarp(x / 24 + 4, y / 24, z / 24), uy = 9 * nWarp(x / 24, y / 24 + 4, z / 24);
      const uz = 9 * nWarp(x / 24, y / 24, z / 24 + 4);
      qx += wx + ux; qy += wy + uy; qz += wz + uz;
      s = Math.min(
        sulcus(qx, qy, qz, cortical, 34, 20 * depthScale, nA, 3.3, 0.7),
        sulcus(qx, qy, qz, cortical, 20, 10 * depthScale, nB, 9.7, 0.55));
    }
    if (s < 0) return CSF;

    // deep grey nuclei carve the ventricles they border (caudate, thalamus, hippocampus)
    if (ax < 36 && y > -40 && y < 50 && z > -30 && z < 32) {
      if (CAUDATE(ax, y, z) < 0 || THALAMUS(ax, y, z) < 0 || PUTAMEN(ax, y, z) < 0 || PALLIDUM(ax, y, z) < 0
        || CLAUSTRUM(ax, y, z) < 0 || HIPPOCAMPUS(ax, y, z) < 0 || AMYGDALA(ax, y, z) < 0) return GM;
    }
    if (VENT_MAIN(ax, y, z) < 0 || VENT_TEMPORAL(ax, y, z) < 0) return CSF;

    if (pial < CORTEX || s < CORTEX || named < CORTEX) return GM;
    if (lesionList.length && inside(lesionList, x, y, z)) return LESION;
    return WM;
  }

  // Everything inside the cranial cavity: brain, CSF spaces and the tentorium between cerebrum and cerebellum.
  function intracranial(x, y, z, sdCranium, floor) {
    const ax = Math.abs(x);
    if (ax < 8 && y > 10 && y < 25 && z < -17) return GM; // pituitary gland, in the sella
    if (z < -8 && y > 15 && y < 36 && ax < 18 && CHIASM(ax, y, z) < 0) return WM; // optic chiasm and nerves
    if (z < 16 && y < 20 && ax < 30) { // brainstem region
      if (AQUEDUCT(x, y, z) < 0 || FOURTH_VENT(x, y, z) < 0) return CSF;
      const stem = STEM(x, y, z);
      if (stem < 0) return WM;
      if (y > CB_Y - 6 && MCP(ax, y, z) < 0) return WM;
      if (stem < 2.5 && z < -8 && y > CB_Y + 4) return CSF; // prepontine and lateral medullary cisterns
    }
    const gap = 1.6 + depthScale * 0.6 * nA(x / 40, y / 40, z / 40); // subarachnoid space
    const toWall = Math.min(-sdCranium - 12, z - floor);
    const posterior = y < petrousY(ax);
    const notch = ax < 12 && y > -22; // the tentorial notch, around the midbrain
    if (posterior && !notch) {
      const zt = tentoriumZ(ax, y);
      // the brain lies close against the tentorium: a thin dural sheet with little CSF either side
      if (z < zt - 0.8) {
        const depth = Math.min(toWall - gap, zt - z - 0.8);
        return depth < 0 ? CSF : cerebellumLabel(x, y, z, depth);
      }
      if (z < zt + 0.8) return CSF;
      const depth = Math.min(toWall - gap, z - zt - 0.8);
      return depth < 0 ? CSF : cerebrumLabel(x, y, z, depth);
    }
    if (notch && posterior && z < tentoriumZ(0, y) - 5) return CSF; // interpeduncular, ambient and quadrigeminal cisterns
    const depth = toWall - gap;
    return depth < 0 ? CSF : cerebrumLabel(x, y, z, depth);
  }

  // Face, skull base and neck below and in front of the cranial cavity.
  function headTissue(x, y, z, sdOuter, floor) {
    const ax = Math.abs(x);
    if (EAR(ax, y, z) < 0) return EAM(ax, y, z) < 0 ? AIR : MUSCLE; // auricle (cartilage and skin), ear canal
    if (sdOuter > -1) return MUSCLE; // skin
    if (EAM(ax, y, z) < 0) return AIR;

    // orbit: globe with lens, optic nerve in its sheath, rectus muscles, fat, bony walls
    const orbit = ORBIT(ax, y, z);
    if (orbit < 1.5 && y < 80) {
      const globe = GLOBE(ax, y, z);
      if (globe < 0) return LENS(ax, y, z) < 0 ? MUSCLE : globe > -0.8 ? MUSCLE : CSF; // sclera round the vitreous
      if (orbit < 0) {
        const nerve = OPTIC(ax, y, z);
        if (nerve < 0) return WM;
        if (nerve < 1.2) return CSF;
        if (RECTI.some((m) => m(ax, y, z) < 0)) return MUSCLE;
        return FAT;
      }
      if (ax > 6 && y < 70) return BONE; // bony walls, open at the front
    }
    if (sdOuter > -4.5) return y > 88 && (NOSE(x, y, z) < 0 || ALA(ax, y, z) < 0) ? MUSCLE : FAT; // subcutaneous fat; nasal cartilage

    // air: sinuses, nasal cavity, nasopharynx, mouth, pharynx, larynx and trachea
    const maxillary = MAXILLARY(ax, y, z);
    if (maxillary < 0) return AIR;
    if (maxillary < 1.5) return BONE;
    const sphenoid = SPHENOID(x, y, z);
    if (sphenoid < 0) return AIR;
    if (sphenoid < 1.5) return BONE;
    if (ax > 5 && ax < 17 && y > 36 && y < 74 && z > -46 && z < floor - 5) {
      return MEANDER(x / 3.5, y / 3.5, z / 3.5) > -0.25 ? AIR : BONE; // ethmoid air cells
    }
    if (y > 36 && y < 100 && z > -71 && z < -30 && sdOuter < -3) { // nasal cavity, inside the nose's walls
      const half = lerp(12, 5, (z + 70) / 40) - Math.max(0, y - 90) * 0.5;
      if (ax < half) {
        if (ax < 1.1) return BONE; // septum
        if (TURBINATES.some((t) => t(ax, y, z) < 0)) return MUSCLE;
        return AIR;
      }
    }
    if (NOSTRIL(ax, y, z) < 0) return AIR;
    if (NASOPHARYNX(x, y, z) < 0 || AIRWAY(x / 1.4, y, z) < 0 || ORAL(x, y, z) < 0) return AIR;

    // bone: palate, teeth, jaw, cheekbones, petrous and mastoid, clivus, hyoid
    if (ax < 21 && y > 40 && y < 88 && z > -73 && z < -69) return BONE; // hard palate
    const arch = 84 - 0.022 * x * x;
    if (ax < 30 && Math.abs(y - arch) < 3.5 && ((z > -82 && z < -74) || (z > -92 && z < -84))) return BONE; // teeth
    const jaw = Math.min(MANDIBLE(ax, y, z), RAMUS(ax, y, z), CONDYLE(ax, y, z));
    if (jaw < 0) return jaw < -2 ? FAT : BONE;
    const zyg = Math.min(ZYGOMA(ax, y, z), ZYG_BODY(ax, y, z));
    if (zyg < 0) return zyg < -2.5 ? FAT : BONE;
    if (INNER_EAR(ax, y, z) < 0) return CSF;
    if (PETROUS(ax, y, z) < 0) return BONE;
    const mastoid = MASTOID(ax, y, z);
    if (mastoid < 0) return mastoid < -1.5 && MEANDER(x / 3, y / 3, z / 3 + 9) > -0.2 ? AIR : BONE;
    if (ax < 12 && y > -16 && y < 22 && z > -58 && floor - z < 14) return floor - z < 2 || floor - z > 12 ? BONE : FAT; // clivus
    if (HYOID(ax, y, z) < 0) return BONE;

    // cervical spine: vertebral bodies and discs, arches, facets and spinous processes (the canal is handled earlier)
    if (z < -48) {
      const spine = vertebra(x, ax, y, z, Math.hypot(x / 12, (y + 24) / 8.5));
      if (spine >= 0) return spine;
    }

    // fat planes between muscles, and fatty glands
    const scm = SCM(ax, y, z);
    if (scm < 0) return MUSCLE;
    if (scm < 1.5 || PAROTID(ax, y, z) < 0 || PARAPHARYNGEAL(ax, y, z) < 0 || BUCCAL(ax, y, z) < 0
      || SUBMENTAL(x, y, z) < 0) return FAT;
    if (z < -60 && y < -8 && Math.abs(Math.hypot(x / 36, (y + 22) / 32) - 1) < 0.04) return FAT; // posterior neck
    return MUSCLE; // tongue, masseter, pterygoids, neck muscles and other soft tissue
  }

  // Cervical vertebra at this height, or -1. canal: the scaled distance used for the spinal canal.
  function vertebra(x, ax, y, z, canal) {
    if (DENS(x, y, z) < 0) return DENS(x, y, z) < -1.5 ? FAT : BONE;
    if (C1_ANTERIOR(x, y, z) < 0) return BONE;
    for (let k = 0; k < SPINE_LEVELS.length; k++) {
      const zl = SPINE_LEVELS[k];
      if (Math.abs(z - zl) > 10) continue;
      if (k > 0) {
        const body = sdEllipsoid(x, y + 2, z - zl, 15, 11, 6.5);
        if (body < 0) return body < -1.5 ? FAT : BONE;
        if (Math.abs(z - (zl + 8.75)) < 2.25 && Math.hypot(x / 15, (y + 2) / 11) < 1) return MUSCLE; // disc
      }
      const facet = sdEllipsoid(ax - 20, y + 15, z - zl, 6.5, 8, 6);
      if (facet < 0) return facet < -1.5 ? FAT : BONE;
      if (Math.abs(z - zl) < 4.5 && y < -14 && canal < 1.45) return BONE; // lamina
      if (ax < 3.5 && y < -36 && y > (k === 1 ? -60 : -54) && Math.abs(z - zl + 2) < 4) return BONE; // spinous process
    }
    return -1;
  }

  function labelAt(x, y, z) {
    // Cranium: an ovoid, fuller above its equator than below.
    const zc = z < 0 ? z * (92 / 80) : z;
    const sdCranium = sdEllipsoid(x, y + 6, zc, 76, 96, 92);
    const sdOuter = smin(sdCranium, sdFaceNeck(x, y, z), 8);
    if (sdOuter > 0) return AIR;

    // spinal canal, from below the medulla through the foramen magnum and down the neck: cord in CSF
    if (z < -48 && Math.hypot(x / 12, (y + 24) / 8.5) < 1) return Math.hypot(x / 6.5, (y + 24) / 4.5) < 1 ? WM : CSF;
    const floor = skullFloor(x, y);
    if (sdCranium < -12 && z > floor) return intracranial(x, y, z, sdCranium, floor);
    if (sdCranium <= 0 && z > floor - 6 && sdCranium > -12) return vault(x, y, z, -sdCranium);
    if (sdCranium <= -12 && z > floor - 6) { // skull base: outer table, marrow, inner table, with the sinuses carved in
      if (SPHENOID(x, y, z) < 0) return AIR;
      const layer = floor - z;
      return layer < 1.5 || layer >= 4.5 ? BONE : FAT;
    }
    return headTissue(x, y, z, sdOuter, floor);
  }

  // Scalp and skull of the vault, d mm in from the scalp surface (0..12): skin, fat or temporalis muscle, then bone
  // that is thick with marrow over the frontal and occipital lobes and thin over the temple. Frontal sinus air sits in
  // the frontal bone above the nose.
  function vault(x, y, z, d) {
    const ax = Math.abs(x);
    const temple = smoothstep(44, 58, ax) * smoothstep(-58, -42, z) * (1 - smoothstep(18, 34, z))
      * smoothstep(-40, -24, y) * (1 - smoothstep(44, 60, y));
    const tb = lerp(6.5 + smoothstep(55, 80, Math.abs(y)) * 1.5, 3.5, temple); // bone thickness
    const soft = 12 - tb;
    if (d < soft) {
      if (d < 1) return MUSCLE; // skin
      return temple > 0.3 && d > 3.5 ? MUSCLE : FAT; // temporalis, or subcutaneous fat
    }
    if (FRONTAL_SINUS(x, y, z) < 0) return AIR;
    const b = d - soft;
    return tb > 4 && b > 1.5 && b < tb - 1.5 ? FAT : BONE; // diploe between the tables
  }

  return { labelAt, options: { seed, sulcalDepthMm, lesions } };
}

// Sample a plane to a size x size label image (row 0 is the top of the image).
// plane: "axial" | "coronal" | "sagittal"; positionMm along the plane normal;
// fovMm square field of view; center = [right, up] offset of the view centre in mm.
// Screen axes follow radiological convention:
//   axial    screen-right = patient left, screen-up = anterior
//   coronal  screen-right = patient left, screen-up = superior
//   sagittal screen-right = posterior,    screen-up = superior (face to the left)
export function sliceLabels(phantom, plane, positionMm, size, fovMm = 240, center = [0, 0]) {
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const up = center[1] + fovMm / 2 - ((j + 0.5) / size) * fovMm;
    for (let i = 0; i < size; i++) {
      const right = center[0] + ((i + 0.5) / size) * fovMm - fovMm / 2;
      let x, y, z;
      if (plane === "axial") { x = right; y = up; z = positionMm; }
      else if (plane === "coronal") { x = right; y = positionMm; z = up; }
      else { x = positionMm; y = -right; z = up; }
      out[j * size + i] = phantom.labelAt(x, y, z);
    }
  }
  return out;
}
