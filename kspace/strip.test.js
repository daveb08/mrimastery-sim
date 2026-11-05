import test from "node:test";
import assert from "node:assert/strict";
import { thumbMatrix, thumbRow, createSampleCache, pump } from "./strip.js";

test("thumbRow maps central rows", () => {
  assert.equal(thumbMatrix(32), 32); assert.equal(thumbMatrix(256), 64);
  assert.equal(thumbRow(128, 256, 64), 32); assert.equal(thumbRow(96, 256, 64), 0); assert.equal(thumbRow(95, 256, 64), -1);
  assert.equal(thumbRow(160, 256, 64), -1); assert.equal(thumbRow(159, 256, 64), 63);
  assert.equal(thumbRow(5, 32, 32), 5);
});

test("sample cache reuses a sampling", () => {
  let calls = 0;
  const cache = createSampleCache((z, th, fov, m) => { calls++; return { z, th, fov, m }; });
  const a = cache.get(1, 5, [240, 240], 64);
  assert.equal(cache.get(1, 5, [240, 240], 64), a);
  assert.equal(calls, 1);
  cache.get(2, 5, [240, 240], 64);
  assert.equal(calls, 2);
  cache.get(1, 5, [240, 240], 32); // a different thumbnail matrix is a different sampling
  assert.equal(calls, 3);
});

test("pump stops at the budget but always runs one", () => {
  let clock = 0;
  const now = () => (clock += 30);
  const queue = [1, 2, 3, 4], ran = [];
  const n = pump(queue, (x) => ran.push(x), 40, now);
  assert.equal(n, 2); assert.deepEqual(ran, [1, 2]); assert.deepEqual(queue, [3, 4]);
  assert.equal(pump([], () => {}, 40, now), 0);
  const q2 = [1, 2];
  assert.equal(pump(q2, () => {}, 0, now), 1);
});
