# AI Product Studio

AI Product Studio is an AI-first workspace and Python CLI for building coherent,
3D-printable product lines with Blender and packaging them for modern slicers.

The CLI, exposed as `aps`, creates consistent product workspaces, synchronizes
Copilot agents and skills, inventories binary assets, enforces workflow gates,
validates the repository, and records immutable releases.

## What the CLI manages

- Product lines, variants, and individual products.
- Hierarchical `AGENTS.md` instructions.
- Product-line-local agents and skills synchronized into `.github`.
- Blender sources, STL exports, 3MF packages, previews, and release manifests.
- SHA-256 asset inventories.
- A gated lifecycle from brief through physical print validation.
- YAML manifests and generated JSON Schemas.
- Non-destructive inventory of existing product assets.

The CLI does **not** claim that a model sliced or printed successfully. Geometry,
package, slice, and physical-print validation remain separate evidence levels.

## Requirements

- Python 3.12 or newer.
- Blender for model creation and optional headless validation.
- Bambu Studio or another compatible slicer for plate preparation and review.
- A virtual environment is strongly recommended.

## Clone and install

```bash
git clone <repository-url> ai-product-studio
cd ai-product-studio
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/aps validate
```

The repository starts without a product catalog. Create your first product line
with the scaffold commands below. Run `aps config` first to describe your
printer, slicer, and materials.

## Install for development

From the `ai-product-studio` directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/aps --help
```

Activating the virtual environment makes `aps` available without the prefix:

```bash
source .venv/bin/activate
aps --help
```

Run the project checks:

```bash
ruff check .
pytest -q
aps validate
```

## Studio root discovery

Most commands accept:

```text
--root PATH
```

Without `--root`, the CLI starts at the current directory and searches upward
for `config/studio.yaml`. This means commands can normally be run from the
studio root or from anywhere inside a product directory.

Use `--root` when invoking `aps` from outside the studio:

```bash
aps validate --root /path/to/ai-product-studio
```

Slugs must use lowercase kebab-case, for example:

```text
winter-village
original-collection
clock-tower
```

## Command overview

| Command | Purpose |
|---|---|
| `aps init` | Initialize a new studio directory |
| `aps config` | Interactively configure the studio, printer, and materials |
| `aps product-line create` | Create a product-line workspace |
| `aps variant create` | Create a named variant under a product line |
| `aps product create` | Create a product directly under a variant |
| `aps registry sync` | Synchronize product-local agents and skills into `.github` |
| `aps registry check` | Detect missing or stale synchronized customization |
| `aps assets inventory` | Generate a checksummed product asset manifest |
| `aps assets legacy-inventory` | Inventory unmanaged assets without moving them |
| `aps workflow status` | Show current product workflow state |
| `aps workflow advance` | Advance one validated lifecycle stage |
| `aps workflow print-result` | Record a passed or failed physical test print |
| `aps release create` | Create an immutable release manifest |
| `aps schema write` | Regenerate JSON Schemas from the typed models |
| `aps validate` | Validate manifests, assets, registry state, and skill metadata |

Every command supports `--help`:

```bash
aps workflow advance --help
aps product create --help
```

## Initialize another studio

The current repository is already initialized. To create a separate studio:

```bash
aps init ../new-product-studio --name "New Product Studio"
```

Preview the operation without writing files:

```bash
aps init ../new-product-studio --name "New Product Studio" --dry-run
```

Initialization creates:

- `config/studio.yaml`
- `config/printer/generic-fdm.yaml`
- `config/material/material.yaml`
- Root `AGENTS.md`
- `.github/agents`, `.github/skills`, and `.github/instructions`
- `product-line`, `schema`, and `template`

`--force` permits replacing generated initialization files. Use it deliberately;
it is not required for ordinary setup.

## Configure printers and materials

Run the interactive configuration wizard from anywhere inside the studio:

```bash
aps config
```

The wizard prompts for:

- Studio name.
- Printer profile slug and display name.
- X, Y, and Z build volume in millimeters.
- Nozzle diameter.
- Minimum wall thickness and printable detail.
- Automated multi-material support and maximum simultaneous slots.
- Preferred slicer and package format.
- Comma-separated material types.

Supported material presets are:

```text
abs, asa, nylon, pc, petg, pla, tpu
```

Each preset supplies broad starting ranges for nozzle and bed temperatures,
minimum wall guidance, shrink compensation, and handling notes. These are
starting values, not substitutes for filament-manufacturer recommendations or
printer calibration.

The wizard displays a summary and asks for confirmation before writing. Use
`--yes` to skip only the final confirmation while retaining all prompts:

```bash
aps config --yes
```

Write configuration for a studio outside the current directory:

```bash
aps config --root /path/to/studio
```

The command writes or replaces:

```text
config/studio.yaml
config/printer/<printer-slug>.yaml
config/material/material.yaml
```

Existing `product_lines` registrations and registry settings in `studio.yaml`
are preserved. When the default printer slug changes, the previous default
printer file is removed after the new profile is written.

Example session:

```text
$ aps config
Configure AI Product Studio
Supported material presets: abs, asa, nylon, pc, petg, pla, tpu
Studio name [AI Product Studio]:
Printer profile slug [generic-fdm]: corexy-300
Printer display name [Generic FDM Printer]: CoreXY 300
Build volume X (mm) [220.0]: 300
Build volume Y (mm) [220.0]: 300
Build volume Z (mm) [250.0]: 320
Nozzle diameter (mm) [0.4]: 0.6
Minimum wall thickness (mm) [1.2]: 1.8
Minimum printable detail (mm) [0.8]: 1.0
Supports an automated multi-material system? [y/N]: y
Maximum simultaneous material/color slots [2]: 4
Preferred slicer [Generic slicer]: Bambu Studio
Preferred package format (3mf or stl) [3mf]:
Material types (comma-separated) [pla,petg]: pla,asa
Write this configuration? [Y/n]:
```

Run validation after changing configuration:

```bash
aps schema write
aps validate
```

## Create a product line

```bash
aps product-line create winter-village \
  --name "Winter Village" \
  --description "Illuminated collectible winter buildings"
```

This creates:

```text
product-line/winter-village/
├── AGENTS.md
├── product-line.yaml
├── brief/
├── ai/
│   ├── agent/
│   └── skill/
└── variant/
```

The product-line manifest defines the catalog audience, design language,
workflow, and known variants. Edit the generated `AGENTS.md` to capture rules
that apply to every product in the line.

Use `--dry-run` to inspect the destination:

```bash
aps product-line create winter-village \
  --name "Winter Village" \
  --dry-run
```

Existing product lines are never overwritten unless `--force` is supplied.

## Create a variant

A variant is a named edition or interpretation of a product line, such as an
original collection, a new year, a premium edition, or a material-specific
release.

```bash
aps variant create winter-village original-collection \
  --name "Original Collection" \
  --theme "Architectural miniatures"
```

The resulting path is:

```text
product-line/winter-village/variant/original-collection/
├── AGENTS.md
└── variant.yaml
```

Products are stored directly under the named variant. There is no intermediate
`products/` directory.

## Create a product

```bash
aps product create \
  winter-village \
  original-collection \
  clock-tower \
  --name "Clock Tower" \
  --summary "Illuminated clock tower with removable roof"
```

The generated product structure is:

```text
product-line/winter-village/variant/original-collection/clock-tower/
├── AGENTS.md
├── product.yaml
├── workflow.yaml
├── source/
├── export/
│   └── stl/
├── package/
├── preview/
├── script/
├── review/
└── release/
```

Place files according to their role:

- Canonical editable `.blend` files in `source/`.
- Blender automation specific to the product in `script/`.
- Per-component STL files in `export/stl/`.
- 3MF files in `package/`.
- Front, back, and detail renders in `preview/`.
- Review evidence in `review/`.
- Immutable release manifests in `release/<version>/`.

## Manage agents and skills

Studio-wide agents and skills live in the standard Copilot locations:

```text
.github/agents/
.github/skills/
.github/instructions/
```

Product-line-specific sources live beside the product line:

```text
product-line/<line>/ai/agent/*.agent.md
product-line/<line>/ai/skill/<skill>/SKILL.md
```

After changing a product-local agent or skill:

```bash
aps registry sync
aps registry check
```

`registry sync` validates frontmatter, namespaces local agents, copies skill
companion files, removes only stale registry-managed copies, and writes
`.aps/registry.yaml`. It does not delete hand-authored global skills.

Preview synchronization without writing:

```bash
aps registry sync --dry-run
```

See `doc/SKILL_LIBRARY.md` for the reusable 3D-print skill catalog and
recommended skill combinations.

## Inventory product assets

After adding or changing product files:

```bash
PRODUCT=product-line/winter-village/variant/original-collection/clock-tower
aps assets inventory "$PRODUCT"
```

This writes `assets.yaml` inside the product directory. Each record contains:

- Repository-relative product path.
- Asset kind and format.
- Role.
- SHA-256 checksum.
- File size.
- Release eligibility.

The inventory recognizes:

- `source/` as canonical source.
- `.blend1` files below `source/backup/` as non-release backups.
- `export/` as generated printable exports.
- `package/` as slicer packages.
- `preview/` as rendered evidence.

Re-run the inventory whenever an inventoried file changes. `aps validate` reports
missing files, size changes, or checksum mismatches.

## Inventory unmanaged legacy assets

Create a report without moving or renaming source files:

```bash
aps assets legacy-inventory /path/to/legacy/assets
```

The default report is:

```text
report/legacy-assets.yaml
```

Specify another output path with:

```bash
aps assets legacy-inventory /path/to/legacy/assets \
  --output report/import-candidates.yaml
```

## Product workflow

Every product starts in `brief` and advances one stage at a time:

```text
brief -> design -> review -> print-validation -> release
```

Check the current state:

```bash
aps workflow status "$PRODUCT"
```

### Enter design

```bash
aps workflow advance "$PRODUCT" design \
  --note "Brief and dimensional constraints approved"
```

### Enter review

Review requires at least one canonical `.blend` source and an approval reference:

```bash
aps workflow advance "$PRODUCT" review \
  --note "Geometry ready for visual and printability review" \
  --approval "review-2026-09-21"
```

### Enter print validation

Print validation requires:

- At least two PNG previews.
- An up-to-date `assets.yaml`.
- An approval reference.

```bash
aps assets inventory "$PRODUCT"
aps workflow advance "$PRODUCT" print-validation \
  --note "Geometry and package review complete" \
  --approval "package-review-2026-09-21"
```

### Record a physical print

Physical print results can only be recorded during `print-validation`.

```bash
aps workflow print-result "$PRODUCT" passed \
  --evidence "test-print-001: thread fit and hanging test passed"
```

Use `failed` when acceptance criteria are not met:

```bash
aps workflow print-result "$PRODUCT" failed \
  --evidence "test-print-002: lid binds during final quarter turn"
```

The evidence should identify the printed package/profile and measured result.

### Create a release

A release requires:

- Current workflow stage is `print-validation`.
- Physical print status is `passed`.
- `assets.yaml` exists.
- At least one package matching the product printer profile (`3mf` or `stl`)
  exists in `package/`.
- A release approval reference.

```bash
aps release create "$PRODUCT" v1.0.0 \
  --approval "release-approval-2026-09-21" \
  --notes "Initial production-ready ornament"
```

This advances the workflow to `release` and writes:

```text
release/v1.0.0/release.yaml
```

Release manifests are immutable. Create a new version rather than overwriting an
existing release.

## Validate the studio

```bash
aps validate
```

Validation checks:

- Studio and printer manifests.
- Material configuration and temperature ranges.
- Product-line, variant, product, workflow, and asset manifests.
- Required hierarchical `AGENTS.md` files.
- Asset existence, size, and SHA-256 checksums.
- Agent and skill registry synchronization.
- Root skill frontmatter and directory naming.

The command exits non-zero and prints actionable errors when validation fails.

Run it before handoff, print validation, and release.

## Generate JSON Schemas

Typed Python models are the runtime source of truth. Regenerate editor-compatible
JSON Schemas after changing manifest models:

```bash
aps schema write
```

Schemas are written to `schema/`. Stale generated schema files are removed.

## Safe command behavior

These commands support `--dry-run`:

- `aps init`
- `aps product-line create`
- `aps variant create`
- `aps product create`
- `aps registry sync`

Scaffold commands refuse destructive overwrites by default.
`--force` is available where explicit replacement is supported.
`aps config` is intentionally interactive and asks for confirmation instead of
providing a dry-run mode.

The CLI reports errors rather than silently creating partial success states.

## Typical end-to-end session

```bash
# Create the catalog hierarchy.
aps product-line create winter-village --name "Winter Village"
aps variant create winter-village original-collection \
  --name "Original Collection"
aps product create winter-village original-collection clock-tower \
  --name "Clock Tower"

# Add or edit local agents and skills, then publish them to .github.
aps registry sync
aps registry check

# Work on the Blender source and exports.
PRODUCT=product-line/winter-village/variant/original-collection/clock-tower
aps workflow advance "$PRODUCT" design --note "Brief approved"

# After the source and review renders exist.
aps workflow advance "$PRODUCT" review \
  --note "Design ready for review" \
  --approval "design-review-001"
aps assets inventory "$PRODUCT"
aps workflow advance "$PRODUCT" print-validation \
  --note "Geometry and package checks passed" \
  --approval "print-review-001"

# After a traceable physical test.
aps workflow print-result "$PRODUCT" passed \
  --evidence "test-print-001"
aps release create "$PRODUCT" v1.0.0 \
  --approval "release-001"

# Final repository checks.
aps validate
```

## Repository structure

```text
ai-product-studio/
├── AGENTS.md
├── README.md
├── config/
│   ├── studio.yaml
│   ├── printer/
│   └── material/
├── doc/
├── product-line/
├── report/
├── schema/
├── src/
├── template/
└── test/
```

The standard Copilot directories remain plural because their names are part of
the integration contract:

```text
.github/agents/
.github/skills/
.github/instructions/
```

## Troubleshooting

### Studio root cannot be found

Run from inside the studio or provide:

```bash
aps validate --root /absolute/path/to/ai-product-studio
```

### A slug is rejected

Use lowercase kebab-case without spaces or underscores:

```text
phone-stand
```

### Registry validation reports stale files

```bash
aps registry sync
aps registry check
```

Edit the product-line-local source rather than the generated root copy.

### Asset validation reports checksum or size changes

Confirm the file change is intentional, then regenerate the inventory:

```bash
aps assets inventory "$PRODUCT"
aps validate
```

### Workflow advancement is blocked

Read the reported missing artifacts or approval. The CLI intentionally prevents
skipping stages or treating missing evidence as success.

## Additional documentation

- `doc/WORKFLOWS.md`: lifecycle and asset handoff overview.
- `doc/SKILL_LIBRARY.md`: reusable skill catalog and composition recipes.
- `template/blender/`: Blender setup, validation, STL export, and 3MF packaging starters.
- `CONTRIBUTING.md`: development workflow and contribution requirements.
- `SECURITY.md`: private vulnerability reporting policy.
- `CHANGELOG.md`: notable changes by release.

AI Product Studio is available under the MIT License.
