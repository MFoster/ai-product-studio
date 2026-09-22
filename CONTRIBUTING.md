# Contributing

Contributions that improve the CLI, validation, templates, documentation, and
general-purpose 3D-print skills are welcome.

## Development setup

```bash
git clone <repository-url> ai-product-studio
cd ai-product-studio
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Before submitting a change

```bash
.venv/bin/ruff format .
.venv/bin/ruff check .
.venv/bin/pytest -q
.venv/bin/aps schema write
.venv/bin/aps validate
git diff --exit-code schema
```

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
the skill cannot make. Update `doc/SKILL_LIBRARY.md` and its tests.

## Adding application behavior

Use typed manifest models, surface errors explicitly, preserve non-destructive
defaults, and expose file-writing previews through `--dry-run` when practical.
