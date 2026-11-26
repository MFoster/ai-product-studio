# Contributing

Contributions that improve the CLI, validation, templates, documentation, and
general-purpose 3D-print skills are welcome.

## Development setup

```bash
git clone <repository-url> ai-product-studio
cd ai-product-studio
npm ci
```

## Before submitting a change

```bash
npm test
npm run lint
npm run format:check
npm run typecheck
STUDIO="$(mktemp -d)"
./node_modules/.bin/aps init "$STUDIO" --name "Validation Studio"
./node_modules/.bin/aps schema write --root "$STUDIO"
diff -ru packages/contracts/schema "$STUDIO/schema"
./node_modules/.bin/aps validate --root "$STUDIO"
npm run build --workspace=engineer_ui
```

Use `npm run aps --` for the Node CLI. Both apps consume the local
`@mfoster/aps-contracts` workspace under `packages/contracts`; its JSON Schemas
are canonical and its declarations share manifest and assembly types.
Regression fixtures retain independent legacy expectations, not a live oracle.
Review fixture changes as contract changes; do not regenerate them from the
implementation under test. Terminal checks use the POSIX `script` utility.

Python is optional and limited to Blender SDK checks and Spec Kit tooling.
When changing `template/blender/`, run:

```bash
uv run --group blender pytest -q
uv run --group blender ruff check template/blender test/test_bambu_package.py
uv run --group blender ruff format --check template/blender test/test_bambu_package.py
```

Spec Kit's tracked
skills and project files complement, rather than replace, the studio's
product-line agents and skills. Machine-local Spec Kit state remains ignored.
Run studio operations against a separate checkout with `APS_STUDIO_ROOT` or
`--root`; do not commit personal catalogs or printer configuration here.

## Contribution guidelines

- Keep the repository product-neutral. Product catalogs and proprietary assets
  belong in downstream clones, not this template repository.
- Preserve the singular custom directory convention described in the README.
- Preserve required GitHub conventions such as `.github/agents`,
  `.github/skills`, `.github/instructions`, and `.github/workflows`.
- Add or update tests for behavior changes.
- Keep migrations generic; do not add a migration tied to one private catalog.
- Do not commit credentials, personal paths, generated registry state, virtual
  environments, or test output.
- Clearly distinguish geometry validation, package validation, slice review,
  and physical print validation.

## Adding a global skill

Create:

```text
.github/skills/<skill-name>/SKILL.md
```

The frontmatter `name` must match the directory. Include a narrow trigger,
required inputs, workflow, quality gates, output contract, and explicit claims
the skill cannot make. Add its directory to the framework allowlist in
`.gitignore`, then update `doc/SKILL_LIBRARY.md` and its tests. Add new generic
agents to the corresponding allowlist as well. Product-specific capabilities
belong in the separate studio, not the framework allowlist.

## Adding application behavior

Update canonical schemas and shared types in `packages/contracts`, surface errors explicitly, preserve non-destructive
defaults, and expose file-writing previews through `--dry-run` when practical.

## Publishing the toolchain

The publishable npm workspace is `@mfoster/ai-product-studio` under `apps/aps_cli`.
Its package includes the CLI, production UI, schemas, and a reviewed capability
allowlist in `scripts/build-toolchain.mjs`. Add generic capabilities to that list
as well as the framework Git allowlist. Do not copy entire local AI registries
into a release.

The private contracts workspace is bundled into this single published package;
consumers do not need a second registry package. `prepack` materializes its
declared files for npm bundling, and `postpack` removes that temporary copy.
Workspace development resolves the canonical package directly.

Build and exercise an archive before merging:

```bash
npm run pack:toolchain
node scripts/test-toolchain-package.mjs "$PWD/mfoster-ai-product-studio-0.1.0.tgz"
```

Merging to `main` publishes the package and creates a GitHub release automatically.
The source version is the base; the workflow adds its run number minus one to
the patch component, without committing version changes. Failed runs may leave
gaps; reruns retain their version and verify an existing package's source commit.
For a new major/minor series, update the package base and root lockfile together.
Run `npm run test:release` when changing versioning or publication behavior.
Consumer authentication requires `read:packages`; never commit an actual token.
Keep synchronization explicit, preserve studio-owned instructions, and test
local edits, collisions, stale ownership, and path safety when changing it.
