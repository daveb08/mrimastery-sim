import test from "node:test";
import assert from "node:assert/strict";
import { coil, loopInductance, larmorHz, tuneAndMatch, inputImpedance, s11dB, tankResonance, excitation, sweep } from "./tuning.js";

const base = { b0: 3, radius: 0.05, qUnloaded: 250, loading: 0 };

test("a 10 cm loop of 2 mm wire is about 250 nH, and 3 T protons resonate at 127.7 MHz", () => {
  assert.ok(Math.abs(loopInductance(0.05) * 1e9 - 251) < 2);
  assert.ok(Math.abs(larmorHz(3) / 1e6 - 127.73) < 0.01);
});

test("tune and match gives 50 ohm at the Larmor frequency, empty or loaded, at any field", () => {
  let matched = 0;
  for (const b0 of [0.5, 1.5, 3, 7]) for (const loading of [0, 0.5, 1]) for (const radius of [0.02, 0.05, 0.1]) {
    const c = coil({ ...base, b0, loading, radius });
    const m = tuneAndMatch(c);
    if (c.rCoil + c.rSample >= 50) { assert.equal(m, null, `${b0} T, ${radius} m: loss above 50 ohm cannot match`); continue; }
    assert.ok(m.ct > 0 && m.cm > 0, `${b0} T, ${radius} m: capacitors must be positive`);
    assert.ok(s11dB(inputImpedance(c, m.ct, m.cm, c.f)) < -60, `${b0} T, load ${loading}, r ${radius}`);
    matched++;
  }
  assert.ok(matched >= 30);
});

test("the tuning capacitor alone sets the resonance at 1 / (2 pi sqrt(L C))", () => {
  const c = coil(base);
  assert.ok(Math.abs(tankResonance(c, 6e-12) - 1 / (2 * Math.PI * Math.sqrt(c.L * 6e-12))) < 1);
});

test("a patient lowers Q, pulls the resonance down, and matters more at higher field", () => {
  const empty = coil(base), loaded = coil({ ...base, loading: 0.5 });
  assert.ok(loaded.qLoaded < empty.qLoaded / 2);
  const { ct, cm } = tuneAndMatch(empty);
  const before = sweep(empty, ct, cm), after = sweep(loaded, ct, cm);
  assert.ok(after.fDip < before.fDip);
  assert.ok(after.dipDb > -20); // no longer matched
  const ratios = [0.5, 1.5, 3, 7].map((b0) => coil({ ...base, b0, loading: 0.5 }).qRatio);
  for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i] > ratios[i - 1]);
});

test("power is conserved: delivered = coil loss + patient loss, and a matched coil reflects nothing", () => {
  const c = coil({ ...base, loading: 0.5 });
  const { ct, cm } = tuneAndMatch(c);
  const e = excitation(c, ct, cm, base.radius, 100);
  assert.ok(e.reflected < 1e-6);
  assert.ok(Math.abs(e.toCoil + e.toPatient - e.delivered) < 1e-9);
  // detuned: less power in, smaller B1+, longer 90-degree pulse
  const off = excitation(c, ct * 1.05, cm, base.radius, 100);
  assert.ok(off.reflected > 0.5 && off.b1Plus < e.b1Plus && off.t90 > e.t90);
});

test("the sweep covers both the Larmor frequency and a coil tuned for another field", () => {
  const c3 = coil(base);
  const { ct, cm } = tuneAndMatch(c3);
  const s = sweep(coil({ ...base, b0: 1.5 }), ct, cm);
  assert.ok(s.f[0] < larmorHz(1.5) && s.f[s.f.length - 1] > larmorHz(3) * 0.99);
  assert.ok(s.fDip > larmorHz(1.5) * 1.5); // the coil still resonates near 128 MHz
});
