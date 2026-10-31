// Free-space, thin-wire coil fields. SI inputs and tesla outputs.
// Midpoint quadrature of Biot-Savart; no tissue, circuit, or wave model.
// Port of coil_fields.py. Points and vectors are flat Float64Arrays [x0,y0,z0,x1,...].

export const MU0 = 4e-7 * Math.PI; // adequate approximation for this educational model

export function rotationY(angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

const centersFor = (separation) => (separation == null ? [0] : [-separation / 2, separation / 2]);

// Signed field along the coil axis; pair currents have equal sense.
export function axialField(z, radius, current, turns = 1, separation = null) {
  return centersFor(separation).reduce(
    (sum, c) => sum + (MU0 * turns * current * radius ** 2) / (2 * (radius ** 2 + (z - c) ** 2) ** 1.5), 0);
}

// B vectors at world points, with NaN near ideal wires. Coils lie in local xy
// planes and share a local z axis; rotation is about y. Turns are coincident
// ideal loops. Exclusion is a numerical/display mask, not a wire-thickness model.
export function coilField(points, radius, current, turns = 1, separation = null,
                          tiltDeg = 0, segments = 256, exclusionFraction = 0.03) {
  if (points.length % 3 !== 0 || !Array.from(points).every(Number.isFinite)) {
    throw new Error("Points must be finite (..., 3) coordinates.");
  }
  if (!(radius > 0) || turns < 1 || segments < 32 || !(exclusionFraction > 0)) {
    throw new Error("Positive radius, turns, exclusion and >=32 segments required.");
  }
  if (separation != null && separation < 0) throw new Error("Separation cannot be negative.");
  const n = points.length / 3;
  const R = rotationY(tiltDeg);
  // local = points @ R   (row vectors)
  const local = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      local[3 * i + k] = points[3 * i] * R[0][k] + points[3 * i + 1] * R[1][k] + points[3 * i + 2] * R[2][k];
    }
  }
  const wx = new Float64Array(segments), wy = new Float64Array(segments);
  const dlx = new Float64Array(segments), dly = new Float64Array(segments);
  const arc = (radius * 2 * Math.PI) / segments;
  for (let s = 0; s < segments; s++) {
    const phi = (s + 0.5) * ((2 * Math.PI) / segments);
    wx[s] = radius * Math.cos(phi); wy[s] = radius * Math.sin(phi);
    dlx[s] = -arc * Math.sin(phi); dly[s] = arc * Math.cos(phi);
  }
  const out = new Float64Array(3 * n);
  const excluded = new Uint8Array(n);
  for (const center of centersFor(separation)) {
    for (let i = 0; i < n; i++) {
      const px = local[3 * i], py = local[3 * i + 1], pz = local[3 * i + 2];
      if (Math.hypot(Math.hypot(px, py) - radius, pz - center) < exclusionFraction * radius) excluded[i] = 1;
      const dz = pz - center;
      let bx = 0, by = 0, bz = 0;
      for (let s = 0; s < segments; s++) {
        const dx = px - wx[s], dy = py - wy[s];
        // Mask is applied after integration; avoid singular division here.
        const len = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), radius * 1e-12);
        const inv = 1 / (len * len * len);
        bx += dly[s] * dz * inv;
        by += -dlx[s] * dz * inv;
        bz += (dlx[s] * dy - dly[s] * dx) * inv;
      }
      out[3 * i] += bx; out[3 * i + 1] += by; out[3 * i + 2] += bz;
    }
  }
  const scale = (MU0 * current * turns) / (4 * Math.PI);
  const world = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    if (excluded[i]) { world[3 * i] = world[3 * i + 1] = world[3 * i + 2] = NaN; continue; }
    const lx = out[3 * i] * scale, ly = out[3 * i + 1] * scale, lz = out[3 * i + 2] * scale;
    for (let k = 0; k < 3; k++) world[3 * i + k] = lx * R[k][0] + ly * R[k][1] + lz * R[k][2]; // @ R.T
  }
  return world;
}

// Unit ampere-turn map on the y = 0 plane; current and turns can rescale it.
// Grid point (i, j) sits at x = axis[j], z = axis[i]; flat index i * grid + j.
export function fieldMap(radius, separation, tiltDeg, gridSize = 101) {
  const extent = 2.2 * radius;
  const axis = Float64Array.from({ length: gridSize }, (_, k) => -extent + (2 * extent * k) / (gridSize - 1));
  const points = new Float64Array(3 * gridSize * gridSize);
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const o = 3 * (i * gridSize + j);
      points[o] = axis[j]; points[o + 2] = axis[i];
    }
  }
  return { axis, gridSize, field: coilField(points, radius, 1, 1, separation, tiltDeg) };
}
