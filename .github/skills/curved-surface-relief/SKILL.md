---
name: curved-surface-relief
description: Wrap text, numerals, artwork, and layered relief onto curved or irregular Blender surfaces with consistent depth. Use when decorating cylinders, spheres, pears, ornaments, vessels, or compound curved shells.
---

# Curved Surface Relief

## Use this skill when

Flat artwork must conform to a curved shell without distortion, mirrored text, chord sag, uneven embed depth, or slicer gaps.

## Required inputs

- Target surface or radius function.
- Flat artwork coordinates and intended front/back placement.
- Relief thickness, embed depth, and minimum feature rules.
- Required AMS component separation.

## Workflow

1. Define a stable 2D artwork coordinate system and target-surface mapping.
2. Tessellate concave polygons before extrusion; do not rely on fan triangulation.
3. Triangulate and densify long edges before bending so chords cannot sink below the shell.
4. Map each vertex using the local surface radius or nearest-surface projection.
5. Reverse the angular mapping sign where required to keep back-side text readable.
6. Embed the relief base consistently while leaving the visible depth proud.
7. Check seams, poles, high-curvature regions, and intersections with openings or split lines.
8. Preserve separate closed meshes for independent AMS colors.

## Quality gates

- Relief height is visually and measurably consistent across the surface.
- Concave shapes have no crossed or missing triangles.
- Back-side text is not mirrored.
- No relief triangle dips inside the shell unintentionally.
- Every color component intersects its support enough to fuse during slicing.

## Output contract

Provide mapping method, subdivision threshold, embed and relief depths, side orientation, distortion notes, and final diagnostic renders.

## Do not claim

Do not assume a shrinkwrap modifier alone produces printable relief; inspect topology, depth, intersections, and text orientation.
