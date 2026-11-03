# Head phantom realism plan

Agreed 2026-11-03 (roadmap item 0). The phantom stays procedural. `labelAt(x, y, z)`, `createPhantom`,
`sliceLabels` and the 8 labels do not change, so the contrast simulator and the k-space explorer need no changes.
Seeds, lesions and the sulcal-depth slider stay.

Decisions:
- keep the 8 labels, so deep grey nuclei are grey matter and the tissue tables are untouched;
- partial-volume edges in the contrast images (P5);
- a full head-and-neck pass (P4).

## Approach

- **Landmarks:** structures are placed from approximate standard-atlas (MNI-style) coordinates and typical adult
  sizes, collected in one table at the top of `phantom/phantom.js`. Phantom mm = 0.94 × MNI mm, shifted so the
  head stays centred near the origin. The anterior commissure sits at about (0, 17, 4).
- **Brain fills the cranial cavity:** the brain is the cavity minus a thin CSF layer. The cavity is the inner
  vault plus a skull base with three fossae (anterior, middle, posterior) and the tentorium. The frontal lobes sit
  on the orbital roofs, the temporal lobes in the middle fossae, and the occipital lobes on the tentorium, with the
  cerebellum below it.
- **Cortex is a ribbon:** grey matter is tissue within about 2.7 mm of any pial surface. The pial surfaces are the
  outer brain surface, the sulci, the interhemispheric and Sylvian fissures, and the callosal and cingulate sulci.
  The ventricular walls are not pial surfaces.
- **Smooth shapes:** structures are tubes swept along landmark paths and smooth unions of simple shapes, not
  isolated ellipsoids.

## Phases (branch `phantom`; screenshots reviewed with the user after each)

1. **Cerebrum core:**
   - the new frame and cavity (vault, skull-base fossae, tentorium), with the face and neck moved down to match;
   - C-shaped lateral ventricles (frontal, occipital and temporal horns), the third ventricle and the septum
     pellucidum;
   - the corpus callosum and the cingulate gyrus;
   - the caudate, putamen, globus pallidus and thalamus, with the internal capsule between them;
   - the insula, claustrum and Sylvian fissure;
   - the hippocampus and amygdala.
2. **Cortex:** a new fold model.
   - Cellular (Worley) noise on the surface gives sulci of even width and an even grey-matter ribbon.
   - The named sulci are placed explicitly: central, Sylvian, calcarine, parieto-occipital and cingulate.
   - The seed varies only the minor gyri.
3. **Posterior fossa:**
   - cerebellar hemispheres and the vermis, with folia (the arbor vitae);
   - the midbrain, pons and medulla, the aqueduct, the fourth ventricle and the cisterns.
4. **Skull, scalp, face and neck:**
   - varying skull thickness, frontal sinus and mastoid air, the sella and pituitary, and the clivus;
   - the temporalis muscle;
   - orbits with the optic nerve and extraocular muscles;
   - the nasal cavity and turbinates, the airway, the tongue and the pharynx;
   - vertebrae with discs and the C1/C2 dens, and neck muscles separated by layers of fat.
5. **Partial volume and finishing:**
   - 2 × 2 in-plane supersampling in the contrast images, fraction-weighted;
   - the label viewer stays crisp;
   - a speed check, tests, captions and a new smoke-test baseline.

## Checks

- **Tests:** tissue volumes in adult ranges, median cortical thickness of about 2.5–3 mm, landmarks at their
  expected coordinates, and left-right symmetry apart from the seed's variation.
- **Speed:** render time at most about 2× the old phantom (121 ms for three 256 × 256 slices).
- **Smoke test:** `/qc` against the baseline. Only the phantom, contrast and k-space pages may change.
- **Merge and push:** the branch is merged and pushed only after the user approves.
