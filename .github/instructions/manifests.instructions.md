---
applyTo: "**/*.yaml, **/*.yml"
---

# Studio manifests

- Keep `schema_version` explicit.
- Use repository-relative POSIX paths.
- Preserve stable field ordering.
- Do not add unknown fields; runtime models reject them.
- Update parent product and variant registries when adding children.
- Record physical print status as `pending` until evidence exists.
