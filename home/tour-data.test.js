import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODS, TOUR, PATHS, SESS } from "./tour-data.js";
import { clampBench } from "./bench.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const ids = MODS.map((m) => m.id);

test("every simulator links to a page in the repo", () => {
  for (const m of MODS) assert.ok(existsSync(root + m.u + "index.html"), `${m.u}index.html is missing`);
});

test("every tour path starts at the intro and visits each stop exactly once", () => {
  const stops = Object.keys(TOUR).sort();
  for (const p of PATHS) {
    assert.equal(p.o[0], "intro", p.id);
    assert.deepEqual([...p.o].sort(), stops, p.id);
  }
});

test("every tour stop after the intro is a simulator with three things to try", () => {
  for (const [id, st] of Object.entries(TOUR)) {
    if (id === "intro") continue;
    assert.ok(ids.includes(id), `${id} is not a simulator`);
    assert.equal(st.try.length, 3, id);
  }
});

test("bench settings in the tour and sessions are already within the bench's limits", () => {
  const sets = [
    ...Object.values(TOUR).filter((s) => s.bench).map((s) => s.bench),
    ...SESS.flatMap((x) => x.s).filter((s) => s.m === "bench").map((s) => s.set),
  ];
  assert.ok(sets.length > 0);
  for (const b of sets) {
    const { flip, t1, t2 } = b;
    assert.deepEqual(clampBench(b), { flip, t1, t2 });
  }
});

test("every session step points at the bench or a simulator, and has a question and an answer", () => {
  for (const x of SESS) for (const s of x.s) {
    assert.ok(s.m === "bench" || ids.includes(s.m), `${x.id}: ${s.m}`);
    assert.ok(s.q.startsWith("Predict:") && s.a.length > 40, `${x.id}: ${s.b}`);
  }
});
