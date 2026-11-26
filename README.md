# AI Product Studio

AI Product Studio is an AI-first workspace and Node.js CLI for building coherent,
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
- Named assembly groups with quantities, material meshes, and complete multi-plate 3MF packages.
- A gated lifecycle from brief through physical print validation.
- YAML manifests and generated JSON Schemas.
- Non-destructive inventory of existing product assets.

The CLI does **not** claim that a model sliced or printed successfully. Geometry,
package, slice, and physical-print validation remain separate evidence levels.

## Requirements

- Node.js 22.18 or newer and npm.
- Python 3.12 or newer for the legacy CLI, Blender scripts, and parity tests.
- Blender for model creation and optional headless validation.
- Bambu Studio or another compatible slicer for plate preparation and review.

## Clone and install

### Consume the published toolchain

The npm distribution is `@mfoster/ai-product-studio` on GitHub Packages. It
includes the Node CLI, compiled review UI, schemas, and selected generic AI
capabilities, not any studio's products. Node 22.18 or newer is required.
Spec Kit's optional workflows additionally use Bash and Python 3; Blender and
slicing tools remain separate installations.
Publishing is configured below; a release must be published before these install
commands are available.

Configure the registry in the consuming studio's `.npmrc`:

```ini
@mfoster:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Provide `NODE_AUTH_TOKEN` through your environment or secret manager. GitHub
Packages requires authentication to install packages, including public packages;
use an authorized token with `read:packages`. Never put a literal token in Git.

```bash
mkdir my-studio && cd my-studio
npm init -y
npm install --save-exact @mfoster/ai-product-studio@0.1.0
npx --no-install aps init .
npx --no-install aps toolkit sync --dry-run
npx --no-install aps toolkit sync
npx --no-install aps validate
npx --no-install aps-ui --root .
```

Open `http://127.0.0.1:3000`. The UI is read-only and binds to localhost by
default. Set `"private": true` in the studio's `package.json` to avoid accidental
npm publication. Commit that file, `package-lock.json`, studio configuration,
authoritative AI sources, installed discovery files, and `.toolkit/manifest.json`
to the studio's own repository. The toolkit does not initialize or publish Git.

The consuming studio can add these scripts to its `package.json`:

```json
{
  "private": true,
  "scripts": {
    "aps": "aps",
    "review": "aps-ui --root .",
    "toolkit:check": "aps toolkit check",
    "toolkit:sync": "aps toolkit sync"
  }
}
```

There are no automatic installation hooks that write studio files. Upgrade the
dependency explicitly, review the lockfile, then preview and apply synchronization:

```bash
npm install --save-exact @mfoster/ai-product-studio@<version>
npm run toolkit:check
npm run toolkit:sync -- --dry-run
npm run toolkit:sync
npm run aps -- validate
git diff
```

`toolkit check` exits nonzero when the installed package version or capability
content differs from the synchronized state. This is expected after an upgrade.
Synchronization records version, source, owner, and checksums; it refuses
unowned destination files, edited managed files (including obsolete ones),
symlink destinations, and capability collisions. Resolve such conflicts
explicitly rather than using a force update.

Generic agents, skills, instructions, reusable `template/` files, and Spec Kit
scripts/templates come from the package. Put studio-wide custom agents under `ai/agent/` and named skills
under `ai/skill/<name>/SKILL.md`; product-line sources remain under
`product-line/<line>/ai/`. These are synchronized to the studio's `.github/`
discovery directories. Skill frontmatter names must match their registered
directory names. Existing root `AGENTS.md` is never changed by synchronization,
and the studio's Spec Kit constitution and integration settings are seeded only
if absent.
For managed studios, `aps registry sync/check` use the same ownership protections.
Existing studios with unowned discovery files must move their custom sources
into `ai/` or resolve generated copies before adopting toolkit synchronization.

### Develop the framework

```bash
git clone <repository-url> ai-product-studio
cd ai-product-studio
npm ci
export PATH="$PWD/node_modules/.bin:$PATH"
aps init ../my-studio --name "My Studio"
git -C ../my-studio init
aps validate --root ../my-studio
```

The framework and studio are separate checkouts. Initialize Git in `my-studio`
and keep its `config/`, `product-line/`, and product assets in that repository.
Create your first product line with the scaffold commands below. Run `aps config`
to describe your printer, slicer, and materials.

## Install for development

From the `ai-product-studio` directory:

```bash
npm ci
export PATH="$PWD/node_modules/.bin:$PATH"
aps --help
```

Install the Python oracle for parity tests and legacy development:

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
PATH="$PWD/.venv/bin:$PATH" npm test
```

## Application workspaces

The root npm workspace contains `apps/engineer_ui`, the local inventory UI,
and `apps/aps_cli`, published as `@mfoster/ai-product-studio`. The legacy Python implementation remains at
the repository root as a rollback option and differential test oracle.

```bash
npm run dev
npm run build
npm run aps -- --help
npm run aps:python -- --help
npm run test --workspace=engineer_ui
npm run test --workspace=@mfoster/ai-product-studio
```

The root `test`, `lint`, `format:check`, and `typecheck` scripts run both
workspaces; `build` targets the UI. Use `--workspace=engineer_ui` or
`--workspace=@mfoster/ai-product-studio` to select an app. The CLI's Python source, package
configuration, and tests remain at the repository root.

`npm run aps --` and `./node_modules/.bin/aps` use Node without Python.
`npm run aps:node --` and `aps-node` are aliases; `npm run aps:python --`
requires an installed Python CLI. Activating `.venv` may put the legacy `aps`
ahead of the Node executable on `PATH`; use `npm run aps --` to select Node
unambiguously. `npm run test:node --workspace=@mfoster/ai-product-studio`
compares behavior against Python; set `APS_PYTHON` to its interpreter if it is
not available in `.venv` or as `python3`. The differential suite covers the
command families but does not prove complete parity, including exact help and
error formatting. Shell completion installs for Bash, Zsh, Fish, and PowerShell.
Like the Python installer, PowerShell installation attempts to set the current
user's execution policy to `Unrestricted`. Like Python, numeric prompts accept
non-finite float values; do not use them for printable dimensions.
On Windows, the Node CLI also rejects root-relative manifest paths to prevent
them from escaping the studio or product directory.
For filenames ending in a dot, inventory roles follow Python 3.14's `pathlib`
behavior; Python 3.12 and 3.13 retain the trailing dot in the role.
On POSIX, non-strict symlink-loop resolution also follows Python 3.14; earlier
Python versions may reject the same paths.

## Docker

The CLI and UI have separate images based on Debian Bookworm and Node 22.
Docker Engine and Compose are required; the images do not contain Python,
Blender, or a slicer. Studio data is mounted separately and is not included in
the image build context.

```bash
mkdir -p ../my-studio
export APS_STUDIO_DIR="$(cd ../my-studio && pwd)"
# On Linux, match the host user so the CLI can write to the bind mount.
export APS_UID="$(id -u)" APS_GID="$(id -g)"
docker compose --profile cli build
docker compose run --rm aps_cli init /studio --name "My Studio"
docker compose run --rm aps_cli validate
docker compose up -d engineer_ui
```

Open `http://127.0.0.1:3000`. Set `APS_UI_PORT` to change the host port.
The UI mount is read-only and the port is bound to localhost; the CLI mount is
read-write. Run further commands with `docker compose run --rm aps_cli ...`;
paths passed to the container refer to `/studio`, not host paths. Use an
existing studio without running `init` again. On Docker Desktop, make sure the
studio directory is shared with Docker. Absolute host symlinks and files outside
the mounted directory are not automatically available inside the container.
Bind mounts also retain host filesystem permissions and case behavior. Stop the
UI with `docker compose down`.

## Spec-driven development

Spec Kit 1.4.4 provides Copilot skills in `.github/skills/speckit-*` and
workflow scripts, templates, and project principles in `.specify/`. These are
tracked in this repository; machine-local state is excluded by
`.specify/.gitignore`. Invoke `/speckit-specify`,
`/speckit-plan`, `/speckit-tasks`, and `/speckit-implement` in Copilot; see
the [upstream guide](https://github.com/github/spec-kit/blob/v1.4.4/docs/quickstart.md).
The constitution records existing studio principles, and lifecycle hooks are
disabled. Existing studio agents and skills remain independent of Spec Kit;
product-line-local registry sources remain authoritative.

When using Spec Kit's optional workflow dispatch, set
`SPECKIT_COPILOT_ALLOW_ALL_TOOLS=0` to avoid its default all-tools permission.

For maintenance, install the pinned tool with
`uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v1.4.4`
and review upstream changes and managed files before upgrading. Do not run
forced initialization over unreviewed local changes. Spec Kit's upstream
license is in `.specify/UPSTREAM-LICENSE`.

## Toolchain releases

Run `npm run pack:toolchain` to build a distributable npm archive. The build uses
an explicit list of generic capabilities; it does not copy local studios,
generated product registries, credentials, or development build caches. Run
`node scripts/test-toolchain-package.mjs /path/to/archive.tgz` to install the
archive into a disposable consumer and exercise its CLI and review UI.

Merging to `main` triggers the publish workflow; it can also be dispatched on
`main`. The source package version is a stable base: the workflow adds its run
number minus one to the patch component, so base `0.1.0` produces `0.1.0`,
`0.1.1`, and so on. Failed runs can leave version gaps. Retrying a run reuses
its version and will not republish a package already released from that commit.
Update the source base and root lockfile together for a new minor or major series;
the run counter continues across series. No bot version commits are required.

The workflow builds on Linux, runs checks and the packed-consumer smoke test,
publishes the verified archive to GitHub Packages, and creates a
`toolchain-v<version>` GitHub release targeting the merged commit. Its
`GITHUB_TOKEN` requires `packages:write` and `contents:write`.
Package visibility and repository access must be configured
in GitHub; public source does not automatically make the package public.
No release is published merely by running the local build.

## Studio root discovery

Most commands accept:

```text
--root PATH
```

Set `APS_STUDIO_ROOT` to an absolute studio path to use the same catalog from
both the CLI and the UI:

```bash
export APS_STUDIO_ROOT=/absolute/path/to/my-studio
aps validate
npm run dev
```

An explicit `--root` takes precedence over the environment variable. If neither
is set, the CLI searches upward from the current directory for
`config/studio.yaml`; the UI defaults to the framework checkout for compatibility.
An invalid `APS_STUDIO_ROOT` produces an error instead of selecting another studio.

### Use a separate studio repository

Clone an existing studio beside the framework and point both applications at it:

```bash
git clone <studio-repository-url> ../my-studio
export APS_STUDIO_ROOT="$(cd ../my-studio && pwd)"
aps registry check
aps validate
```

For Docker, set `APS_STUDIO_DIR="$APS_STUDIO_ROOT"` instead. Open the studio
checkout alongside the framework in your editor to access its instructions,
product-local agents and skills. `aps registry sync` writes generated registry
copies into the selected studio, not the framework. Review local changes before
regenerating them.

Update the studio explicitly with Git after reviewing its local changes and the
incoming commits:

```bash
git -C "$APS_STUDIO_ROOT" status --short --branch
git -C "$APS_STUDIO_ROOT" fetch
git -C "$APS_STUDIO_ROOT" log --oneline HEAD..'@{upstream}'
git -C "$APS_STUDIO_ROOT" merge --ff-only '@{upstream}'
aps registry check
```

If Git reports local conflicts or a non-fast-forward update, stop and resolve
them in the studio repository; do not force an update. If the registry is stale,
review its local changes, run `aps registry sync`, and then `aps validate`. This
independent checkout avoids coupling the framework to one catalog or
automatically running remote code. Product binaries remain in the studio
repository and may need Git LFS.

Use `--root` when invoking `aps` from outside the studio:

```bash
aps validate --root /path/to/ai-product-studio
```

### Separating an existing catalog

The framework ignores local `config/` and `product-line/` data; a fresh studio's
own `.gitignore` does **not** ignore these directories or printable assets.
Existing local files are not moved or deleted. Copy the studio's `config/`,
`product-line/`, and applicable studio-specific `AGENTS.md` into a separate
repository, preserve binary files, and compare SHA-256 checksums before removing
any original. In the new studio, run `aps registry sync` and `aps validate`, and
review validation errors rather than regenerating inventories to hide them.
Product-line-local agents and skills remain authoritative in that repository;
their `.github` copies are generated there. Existing tracked files are not
untracked by `.gitignore`; review their Git status before migration.
Choose suitable large-file storage before publishing binary assets to a remote.

Slugs must use lowercase kebab-case, for example:

```text
winter-village
original-collection
clock-tower
```

## Command overview

| Command                       | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `aps init`                    | Initialize a new studio directory                                  |
| `aps config`                  | Interactively configure the studio, printer, and materials         |
| `aps product-line create`     | Create a product-line workspace                                    |
| `aps variant create`          | Create a named variant under a product line                        |
| `aps product create`          | Create a product directly under a variant                          |
| `aps registry sync`           | Synchronize product-local agents and skills into `.github`         |
| `aps registry check`          | Detect missing or stale synchronized customization                 |
| `aps assets inventory`        | Generate a checksummed product asset manifest                      |
| `aps assets package`          | Compose named groups into complete, unsliced multi-plate 3MF files |
| `aps assets legacy-inventory` | Inventory unmanaged assets without moving them                     |
| `aps workflow status`         | Show current product workflow state                                |
| `aps workflow advance`        | Advance one validated lifecycle stage                              |
| `aps workflow print-result`   | Record a passed or failed physical test print                      |
| `aps slicer capture`          | Record the slicer settings from a saved slicer project             |
| `aps slicer list`             | List the slice profiles recorded for a product                     |
| `aps release create`          | Create an immutable release manifest                               |
| `aps schema write`            | Regenerate JSON Schemas from the typed models                      |
| `aps validate`                | Validate manifests, assets, registry state, and skill metadata     |

Every command supports `--help`:

```bash
aps workflow advance --help
aps product create --help
```

### Interactive commands

Run `aps` without arguments in a terminal to choose a command from a numbered
menu (command names also work). The wizard prompts for every argument and option;
press Enter to accept a default or leave an optional value unset. Command groups
such as `aps product` also open a menu. Enter `0` to exit, or press Ctrl-C to cancel.

If you specify a command but omit required arguments or options, APS prompts only
for those missing values, preserving the values you supplied. An option supplied
without its value, such as a trailing `--name`, also triggers a prompt.

Complete commands run normally without extra prompts. Automatic prompting is
terminal-only: scripts and piped input retain the usual help and usage errors.
The existing `aps config` wizard remains explicitly interactive.

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
- `slice/` as captured slicer settings evidence.

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

### Capture slicer settings

Model geometry alone does not reproduce a print. Wall counts, layer height,
nozzle diameter, supports, and filament choice all change the part that comes
off the plate, and recalling them from memory after the fact is unreliable.

`aps slicer capture` reads a saved slicer project (a Bambu Studio or OrcaSlicer
`.3mf`, which embeds `Metadata/project_settings.config`) and records what was
actually used:

```bash
aps slicer capture "$PRODUCT" ~/Documents/watch-stand-v009.3mf \
  --note "Full five-part plate"
```

This writes two files under the product:

```text
slice/0-20mm-standard-printer.yaml           # summarized, validated profile
slice/0-20mm-standard-printer.settings.json  # full normalized settings, checksummed
```

If the project file lives outside the product directory it is copied into
`slice/` so the evidence is preserved with the product. Run
`aps assets inventory` afterwards to record both files.

```bash
aps slicer list "$PRODUCT"
```

A profile records `evidence: captured` only when it came from a real project
file. A hand-written profile must use `evidence: stated`, which marks it as an
assumption rather than proof of how a part was printed. Cite the profile slug
in print reviews and in `aps workflow print-result` evidence.

`aps validate` checks every recorded profile: the referenced project and
settings files must still exist with matching checksums, the printer profile
must exist, and the sliced nozzle diameter must agree with that printer
profile. A slice that contradicts the machine it claims to target is an error,
not a note.

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

The evidence should identify the printed package, the captured slice profile
slug, and the measured result.

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

The Node CLI uses bundled JSON Schema snapshots and additional runtime checks.
Write the bundled schemas into a studio with:

```bash
aps schema write
```

Schemas are written to `schema/`. Stale generated schema files are removed.
When changing manifest models, update the bundled snapshots under
`apps/aps_cli/schema/` and run the Python differential schema test.

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
├── apps/
│   ├── aps_cli/
│   └── engineer_ui/
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
