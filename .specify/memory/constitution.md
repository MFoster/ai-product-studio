# AI Product Studio Constitution

## Core Principles

### Product and asset preservation

Preserve user changes and existing binary source and release assets. Product
artifacts belong in their designated directories; inventories record their
checksums. Do not overwrite source models or releases without approval.

### Authoritative product-line customization

Product-line-local agents and skills are authoritative. Synchronize their
registered copies with `aps registry sync`, and preserve GitHub Copilot's
discovery directories. Follow parent and nearest applicable `AGENTS.md` files.

### Evidence and workflow gates

Use millimeters for printable geometry. Keep geometry, package, slice, coupon,
and physical-print evidence distinct. Never claim slicing or physical success
without evidence. Required artifacts and approvals gate workflow advancement;
failures remain visible.

### Maintainability and validation

Keep behavior changes focused, test them, and preserve existing interfaces.
Use the `aps` CLI for studio operations and run `aps validate` for structural
or release work. Follow documented Python and UI development checks.

## Governance

Follow `AGENTS.md`, applicable nested instructions, and `CONTRIBUTING.md` for
operational details. Update this document when the project's documented
principles change; it does not replace product-specific requirements.

**Version**: 1.0.0 | **Ratified**: 2026-11-24 | **Last Amended**: 2026-11-24
