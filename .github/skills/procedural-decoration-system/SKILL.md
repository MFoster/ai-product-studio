---
name: procedural-decoration-system
description: Generate reusable decorative systems in Blender such as wreaths, garlands, foliage, ribbons, snowflakes, beads, borders, and scrollwork. Use when a product line needs rich detail with controlled repetition and variation.
---

# Procedural Decoration System

## Use this skill when

Repeated or parameterized ornamentation should be generated consistently across one product or a catalog.

## Required inputs

- Motif vocabulary and art direction.
- Host curve or surface, target density, and symmetry rules.
- Printer feature limits and AMS palette.
- Regions to keep clear for mechanisms, text, and handling.

## Workflow

1. Define motif generators with dimensions, orientation axes, and attachment depth.
2. Separate structural paths from decorative instances.
3. Distribute motifs by arc length or controlled parameter spacing rather than visual guesswork.
4. Add bounded variation in scale, rotation, or spacing without breaking the collection language.
5. Orient leaves, beads, ribbons, and repeated forms relative to curve tangents and surface normals.
6. Convert instances to named closed meshes only when required for export or color grouping.
7. Check collisions, floating elements, over-dense regions, and repetitive visual artifacts.
8. Preserve generator parameters in a Blender Text block or reusable script.

## Quality gates

- Motifs follow the intended tangent and normal directions.
- Spacing is consistent and does not create unprintable gaps or overlaps.
- Decoration avoids mechanisms, openings, and required grip areas.
- Repetition contains enough controlled variation to look intentional.
- Generated components remain editable and reproducible.

## Output contract

Provide generator parameters, motif counts, spacing method, variation ranges, attachment depth, color grouping, and regenerated output.

## Do not claim

Do not use random placement without a fixed seed and recorded parameters when reproducibility is required.
