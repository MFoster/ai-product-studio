---
name: mesh-printability-audit
description: Inspect and repair Blender or STL mesh geometry for reliable FDM printing. Use when validating manifoldness, normals, internal faces, loose geometry, zero-thickness regions, intersections, scale, or export readiness.
---

# Mesh Printability Audit

## Use this skill when

A model must be proven geometrically printable, repaired after import, or checked before STL or 3MF release.

## Required inputs

- Canonical source or imported mesh.
- Intended units and final dimensions.
- Expected component list and whether overlaps are intentional.
- Target printer profile.

## Workflow

1. Work on a copy and return Blender to Object Mode.
2. Confirm metric millimeter scale, applied transforms, dimensions, and object names.
3. For every printable mesh, measure boundary edges, non-manifold edges, loose vertices, degenerate faces, reversed normals, and disconnected islands.
4. Distinguish intentional AMS intersections from accidental internal shells.
5. Inspect thin or zero-thickness surfaces and coplanar overlaps.
6. Apply the least destructive repair that fixes the root defect.
7. Recalculate normals, re-run diagnostics, export, and re-import the result.
8. Record per-object before/after measurements.

## Quality gates

- Zero unintended boundary or non-manifold edges.
- No loose geometry, degenerate faces, or self-intersections that affect slicing.
- Outward-facing normals on closed solids.
- Correct millimeter dimensions after re-import.
- Intentional overlapping components remain separately named.

## Output contract

Provide the repaired source, diagnostic table by object, exported test asset, dimensions, and any unresolved geometry with its expected slicer consequence.

## Do not claim

Do not call a model printable solely because Blender reports a closed mesh. Wall thickness, orientation, tolerances, slicing, and physical printing require separate validation.
