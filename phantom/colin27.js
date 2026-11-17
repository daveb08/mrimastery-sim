// Colin27 anatomy phantom: where the data lives and how its tissue classes map to the simulator's labels.
// Source: "Colin 27 Average Brain, Stereotaxic Registration Model, high-resolution version 2008" (McConnell Brain Imaging
// Centre, Montreal Neurological Institute), the discrete tissue classification of one normal adult's head.
// Only tissue membership is stored; signal comes from the simulator's own tissue tables.
import { LABELS } from "./phantom.js";

const { AIR, WM, GM, CSF, FAT, BONE, MUSCLE } = LABELS;

// Colin27 class -> LABELS. The simulator has eight tissue labels, so some classes share one:
//   0 background -> air            1 CSF -> CSF                 2 grey matter -> grey matter   3 white matter -> white matter
//   4 fat -> fat                   5 muscle -> muscle           6 skin and muscle -> muscle    7 skull -> cortical bone
//   8 (unused in the published list; treated as air)            9 fat 2 (connective tissue round fat) -> fat
//   10 dura -> muscle (approximation: short-T2 soft tissue)     11 marrow -> fat
//   12 vessels -> muscle (approximation: flow effects are not modelled)
const CLASS_MAP = [AIR, CSF, GM, WM, FAT, MUSCLE, MUSCLE, BONE, AIR, FAT, MUSCLE, FAT, MUSCLE];
export const mapColin27Label = (cls) => (cls >= 0 && cls < CLASS_MAP.length ? CLASS_MAP[cls] : AIR);

export const COLIN27_DIR = "data/colin27/";
// Resolution of the copy the pages load (mm); tools/prepare-colin27.mjs can also write the other one.
export const COLIN27_VOXEL_MM = 0.5;
export const colin27File = (voxelMm = 1) => `colin27_labels_${voxelMm === 0.5 ? "0.5mm" : "1mm"}`;
export const COLIN27_FILE = colin27File(COLIN27_VOXEL_MM);

export const COLIN27_COPYRIGHT = "Copyright (C) 1993-2009 Louis Collins, McConnell Brain Imaging Centre, Montreal Neurological "
  + "Institute, McGill University.";
export const COLIN27_CITATIONS = [
  "C.J. Holmes, R. Hoge, D.L. Collins, R. Woods, A.W. Toga, A.C. Evans: Enhancement of MR images using registration for signal averaging. Journal of Computer Assisted Tomography 22(2):324-333, 1998.",
  "B. Aubert-Broche, A.C. Evans, D.L. Collins: A new improved version of the realistic digital brain phantom. NeuroImage 32(1):138-145, 2006.",
];
