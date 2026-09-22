---
name: fdm-detail-design
description: Convert creative artwork into nozzle-aware FDM detail with readable silhouettes, relief, gaps, textures, text, and small features. Use when increasing visual richness without creating fragile or unprintable decoration.
---

# FDM Detail Design

## Use this skill when

Adding or refining decorative detail, characters, text, textures, borders, facial features, or small motifs for an FDM model.

## Required inputs

- Target printer, nozzle diameter, layer height, and material.
- Intended viewing distance and finished scale.
- Print orientation and color strategy.
- Priority features that must remain visually recognizable.

## Workflow

1. Establish a visual hierarchy: silhouette, major masses, secondary features, then texture.
2. Convert nozzle and layer constraints into minimum line width, gap, relief depth, and unsupported feature rules.
3. Exaggerate identity-defining landmarks rather than uniformly increasing detail.
4. Use layered relief and controlled depth to separate overlapping forms.
5. Round fragile tips, thicken roots, and merge details that would produce isolated extrusion paths.
6. Render at actual physical size and inspect a sliced preview for missing or single-line features.
7. Remove noise that increases print time without improving recognition.

## Quality gates

- Primary subject reads clearly in silhouette.
- Important gaps remain open in the sliced preview.
- Relief layers are visibly separated and structurally attached.
- Text and numerals are correctly oriented and legible at final scale.
- No critical detail relies on a feature smaller than the validated process limit.

## Output contract

Report minimum feature assumptions, major exaggerations, relief depths, details merged or omitted, and screenshots or renders at final scale.

## Do not claim

Do not equate high polygon count with printable detail. Only geometry represented by viable toolpaths contributes to the print.
