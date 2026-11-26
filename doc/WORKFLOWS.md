# Product workflows

## Create a product line

```bash
aps product-line create <slug> --name "<display name>"
aps variant create <slug> <variant> --name "<variant name>"
aps product create <slug> <variant> <product> --name "<product name>"
```

Edit the generated manifests and `AGENTS.md` files. Add specialized agents and
skills below `product-line/<slug>/ai/`, then run `aps registry sync`.

## Product lifecycle

1. **Brief:** complete the product manifest and constraints.
2. **Design:** create canonical Blender sources and component structure.
3. **Review:** generate front/back previews and geometry evidence.
4. **Print validation:** prepare the 3MF and record slicing and test-print results.
5. **Release:** capture immutable artifact hashes and validation evidence.

Use `aps workflow advance` to move one gate at a time. Review, print-validation,
and release transitions require an approval reference. Release also requires a
passed physical print status.

## Asset handoff

After changing product assets:

```bash
aps assets inventory <product-directory>
aps validate
```

The inventory records repository-relative paths, roles, sizes, and SHA-256
checksums. `.blend1` files are backup assets and are never release-eligible.
macOS `.DS_Store` metadata is excluded at every directory depth. Re-run
`aps assets inventory <product-directory>` to remove any legacy metadata records;
validation rejects them rather than checking their volatile checksums.
Re-inventory preserves existing roles, source links, and release exclusions while
refreshing file hashes and sizes; backup files remain ineligible for release.

### Named groups and complete assembly packages

Use an optional product-local `groups.yaml` to describe a functional assembly
instead of relying on filename prefixes. `schema/group.schema.json` defines the
authoring contract; `aps schema write` regenerates it from the typed models.
Each group has a stable `id`, readable `name`, active `revision`, description,
versioned output `package`, ordered material palette, and a complete `parts` BOM.
Each part has its own stable ID/name, integer `quantity`, and aligned color
`meshes`, with product-relative STL asset paths, material IDs, and SHA-256 hashes.
Colors within a part are fused by the slicer; different physical parts remain
separate objects. Repeated parts use quantities rather than duplicate filenames.

Example structure (replace the digest with the actual STL hash):

```yaml
schema_version: '1.0'
product: sample-assembly
groups:
- id: sample-group
  name: Sample Assembly
  revision: v001
  description: Two panels and their separate fastener.
  package: package/v001/sample-group.3mf
  materials:
  - id: stone
    name: Ash stone
    color: '#BCB8AD'
    material: pla
  parts:
  - id: panel
    name: Panel
    quantity: 2
    meshes:
    - asset: export/stl/v001/panel-stone.stl
      material: stone
      sha256: <64-character-lowercase-sha256>
  - id: fastener
    name: Fastener
    quantity: 1
    meshes:
    - asset: export/stl/v001/fastener-stone.stl
      material: stone
      sha256: <64-character-lowercase-sha256>
  layout:
    spacing_mm: 6
    margin_mm: 5
    orientation: preserve-source
```

The palette's list order defines 1-based project filament numbers, not actual
AMS trays. Meshes must be binary STLs in millimeters, aligned in the same frame
within their physical part. References cannot escape the product directory,
including through symlinks. Unsupported materials, excess filament slots,
changed/missing sources, invalid meshes, and oversized parts fail explicitly.

Build all declared groups, then inventory:

```bash
aps assets package <product-directory>
aps assets inventory <product-directory>
aps validate
```

Use `--group <id>` to build only one group. Existing package files are never
overwritten: change the target path/revision before rebuilding. All defined
packages must exist and match their definitions before inventory/validation
passes. Groups are optional; existing products without `groups.yaml` continue
to work unchanged.

The compositor uses the product's printer profile and a deterministic shelf
layout. It translates complete rigid objects, without independently moving their
color meshes or silently rotating/scaling them, and creates additional plates
as needed. This is a conservative bounding-box layout, not a nesting optimizer
or a support/strength-qualified orientation. Allow extra room for brims, supports,
purge towers, exclusions, and machine clearances during actual slicer review.

For consumers such as the future web UI, `assets.yaml` includes `groups` as a
first-class list alongside the existing flat `assets` list. Use group/part IDs
for identity, `name` for display, `parts[].quantity` for the BOM, and each
`meshes[].asset`/`package` path to resolve the checksummed asset records. Do not
derive group membership or names from filenames. Inventory copies the authored
definitions; validation detects stale inventory or package metadata. Prior
revisions may remain inventoried as historical ungrouped assets.

Each generated 3MF embeds the group definition, source hashes, quantities, printer
configuration assumptions, plate/object mapping, and placements in
`Metadata/aps_group.json`. Bambu receives readable plate/object/color-part names
and explicit filament assignments. Native Bambu save/export preserves those
names, objects, plates and colors, but can drop the APS-specific JSON. Keep
`groups.yaml`/`assets.yaml` authoritative, preserve generated handoffs, and save
configured slicer projects under new paths rather than overwriting them.

This feature changes metadata and packaging only; web UI rendering is separate.
Package checks do not advance workflow gates or establish physical functionality.

## Bambu Studio

AI Product Studio validates package presence and component metadata but does not
automate slicing. Open the 3MF in Bambu Studio, verify the configured printer profile, plate
orientation, AMS assignments, supports, and sliced preview, then record the
review and physical test-print evidence.

Save the Bambu Studio project and capture its settings before printing so the
result is reproducible:

```bash
aps slicer capture <product-directory> <project.3mf> --note "<what was on the plate>"
aps assets inventory <product-directory>
```

This stores a validated `slice/<preset>.yaml` summary plus the full normalized
`project_settings.config`, both checksummed. Cite the profile slug in the print
review and in `aps workflow print-result` evidence. A profile is only
`evidence: captured` when it came from a real project file; a hand-written
profile must be marked `evidence: stated` and remains an assumption.
