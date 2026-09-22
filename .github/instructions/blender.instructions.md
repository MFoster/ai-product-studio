---
applyTo: "**/*.py, **/*.blend"
---

# Blender files and scripts

- Set scenes to millimeters.
- Inspect the active scene and mode before modifying it.
- Do not rely on transient state from an earlier Blender session.
- Keep printable and AMS-selectable components separately named.
- Validate manifold geometry, dimensions, normals, and intended print orientation.
- Save canonical `.blend` files under a product's `source/` directory.
- Save reusable Blender scripts under `template/blender/` or a product's `script/`.
