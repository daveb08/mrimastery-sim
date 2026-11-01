// Seeded Gaussian noise shared by the image and k-space pipelines.

// Deterministic noise, so that the pattern does not flicker while sliders move.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const noiseCache = new Map();
export function unitNoise(n, seed = 12345) {
  const key = `${n}|${seed}`;
  if (!noiseCache.has(key)) {
    const r = mulberry32(seed);
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.max(r(), 1e-12), v = r(), m = Math.sqrt(-2 * Math.log(u));
      a[i] = m * Math.cos(2 * Math.PI * v); b[i] = m * Math.sin(2 * Math.PI * v);
    }
    if (noiseCache.size >= 4) noiseCache.delete(noiseCache.keys().next().value); // keep a few sizes (image planes, k-space)
    noiseCache.set(key, { a, b });
  }
  return noiseCache.get(key);
}

