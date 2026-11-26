# AI Product Studio agent instructions

This repository manages AI-assisted 3D-printable product lines built in Blender
and packaged for Bambu Studio.

## Operating rules

- Read the nearest `AGENTS.md` plus parent instructions before changing a product.
- Consult `doc/SKILL_LIBRARY.md` and compose the narrowest applicable engineering
  and creative skills for the current workflow stage.
- Read the applicable YAML manifests before opening or editing binary assets.
- Keep editable source files, generated export, package, preview, and release assets
  in their designated directories.
- Treat product-line-local files under `ai/` as authoritative. Run
  `aps registry sync` after changing agents or skills.
- Use millimeters for printable geometry and preserve intended printer scale.
- Do not overwrite existing source models or release assets without explicit approval.
- Do not claim slicing success or physical print success without evidence.
- Capture slicer settings with `aps slicer capture` from a saved slicer project before
  printing; a recalled preset name is an assumption, not evidence.
- Record generated assets with `aps assets inventory`.
- Run `aps validate` before completing structural or release work.
- Preserve unrelated binary assets and user changes.

## Workflow

Products advance through `brief`, `design`, `review`, `print-validation`, and
`release`. Required artifacts and approvals must exist before advancement.
Failures must remain visible as blockers rather than being converted into
success-shaped defaults.
