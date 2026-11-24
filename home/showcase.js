/*
 * Physics for the home page's rotating showcase: contrast (one phantom slice at three weightings) and k-space (the
 * slice's k-space filled row by row, with the image rebuilt from the rows so far). It reuses the simulators' own
 * code: the contrast simulator's spin-echo and FLAIR equations and tissue tables, and the shared FFT. DOM-free.
 * Images are row-major n x n arrays, index j * n + i.
 */
import { fseSignal, flairSignal, tissuesAt } from "../contrast/physics.js";
import { EXTRA_TISSUES } from "../contrast/image.js";
import { LABELS } from "../phantom/phantom.js";
import { fft2, fftshift2 } from "../shared/fft.js";

/** The phantom page's three teaching protocols at 1.5 T (ms). */
export const WEIGHTINGS = [
  { id: "t1", name: "T1-weighted", detail: "Spin echo, TR 500, TE 15", TR: 500, TE: 15 },
  { id: "t2", name: "T2-weighted", detail: "Spin echo, TR 4000, TE 100", TR: 4000, TE: 100 },
  { id: "flair", name: "FLAIR", detail: "TR 9000, TI 2500, TE 100", TR: 9000, TI: 2500, TE: 100 },
];

const BRAIN = [LABELS.WM, LABELS.GM, LABELS.CSF, LABELS.LESION];

/**
 * Signal per label (index = LABELS value). Air and bone stay 0. `scale` "all" makes the brightest tissue 1; "brain"
 * makes the brightest brain tissue 1 (fat and scalp may go above 1 and are drawn white), like the phantom viewer's
 * "Brain tissue" window, so grey-white contrast shows.
 */
export function labelLut(w, { field = "1.5T", scale = "all" } = {}) {
  const t = tissuesAt(field);
  const tis = { [LABELS.WM]: t.WM, [LABELS.GM]: t.GM, [LABELS.CSF]: t.CSF, [LABELS.FAT]: t.Fat,
    [LABELS.MUSCLE]: EXTRA_TISSUES.muscle, [LABELS.LESION]: EXTRA_TISSUES.lesion };
  const out = new Float32Array(8);
  for (const [label, x] of Object.entries(tis)) {
    out[label] = w.TI != null ? flairSignal(w.TR, w.TI, w.TE, x.T1, x.T2, x.PD) : fseSignal(w.TR, w.TE, x.T1, x.T2, x.PD);
  }
  const max = scale === "brain" ? Math.max(...BRAIN.map((l) => out[l])) : Math.max(...out);
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export function imageFromLabels(labels, lut) {
  const out = new Float32Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = lut[labels[i]];
  return out;
}

/** Centred k-space (DC in the middle) of an n x n real image. */
export function kspaceOf(img, n) {
  const re = Float64Array.from(img), im = new Float64Array(n * n);
  fft2(re, im, n, n);
  return { re: fftshift2(re, n, n), im: fftshift2(im, n, n) };
}

/** Phase-encode rows in centre-out order: n/2, n/2 - 1, n/2 + 1, ... */
export function centerOutRows(n) {
  const c = Math.floor(n / 2), rows = [c];
  for (let d = 1; rows.length < n; d++) {
    if (c - d >= 0) rows.push(c - d);
    if (c + d < n && rows.length < n) rows.push(c + d);
  }
  return rows;
}

/** Magnitude image from the given rows of centred k-space (the other rows are zero). */
export function reconFromRows(k, n, rows) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (const j of rows) for (let i = 0; i < n; i++) { re[j * n + i] = k.re[j * n + i]; im[j * n + i] = k.im[j * n + i]; }
  const ur = fftshift2(re, n, n, true), ui = fftshift2(im, n, n, true);
  fft2(ur, ui, n, n, true);
  const out = new Float64Array(n * n);
  for (let p = 0; p < out.length; p++) out[p] = Math.hypot(ur[p], ui[p]);
  return out;
}
