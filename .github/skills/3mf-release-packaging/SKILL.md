---
name: 3mf-release-packaging
description: Package named printable components into a millimeter-unit 3MF and validate release assets. Use when preparing Blender output for Bambu Studio, AMS assignment, product inventory, or immutable release records.
---

# 3MF Release Packaging

## Use this skill when

Final source components must become a traceable, correctly scaled, multi-part 3MF release package.

## Required inputs

- Canonical Blender source and expected component list.
- Export directory, output package path, and printer profile.
- Component-to-material mapping.
- Product asset and release manifest locations.

## Workflow

1. Verify source units, transforms, names, and printable component eligibility.
2. Export one binary STL per printable or AMS-selectable component.
3. Re-import representative STLs to confirm scale and geometry.
4. Build a millimeter-unit 3MF with one named mesh object and build item per component.
5. Verify component count, names, transforms, alignment, and package readability.
6. Inventory source, STL, 3MF, and preview assets with hashes.
7. Open the package in Bambu Studio for manual profile, orientation, AMS, and slice review.
8. Capture immutable release metadata only after workflow gates pass.

## Quality gates

- STL and 3MF units are millimeters.
- Component count and names match the approved manifest.
- No component is missing, duplicated, shifted, or rescaled.
- Package opens successfully in the target slicer.
- Asset hashes and printer profile are recorded.

## Output contract

Provide STL list, 3MF path, component count, unit, color mapping, re-import result, hashes, and outstanding slicer or physical print checks.

## Do not claim

Do not treat successful 3MF creation as evidence of successful slicing or physical printing.
