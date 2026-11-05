// DOM-free: the contrast simulator's settings mapped onto the shared slice timing (shared/sequence.js) and cross-talk.
import { sliceTiming, BUILDERS, DEFAULTS } from "../shared/sequence.js";
import { shotRows } from "../kspace/scan.js";
import { crossTalk } from "../shared/crosstalk.js";
import { tissuesAt } from "./physics.js";
import { EXTRA_TISSUES } from "./image.js";

export const PROTOCOL_DEFAULTS = { slices: 1, gapPct: 20, sliceOrder: "interleaved", concatenations: "auto", crossTalkOn: true };

const MODES = { FSE: "packed", GRE: "packed", "EPI (single-shot)": "packed", DWI: "packed", bSSFP: "sequential",
  FLAIR: "single", STIR: "single", DIR: "single", MPRAGE: "3d" };
export const protocolMode = (seq) => MODES[seq] ?? "single";

export function builderName(p) {
  if (p.seq === "FSE") return p.ETL === 1 ? "SE" : "FSE";
  if (p.seq === "GRE") return "GRE";
  return "EPI"; // EPI (single-shot) and DWI
}

export function builderParams(p) {
  return { ...DEFAULTS, seq: builderName(p), nx: p.freqMatrix, ny: p.phaseMatrix, fovRead: p.fovRead, fovPhase: p.fovPhase,
    bw: p.BW, TE: p.TE, TR: p.TR, ETL: p.ETL, flip: p.FA ?? 90, sliceMm: p.sliceMm,
    slices: p.slices ?? 1, gapPct: p.gapPct ?? 20, sliceOrder: p.sliceOrder ?? "interleaved",
    concatenations: p.concatenations ?? "auto", overflow: "passes", inversion: "none" };
}

const nSlices = (p) => Math.max(1, Math.floor(p.slices ?? 1));
const KEYS = ["seq", "field", "freqMatrix", "phaseMatrix", "fovRead", "fovPhase", "BW", "TE", "TR", "ETL", "FA", "sliceMm",
  "slices", "gapPct", "sliceOrder", "concatenations", "crossTalkOn"];
const keyOf = (p) => KEYS.map((k) => p[k]).join("|");

const CACHE_MAX = 32;
function memo(cache, key, make) {
  if (cache.has(key)) return cache.get(key);
  if (cache.size > CACHE_MAX) cache.clear();
  const v = make();
  cache.set(key, v);
  return v;
}

const timingCache = new Map(), factorCache = new Map();

export function protocolTiming(p) {
  return memo(timingCache, keyOf(p), () => {
    const mode = protocolMode(p.seq);
    if (mode === "single" || mode === "3d") return { mode, N: 1, maxSlices: null, concatenations: 1, passes: [[0]], slotMs: null, scanFactor: 1, messages: [] };
    const N = nSlices(p);
    if (mode === "sequential") {
      return { mode, N, maxSlices: null, concatenations: 1, passes: [Array.from({ length: N }, (_, i) => i)], slotMs: null, scanFactor: N, messages: [] };
    }
    const P = builderParams(p), name = builderName(p);
    const rows = shotRows(name, { ...P, slices: 1 }).rowsPerShot[0];
    const t = sliceTiming(P, name === "SE" || name === "GRE" ? rows[0] : rows);
    return { mode, N, maxSlices: t.maxSlices, concatenations: t.concatenations, passes: t.passes, slotMs: t.slotMs, scanFactor: t.scanFactor, messages: t.messages };
  });
}

export function middleSliceFactors(p) {
  if (protocolMode(p.seq) !== "packed" || nSlices(p) <= 1 || !p.crossTalkOn) return null;
  return memo(factorCache, keyOf(p), () => {
    const N = nSlices(p), mid = Math.floor((N - 1) / 2);
    const t = protocolTiming(p);
    const pass = Math.max(0, t.passes.findIndex((s) => s.includes(mid)));
    const P = builderParams(p), name = builderName(p);
    const rows = shotRows(name, { ...P, slices: 1 }).rowsPerShot[0];
    const seq = BUILDERS[name]({ ...P, pass }, name === "SE" || name === "GRE" ? rows[0] : rows);
    const T1 = {};
    for (const [n, v] of Object.entries(tissuesAt(p.field))) T1[n] = v.T1;
    for (const [n, v] of Object.entries(EXTRA_TISSUES)) T1[n] = v.T1;
    const xt = crossTalk(seq, T1);
    return xt.slices.find((s) => s.index === mid).factor;
  });
}
