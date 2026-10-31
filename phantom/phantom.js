// Procedural 3D head-and-neck phantom. DOM-free; deterministic for a given seed.
//
// The phantom is a function of position, labelAt(x, y, z), so any plane,
// thickness or matrix size is sampled directly: no stored volume, no resampling.
//
// Coordinates are millimetres with the head centred near the origin:
//   +x = patient LEFT, +y = ANTERIOR, +z = SUPERIOR.
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

const GRAD = 1.25; // typical |grad(noise)| per lattice unit: converts a noise level to a distance
const R0 = 70;     // radius of the sphere on which the sulcal pattern is defined

// Skull-base floor height as a function of position: anterior fossa (orbital roofs) high,
// middle fossa lower and lateral, posterior fossa lowest. The foramen magnum is open.
function skullFloor(x, y) {
  let z = y >= 50 ? 8 : y >= 0 ? 8 - (50 - y) * 0.4 : Math.max(-46, -12 + y * 0.55);
  if (y > -30 && y < 50) z -= 0.3 * Math.max(0, Math.abs(x) - 30);
  if (Math.hypot(x, y + 24) < 11) z = -200; // foramen magnum
  return z;
}

// options: seed (anatomy variation), sulcalDepthMm (0 gives a smooth brain), lesions (bool)
export function createPhantom({ seed = 1, sulcalDepthMm = 14, lesions = false } = {}) {
  const nWarp = makeNoise(seed * 7919 + 1), nA = makeNoise(seed * 7919 + 2);
  const nB = makeNoise(seed * 7919 + 3), nC = makeNoise(seed * 7919 + 4), nCb = makeNoise(seed * 7919 + 5);
  const depthScale = sulcalDepthMm / 14;

  const ventricles = [[-9, -2, 14, 6, 26, 9], [9, -2, 14, 6, 26, 9], [0, 4, 8, 1.2, 7, 7], [-9, 24, 12, 4, 10, 7], [9, 24, 12, 4, 10, 7]];
  const nuclei = [[-12, -14, 5, 11, 15, 10], [12, -14, 5, 11, 15, 10], [-13, 14, 8, 6, 11, 9], [13, 14, 8, 6, 11, 9]];
  const lesionList = lesions
    ? [[-15, 22, 12, 4, 4, 4], [17, 14, 14, 3, 3, 3], [-23, -12, 16, 5, 4, 4], [13, -26, 10, 3.5, 3.5, 3.5], [-7, 34, 17, 2.5, 2.5, 2.5], [-30, 5, 24, 3, 3, 3]]
    : [];
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

  function brainLabel(x, y, z) {
    // Cerebellum and brainstem sit low and posterior.
    const sdCb = sdEllipsoid(x, y + 52, z + 30, 46, 32, 24);
    const sdStem = sdCapsule(x, y + 14, z + 4, 0, 0, -45, 0, 2, -100, 10);
    if (sdStem < 0) return WM;
    if (sdCb < 0) {
      const d = -sdCb;
      let s = Infinity;
      if (depthScale > 0) {
        const L = Math.hypot(x / 46, (y + 52) / 32, (z + 30) / 24) || 1;
        s = sulcalDistance((x / 46 / L) * 30, ((y + 52) / 32 / L) * 30, ((z + 30) / 24 / L) * 30, d, 7, 12, 0.12, nCb, 5.1);
      }
      if (s < 0) return CSF;
      return d < 2.2 || s < 2 ? GM : WM;
    }

    // Cerebrum plus temporal lobes; their junction leaves a natural Sylvian cleft.
    const sdBrain = Math.min(
      sdEllipsoid(x, y - 1, z - 13.5, 63.4, 82.5, 62),
      sdEllipsoid(x - 47, y - 4, z + 12, 16, 34, 18),
      sdEllipsoid(x + 47, y - 4, z + 12, 16, 34, 18));
    const depth = -sdBrain + depthScale * 0.8 * nA(x / 40, y / 40, z / 40);
    if (depth < 0) return CSF;

    // Interhemispheric fissure: a thin wavy CSF sheet above the corpus callosum.
    if (z > 21 - 0.006 * (y - 4) ** 2 && Math.abs(x - 0.8 * Math.sin(y / 17 + z / 23)) < 0.8) return CSF;

    let s = Infinity;
    if (depthScale > 0) {
      const dx = x / 63.4, dy = (y - 1) / 82.5, dz = (z - 13.5) / 62;
      const L = Math.hypot(dx, dy, dz) || 1;
      let qx = (dx / L) * R0, qy = (dy / L) * R0, qz = (dz / L) * R0;
      // Two domain warps make the pattern meander like gyri: one in surface position (curving
      // the sulci along the cortex) and one in 3-D position (bending them as they go deeper).
      const wx = 6 * nWarp(qx / 20, qy / 20, qz / 20), wy = 6 * nWarp(qx / 20 + 9, qy / 20, qz / 20);
      const wz = 6 * nWarp(qx / 20, qy / 20 + 9, qz / 20);
      const ux = 9 * nWarp(x / 24 + 4, y / 24, z / 24), uy = 9 * nWarp(x / 24, y / 24 + 4, z / 24);
      const uz = 9 * nWarp(x / 24, y / 24, z / 24 + 4);
      qx += wx + ux; qy += wy + uy; qz += wz + uz;
      s = Math.min(
        sulcalDistance(qx, qy, qz, depth, 46, 21 * depthScale + 0.001, 0.045, nA, 3.3),
        sulcalDistance(qx, qy, qz, depth, 29, 13 * depthScale + 0.001, 0.05, nB, 9.7),
        sulcalDistance(qx, qy, qz, depth, 19, 7.5 * depthScale + 0.001, 0.05, nC, 6.1));
    }
    if (s < 0) return CSF;
    let label = depth < 3.2 || s < 2.4 ? GM : WM;
    if (inside(nuclei, x, y, z)) label = GM;
    if (inside(ventricles, x, y, z)) return CSF;
    if (label === WM && lesionList.length && inside(lesionList, x, y, z)) label = LESION;
    return label;
  }

  // Air spaces: nasal passage, sinuses, oral cavity, pharynx and trachea.
  function isAirSpace(x, y, z) {
    if (sdCapsule(x, y, z, 0, 100, -18, 0, 14, -24, 4.5) < 0) return true;
    if (sdEllipsoid(Math.abs(x) - 27, y - 56, z + 16, 11, 12, 7) < 0) return true; // maxillary sinus
    if (sdEllipsoid(x, y - 84, z - 30, 8, 5, 9) < 0) return true;
    if (sdEllipsoid(x, y - 66, z + 32, 13, 18, 4) < 0) return true;
    return z < -26 && sdCapsule(x, y, z, 0, 10, -26, 0, 10, -170, 6) < 0;
  }

  // Face and neck soft tissue below the skull base, with eyes, vertebrae and spinal cord.
  function softTissue(x, y, z, sdOuter) {
    if (sdOuter > -3) return FAT; // skin and subcutaneous fat
    const ax = Math.abs(x);
    if (sdEllipsoid(ax - 32, y - 76, z + 4, 12, 12, 12) < 0) return CSF; // vitreous
    if (sdEllipsoid(ax - 32, y - 68, z + 4, 17, 22, 17) < 0) return FAT; // orbital fat
    if (z > -24 && z < -20 && ax < 22 && y > 40 && y < 80) return BONE;   // hard palate
    if (z < -28) {
      const canal = Math.hypot(x / 8.5, (y + 26) / 8.5);
      if (canal < 1) return Math.hypot(x / 5, (y + 26) / 4.5) < 1 ? WM : CSF; // cord in CSF
      const arch = Math.hypot(x / 15, (y + 26) / 14) < 1
        || (Math.abs(x) < 3.5 && y < -34 && y > -56);
      if (arch) return BONE;
      const zc = -40 - 22 * Math.round((-40 - z) / 22);
      const body = sdEllipsoid(x, y + 4, z - zc, 15, 11, 9.5);
      if (body < -2) return FAT; // marrow
      if (body < 0) return BONE;
    }
    return MUSCLE; // tongue, cheeks, neck muscles and other soft tissue
  }

  function labelAt(x, y, z) {
    // Outer surface: cranial vault (flatter below), face, nose and neck.
    const zh = z - 8 < 0 ? (z - 8) * 1.3 : z - 8;
    const sdVault = sdEllipsoid(x, y, zh, 76, 96, 84);
    const sdOuter = Math.min(sdVault, sdEllipsoid(x, y - 58, z + 34, 60, 40, 50),
      sdEllipsoid(x, y - 96, z + 18, 11, 16, 26), sdEllipsoid(x, y - 70, z + 74, 30, 24, 17), sdEllipsoid(x, y + 10, z + 120, 52, 58, 100));
    if (sdOuter > 0) return AIR;
    if (isAirSpace(x, y, z)) return AIR;

    const floor = skullFloor(x, y);
    if (sdVault < -12 && z > floor) return brainLabel(x, y, z);
    // Skull: vault shell and the base slab, in three layers (outer table, marrow, inner table).
    const wall = sdVault < -6 && sdVault > -12 && z > floor - 6 ? -sdVault - 6 : -1; // 0..6 mm into the vault shell
    const base = sdVault < -6 && z <= floor && z > floor - 6 ? floor - z : -1; // 0..6 mm below the floor
    const layer = wall >= 0 ? wall : base;
    if (layer >= 0) return layer < 1.5 || layer >= 4.5 ? BONE : FAT;
    if (sdVault > -6 && sdVault <= 0 && z > floor - 8) return FAT; // scalp
    return softTissue(x, y, z, sdOuter);
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
