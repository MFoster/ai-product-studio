---
name: model-repair-from-stl
description: Modify, reconstruct, or repair imported STL geometry when editable source is unavailable. Use for adding holes, bosses, connectors, clearances, or structural fixes while preserving critical dimensions.
---

# Model Repair from STL

## Use this skill when

Only tessellated mesh files are available and a functional correction or measured adaptation is required.

## Required inputs

- Original STL files and assembly context.
- Critical dimensions, datums, and intended coordinate system.
- Required modification and mating components.
- Permission to alter or replace the provided geometry.

## Workflow

1. Back up every original file and record checksums.
2. Import with verified millimeter scale and inspect mesh density, shells, normals, and dimensions.
3. Establish reliable datums from measured planar, cylindrical, or symmetric features.
4. Prefer localized booleans, fitted replacement solids, or clean collar/boss additions over whole-model remeshing.
5. Preserve untouched regions and component coordinates needed by the assembly.
6. Validate modified interfaces with ray tests, section views, and mating-part alignment.
7. Repair resulting topology, export, and re-import for dimensional comparison.
8. Retain a record of original and modified files.

## Quality gates

- Originals remain unchanged and recoverable.
- Modified dimensions match the required datums.
- Added solids are structurally connected.
- Cutouts and holes pass fully through the intended regions.
- Exported meshes are manifold and maintain assembly alignment.

## Output contract

Provide backups, measurement basis, changed regions, before/after dimensions, interface clearance, manifold report, and updated exports.

## Do not claim

Do not infer precise design intent from triangulated surfaces when assembly measurements or mating parts contradict that inference.
