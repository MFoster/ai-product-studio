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

## Bambu Studio

AI Product Studio validates package presence and component metadata but does not
automate slicing in its first release. Open the 3MF in Bambu Studio, verify the
X2D profile, plate orientation, AMS assignments, supports, and sliced preview,
then record the review and physical test-print evidence.
