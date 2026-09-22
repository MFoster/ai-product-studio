from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

REQUIRED_CORE_SECTIONS = (
    "## Use this skill when",
    "## Required inputs",
    "## Workflow",
    "## Quality gates",
    "## Output contract",
    "## Do not claim",
)


def read_skill_metadata(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("missing YAML frontmatter")
    try:
        _, raw, _ = text.split("---", 2)
        metadata = yaml.safe_load(raw)
    except (ValueError, yaml.YAMLError) as exc:
        raise ValueError(f"invalid YAML frontmatter: {exc}") from exc
    if not isinstance(metadata, dict):
        raise ValueError("frontmatter must be a mapping")
    return metadata


def validate_skill_library(root: Path) -> list[str]:
    errors: list[str] = []
    skill_root = root / ".github" / "skills"
    if not skill_root.is_dir():
        return errors
    for directory in sorted(path for path in skill_root.iterdir() if path.is_dir()):
        skill_file = directory / "SKILL.md"
        if not skill_file.is_file():
            errors.append(f"{directory}: missing SKILL.md")
            continue
        try:
            metadata = read_skill_metadata(skill_file)
        except (OSError, ValueError) as exc:
            errors.append(f"{skill_file}: {exc}")
            continue
        if metadata.get("name") != directory.name:
            errors.append(f"{skill_file}: frontmatter name must match directory {directory.name!r}")
        description = metadata.get("description")
        if not isinstance(description, str) or not description.strip():
            errors.append(f"{skill_file}: description must be a non-empty string")
    return errors
