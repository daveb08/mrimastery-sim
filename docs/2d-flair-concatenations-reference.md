# 2D FLAIR concatenations — physics reference for implementation

Prepared 2026-11-05 from a discussion with the project owner. This is research context, not an approved implementation plan. Read it before designing 2D FLAIR concatenations. Verify vendor-specific behavior against the intended sequence; do not generalize Siemens details to all scanners.

## Main finding

Three independent constraints can require multiple concatenations:
1. Spatial interference between broad slice-selective inversion regions, compromising CSF nulling.
2. Feasibility of scheduling each inversion and its readout at the prescribed TI and TR.
3. RF energy/SAR limits.

For the Siemens head FLAIR implementation documented below, a minimum of two concatenations is recommended specifically because the inversion region is approximately twice the imaging slice thickness. It is not simply a shortage of readout time within TR.

## Spatial constraint and CSF history

A wider inversion region helps prepare CSF that can flow into the imaging slice during the long TI. Its overlap with neighbouring slices means an inversion intended for one slice can perturb another slice's longitudinal magnetization.

For an ideal unintended inversion at time t, Mz(t+) = -Mz(t-). Recovery then proceeds from the changed state. Therefore, even a correctly scheduled nominal TI does not guarantee CSF nulling: the entire RF history matters. Real inversion profiles produce spatially varying effects and should be Bloch simulated.

Two interleaved concatenations can acquire odd slices in one group and even slices in another. Each group is acquired over the repetitions needed to fill its k-space before the next group is acquired. This increases spatial separation of active inversion regions. Acquiring odds then evens within each TR of a single concatenation is not equivalent; neighbouring preparations are still present in that repeating schedule.

The factor of two and the minimum of two concatenations are implementation-specific. Do not hard-code them as universal MRI laws. Do not assume perfect absence of interference with two groups: finite profiles, gaps, geometry, ordering and recovery history still matter.

## Timing constraint

Each slice requires an inversion, excitation at the prescribed TI, the complete TSE/FSE readout train, and the prescribed repetition interval. One slice's TI can contain work on other slices. Do not allocate an indivisible TI + readout block to every slice.

Conversely, floor(TR/readoutDuration) is not a sufficient capacity calculation. Inversion and readout modules must not conflict, and every slice must retain the required inversion-to-excitation interval. Some schedules leave idle time yet cannot accept another valid inversion/readout pair. The scheduler must account for pulse/gradient durations, complete echo trains, TI, TR, ordering and periodic boundaries.

The ISMRM 2023 research sequence below distributes inversion modules across TR, places corresponding excitations TI later, and reduces slices per TR when modules overlap. This is evidence of the scheduling constraint, not a specification for every commercial implementation.

## RF constraints

At fixed TR, more active slices mean more inversion/refocusing RF energy per unit time. Increasing concatenations can lower average RF load by reducing slices per repetition, while increasing total scan time. Shortening TR simultaneously may erase the benefit. Unless calibrated hardware/body models exist, label any simulator RF metric as a relative RF-energy proxy, not a clinical SAR prediction.

## Implications for this simulator (proposals, not approved design)

- Represent concatenation membership separately from slice acquisition order.
- Give inversion pulses their own spatial profile/width, distinct from excitation and refocusing profiles.
- Track tissue-specific longitudinal history under all relevant pulses through repeated cycles; compare residual CSF signal as well as signal change against an isolated slice.
- Distinguish spatial preparation interference, timing capacity, and RF-load limits in the teaching UI.
- Provide a timing diagram showing inversion/readout pairings and their TI intervals.
- Test nominal TI preservation, pulse collisions including across TR boundaries, group coverage, and convergence of the magnetization state.
- A static phantom/Bloch model can show inversion overlap but cannot demonstrate inflow protection without an explicit motion/flow model. State this limitation.
- Increasing TR may solve timing or RF load but does not automatically remove spatial inversion overlap.
- Keep 2D slice-selective and nonselective inversion implementations distinct. A common nonselective inversion followed by successive slice readouts yields different TIs unless compensated by the acquisition strategy.
- Do not carry assumptions from the existing non-inversion cross-talk model into FLAIR without revalidating them. A constant per-slice loss factor is not a substitute for inversion-history simulation.

## Sources and what they support

1. Siemens Healthineers, MRI image-quality application note (Japanese), document CS-APP-MR_220002, section 2.4, pp. 12–13, Figures 17–18.
https://academy.siemens-healthineers.com/_/ja-jp/mr-faq-imagequality-ja/
The section asks whether head FLAIR can use one concatenation to shorten acquisition. It describes inversion over twice the prescribed slice thickness to reduce CSF inflow effects, warns that neighbouring inversion pulses can leave residual CSF signal, and recommends two or more concatenations with interleaving. This is the strongest direct manufacturer evidence for the spatial constraint.

2. Kim D, Chao TC, Wang D, Pipe JG. Optimized, volumetric, isotropic-resolution T2W 2D FLAIR with high temporal and SNR efficiencies. ISMRM 2023, abstract 2224.
https://cds.ismrm.org/protected/23MProceedings/PDFfiles/2224_A9gE2HQtx.html
Methods explain inversion/readout scheduling at specified TI/TR and reducing slices per TR when modules overlap. A research implementation on Philips Ingenia, not a universal description of commercial FLAIR scheduling.

3. Siemens Healthineers. Tips and Tricks for SAR and Stimulation Reduction Job Aid (2021), section H, Number of concatenations.
https://academy.siemens-healthineers.com/_/en-us/tips-and-tricks-for-sar-and-stimulation-reduction-job-aid-/
Explains how concatenations and TR jointly determine RF pulses per unit time and thus affect SAR. More concatenations alone do not guarantee a reduction if TR is also changed.

4. Listerud J, Mitchell J, Bagley L, Grossman R. OIL FLAIR: optimized interleaved fluid-attenuated inversion recovery in 2D fast spin echo. Magn Reson Med. 1996;36:320–325. DOI: 10.1002/mrm.1910360220.
https://pubmed.ncbi.nlm.nih.gov/8843387/
The abstract describes interleaving slice-selective inversion with rapid spin echo and allowing TR to float above a minimum to improve efficiency. Historical support that TI is not necessarily dead time for the whole scanner.

5. Herlihy et al. Reduction of CSF and Blood Flow Artifacts on FLAIR Images of the Brain with k-Space Reordered by Inversion Time at each Slice Position (KRISP). AJNR, 2001.
https://pmc.ncbi.nlm.nih.gov/articles/PMC8174936/
Describes the inflow motivation for nonselective inversion and the problem of different TIs for successive slices, addressed by k-space/slice-order strategies. Full-page access was intermittent during research; the indexed abstract/introduction supported this point.

## Open decisions before implementation

Choose the intended inversion strategy, inversion profile and width, concatenation assignment, scheduler, treatment of steady state and group transitions, and whether RF load is merely illustrated or constrains timing. The owner has requested this reference for Claude Code; no new FLAIR code or protocol changes were authorized by this note.
