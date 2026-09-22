---
name: support-free-orientation
description: Choose FDM print orientation and reshape overhangs, bridges, undersides, and split lines to minimize support material. Use when a model should print cleanly, efficiently, and with strong layer alignment.
---

# Support-Free Orientation

## Use this skill when

Planning a model split, selecting plate orientation, or correcting geometry that would otherwise require excessive or damaging supports.

## Required inputs

- Final model and component boundaries.
- Critical cosmetic surfaces and dimensional interfaces.
- Printer profile, material, and layer height.
- Whether support use is prohibited, discouraged, or acceptable in hidden regions.

## Workflow

1. Evaluate each component independently rather than forcing one assembly orientation.
2. Identify flat or stable bed contacts and check center of mass.
3. Map overhang angles, bridge spans, trapped support regions, and downward cosmetic surfaces.
4. Align structural loads with favorable layer direction.
5. Convert problematic undersides to chamfers, arches, teardrops, slopes, or intentional splits.
6. Add sacrificial brims, mouse ears, or removable interfaces only when geometric solutions are insufficient.
7. Record the exact plate rotation and support expectation for every component.

## Quality gates

- Every component has a stable first-layer footprint.
- Critical mating and visible surfaces avoid support scarring where practical.
- Unsupported spans remain within validated printer capability.
- Orientation does not weaken hooks, pins, threads, or snap features.
- The documented orientation matches the exported coordinate system.

## Output contract

Provide component orientations, overhang and bridge risks, geometric changes, expected support settings, and any surfaces requiring post-processing.

## Do not claim

Do not call a model support-free based only on visual inspection; confirm with sliced toolpaths or equivalent overhang analysis.
