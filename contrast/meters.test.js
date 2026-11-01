import test from "node:test";
import assert from "node:assert/strict";
import { meterFraction, formatTime, inPlanePixel, percentChange, formatPercent, meterValues } from "./meters.js";
import { computeModel, defaultParams } from "./physics.js";

test("bars are log-scaled and clamped", () => {
  assert.equal(meterFraction("snr", 1), 0);
  assert.equal(meterFraction("snr", 1000), 1);
  assert.equal(meterFraction("snr", 1e6), 1);
  assert.equal(meterFraction("snr", 0), 0);
  assert.ok(Math.abs(meterFraction("snr", 31.6227766) - 0.5) < 1e-6);
});

test("resolution bar fills as pixels get smaller", () => {
  assert.equal(meterFraction("resolution", 5), 0);
  assert.equal(meterFraction("resolution", 0.2), 1);
  assert.ok(meterFraction("resolution", 0.5) > meterFraction("resolution", 1));
});

test("scan time bar grows with time", () => {
  assert.ok(meterFraction("time", 600) > meterFraction("time", 60));
  assert.equal(meterFraction("time", 5), 0);
});

test("formatTime", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(256), "4:16");
  assert.equal(formatTime(3599.6), "60:00");
});

test("percent change against a baseline", () => {
  assert.equal(percentChange(110, 100), 10);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(5, null), null);
  assert.equal(percentChange(5, 0), null);
  assert.equal(formatPercent(10), "+10%");
  assert.equal(formatPercent(-50), "−50%");
  assert.equal(formatPercent(0.1), "no change");
  assert.equal(formatPercent(null), "");
});

test("meter values follow the model: doubling NEX raises SNR by sqrt 2 and doubles time", () => {
  const p = defaultParams("FSE", "3.0T");
  const a = meterValues(computeModel(p));
  const b = meterValues(computeModel({ ...p, NEX: 2 }));
  assert.ok(Math.abs(b.snr / a.snr - Math.SQRT2) < 0.01);
  assert.ok(Math.abs(b.time / a.time - 2) < 1e-9);
  assert.equal(b.resolution, a.resolution);
  assert.equal(inPlanePixel([1, 4]), 2);
});
