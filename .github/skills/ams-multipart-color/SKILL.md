---
name: ams-multipart-color
description: Design and validate multi-color FDM models as named intersecting components for Bambu AMS workflows. Use when separating artwork by color, limiting filament changes, or packaging a multi-part 3MF.
---

# AMS Multipart Color

## Use this skill when

A model needs intentional color separation, predictable component assignment, and reliable fusion in Bambu Studio.

## Required inputs

- Printer and AMS color limit.
- Desired palette and material compatibility.
- Canonical component list and visible color boundaries.
- Print orientation and 3MF packaging requirements.

## Workflow

1. Reduce the palette to the minimum colors that preserve visual hierarchy.
2. Assign every visible region to a named material group.
3. Create each color as a closed mesh with intentional overlap into its supporting solid.
4. Avoid coplanar-only contact, microscopic slivers, and hidden color components.
5. Consolidate same-color features when it simplifies assignment without harming editability.
6. Inspect purge-heavy transitions and orient color boundaries to reduce artifacts where practical.
7. Export named components and verify all are present as separate 3MF build objects.

## Quality gates

- Color count does not exceed the available AMS configuration.
- Every color component is printable and structurally attached.
- Components have no accidental voids at their boundaries.
- Names map unambiguously to the palette.
- Re-imported 3MF preserves component count, scale, and alignment.

## Output contract

Provide palette, component-to-color table, overlap strategy, component count, packaging result, and any purge or material-compatibility concerns.

## Do not claim

Do not claim AMS readiness from viewport materials alone; component geometry and 3MF object separation must be verified.
