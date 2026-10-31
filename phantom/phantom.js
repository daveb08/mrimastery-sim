// Procedural 3D head phantom. DOM-free; deterministic for a given seed.
//
// The phantom is a function of position, labelAt(x, y, z), so any plane,
// thickness or matrix size is sampled directly: no stored volume, no resampling.
//
// Coordinates are millimetres with the head centred near the origin:
//   +x = patient LEFT, +y = ANTERIOR, +z = SUPERIOR.
//
// Labels: 0 air, 1 white matter, 2 gray matter, 3 CSF, 4 fat (scalp, marrow),
//         5 cortical bone, 6 lesion (optional, illustrative).
// The anatomy is stylised, not a segmentation of a real person.

export const LABELS = { AIR: 0, WM: 1, GM: 2, CSF: 3, FAT: 4, BONE: 5, LESION: 6 };

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

// options: seed (anatomy variation), sulcalDepthMm (0 gives a smooth brain), lesions (bool)
export function createPhantom({ seed = 1, sulcalDepthMm = 14, lesions = false } = {}) {
  const n1 = makeNoise(seed * 7919 + 1), n2 = makeNoise(seed * 7919 + 2);
  const n3 = makeNoise(seed * 7919 + 3), n4 = makeNoise(seed * 7919 + 4);
  const depthScale = sulcalDepthMm / 14;
  const GRAD = 1.25; // typical |grad(noise)| per lattice unit, converts noise level to distance

  // Ventricles, deep gray nuclei and optional lesions: [cx, cy, cz, rx, ry, rz]
  const ventricles = [[-9, -2, 14, 6, 26, 9], [9, -2, 14, 6, 26, 9], [0, 4, 8, 1.2, 7, 7], [-9, 24, 12, 4, 10, 7], [9, 24, 12, 4, 10, 7]];
  const nuclei = [[-12, -14, 5, 11, 15, 10], [12, -14, 5, 11, 15, 10], [-13, 14, 8, 6, 11, 9], [13, 14, 8, 6, 11, 9]];
  const lesionList = lesions
    ? [[-15, 22, 12, 4, 4, 4], [17, 14, 14, 3, 3, 3], [-23, -12, 16, 5, 4, 4], [13, -26, 10, 3.5, 3.5, 3.5], [-7, 34, 17, 2.5, 2.5, 2.5], [-30, 5, 24, 3, 3, 3]]
    : [];
  const inside = (list, x, y, z) => list.some(([cx, cy, cz, a, b, c]) => sdEllipsoid(x - cx, y - cy, z - cz, a, b, c) < 0);

  // Slit-like sulci: thin sheets around the zero level of a noise field, tapering with depth.
  function sulcalDistance(x, y, z, depth, lambda, D, w0, nz, off) {
    if (depth > D + 4) return Infinity;
    const n = nz(x / lambda + off, y / lambda + off * 0.7, z / lambda - off * 0.4);
    const w = w0 * Math.max(0, 1 - depth / D);
    return ((Math.abs(n) - w) * lambda) / GRAD;
  }

  function labelAt(x, y, z) {
    // Scalp, skull (outer table, diploe, inner table), then the cranial cavity.
    // The skull base is flatter and higher than the vault: compress z below the head centre.
    const zh = z - 8 < 0 ? (z - 8) * 1.3 : z - 8;
    const sdHead = sdEllipsoid(x, y, zh, 76, 96, 84);
    if (sdHead > 0) return LABELS.AIR;
    if (sdHead > -6) return LABELS.FAT; // skin and subcutaneous fat
    if (sdHead > -7.5) return LABELS.BONE;
    if (sdHead > -10.5) return LABELS.FAT; // marrow
    if (sdHead > -12) return LABELS.BONE;

    // Cerebellum and brainstem sit low and posterior.
    const sdCb = sdEllipsoid(x, y + 50, z + 32, 46, 32, 24);
    const sdStem = sdCapsule(x, y + 14, z + 10, 0, 0, -45, 0, 2, -70, 10);

    // Cerebrum: depth below the pial surface, slightly perturbed.
    const brain = sdEllipsoid(x, y - 1, z - 13.5, 62.3, 81.3, 61);
    const undulation = depthScale * 1.0 * (n1(x / 33, y / 33, z / 33) + 0.5 * n2(x / 17, y / 17, z / 17));
    const depth = -brain + undulation;

    let label;
    if (sdStem < 0) {
      label = LABELS.WM;
    } else if (sdCb < 0) {
      const d = -sdCb;
      const s = depthScale > 0 ? sulcalDistance(x, y, z, d, 6, 11, 0.12, n3, 5.1) : Infinity;
      if (s < 0) label = LABELS.CSF;
      else if (d < 2.2 || s < 2) label = LABELS.GM;
      else label = LABELS.WM;
    } else if (depth < 0) {
      label = LABELS.CSF;
    } else {
      const big = depthScale > 0 ? sulcalDistance(x, y, z, depth, 34, 17 * depthScale + 0.001, 0.075, n3, 3.3) : Infinity;
      const small = depthScale > 0 ? sulcalDistance(x, y, z, depth, 19, 9 * depthScale + 0.001, 0.06, n4, 9.7) : Infinity;
      const s = Math.min(big, small);
      if (s < 0) label = LABELS.CSF;
      else if (depth < 2.8 || s < 2.4) label = LABELS.GM;
      else label = LABELS.WM;
      if (label !== LABELS.CSF) {
        if (inside(nuclei, x, y, z)) label = LABELS.GM;
        if (inside(ventricles, x, y, z)) label = LABELS.CSF;
        else if (label === LABELS.WM && lesionList.length && inside(lesionList, x, y, z)) label = LABELS.LESION;
      }
    }
    return label;
  }

  return { labelAt, options: { seed, sulcalDepthMm, lesions } };
}

// Sample a plane to a size x size label image (row 0 is the top of the image).
// plane: "axial" | "coronal" | "sagittal"; positionMm along the plane normal;
// fovMm square field of view. Screen axes follow radiological convention:
//   axial    screen-right = patient left, screen-up = anterior
//   coronal  screen-right = patient left, screen-up = superior
//   sagittal screen-right = posterior,    screen-up = superior (face to the left)
export function sliceLabels(phantom, plane, positionMm, size, fovMm = 240) {
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const up = fovMm / 2 - ((j + 0.5) / size) * fovMm;
    for (let i = 0; i < size; i++) {
      const right = ((i + 0.5) / size) * fovMm - fovMm / 2;
      let x, y, z;
      if (plane === "axial") { x = right; y = up; z = positionMm; }
      else if (plane === "coronal") { x = right; y = positionMm; z = up; }
      else { x = positionMm; y = -right; z = up; }
      out[j * size + i] = phantom.labelAt(x, y, z);
    }
  }
  return out;
}
