# AI Product Studio

This repository is an AI-first system for designing and releasing printable
product catalogs. Start with `AGENTS.md`, then read the nearest nested
`AGENTS.md`, product manifests, and workflow state.

- Use the `aps` CLI for scaffolding, registry synchronization, inventories, and
  validation instead of manually duplicating its behavior.
- Use `doc/SKILL_LIBRARY.md` to select focused, composable 3D-print skills and
  preserve the distinction between geometry, package, slice, and physical validation.
- Product-line-local agents and skills are authoritative; root registered copies
  may be regenerated.
- Preserve binary source assets and verify checksums during migrations.
- Keep Blender models in millimeters and distinguish model validation, slicer
  validation, and physical print validation.
