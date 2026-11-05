// DOM-free helpers for the explorer's slice strip (thumbnails that fill in a few at a time).

// thumbnails use at most 64 x 64 samples so the strip stays cheap
export const thumbMatrix = (ny) => Math.min(64, ny);

// main k-space row -> thumbnail row (the central m rows of the main grid), or -1 outside them
export function thumbRow(row, ny, m) {
  const r = row - ny / 2 + m / 2;
  return r >= 0 && r < m ? r : -1;
}

// memoises the phantom sampling of a slice: it depends on the position, thickness, field of view and matrix only
export function createSampleCache(sampler) {
  const map = new Map();
  return {
    get(zMm, sliceMm, fov, m) {
      const key = [zMm.toFixed(4), sliceMm, fov, m].join("|");
      if (!map.has(key)) map.set(key, sampler(zMm, sliceMm, fov, m));
      return map.get(key);
    },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}

// runs work(queue.shift()) until the queue is empty or the next item would probably overrun the budget (ms), judged
// by the cost of the item just run; always runs at least one item
export function pump(queue, work, budgetMs, now = () => performance.now()) {
  const start = now();
  let n = 0, prev = start;
  while (queue.length) {
    work(queue.shift()); n++;
    const t = now(), cost = t - prev;
    prev = t;
    if (t - start + cost > budgetMs) break;
  }
  return n;
}
