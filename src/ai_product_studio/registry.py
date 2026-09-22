from __future__ import annotations

import hashlib
import shutil
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.paths import require_slug


@dataclass(frozen=True)
class RegistryEntry:
    kind: str
    source: Path
    destination: Path
    checksum: str


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _frontmatter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"Missing YAML frontmatter: {path}")
    try:
        _, raw, _ = text.split("---", 2)
        data = yaml.safe_load(raw)
    except (ValueError, yaml.YAMLError) as exc:
        raise ValueError(f"Invalid YAML frontmatter in {path}: {exc}") from exc
    if not isinstance(data, dict) or not data.get("name") or not data.get("description"):
        raise ValueError(f"Frontmatter must include name and description: {path}")
    return data


def discover(root: Path) -> list[RegistryEntry]:
    entries: list[RegistryEntry] = []
    destinations: dict[Path, Path] = {}
    for line_dir in sorted((root / "product-line").glob("*")):
        if not line_dir.is_dir():
            continue
        line = require_slug(line_dir.name, "product line")
        for source in sorted((line_dir / "ai" / "agent").glob("*.agent.md")):
            _frontmatter(source)
            destination = root / ".github" / "agents" / f"{line}--{source.name}"
            if destination in destinations:
                raise ValueError(f"Registry collision: {source} and {destinations[destination]}")
            destinations[destination] = source
            entries.append(RegistryEntry("agent", source, destination, _checksum(source)))
        for skill_file in sorted((line_dir / "ai" / "skill").glob("*/SKILL.md")):
            metadata = _frontmatter(skill_file)
            local_name = require_slug(skill_file.parent.name, "skill")
            registered_name = (
                local_name if local_name.startswith(f"{line}-") else f"{line}-{local_name}"
            )
            if metadata["name"] != registered_name:
                raise ValueError(
                    f"Skill name must be {registered_name!r} for registry synchronization: "
                    f"{skill_file}"
                )
            for source in sorted(skill_file.parent.rglob("*")):
                if not source.is_file():
                    continue
                relative = source.relative_to(skill_file.parent)
                destination = root / ".github" / "skills" / registered_name / relative
                if destination in destinations:
                    raise ValueError(
                        f"Registry collision: {source} and {destinations[destination]}"
                    )
                destinations[destination] = source
                entries.append(RegistryEntry("skill", source, destination, _checksum(source)))
    return entries


def _index_path(root: Path) -> Path:
    studio = load_yaml(root / "config" / "studio.yaml")
    return root / studio.get("registry_index", ".aps/registry.yaml")


def sync(root: Path, *, dry_run: bool = False) -> list[RegistryEntry]:
    entries = discover(root)
    index_path = _index_path(root)
    previous = load_yaml(index_path).get("entries", []) if index_path.exists() else []
    current_destinations = {entry.destination.relative_to(root).as_posix() for entry in entries}

    for old in previous:
        relative = old.get("destination")
        if not isinstance(relative, str) or relative in current_destinations:
            continue
        stale = (root / relative).resolve()
        if root.resolve() not in stale.parents:
            raise ValueError(f"Refusing to prune path outside studio root: {stale}")
        if not dry_run and stale.is_file():
            stale.unlink()
            if stale.parent.name != "agents":
                with suppress(OSError):
                    stale.parent.rmdir()

    for entry in entries:
        if dry_run:
            continue
        entry.destination.parent.mkdir(parents=True, exist_ok=True)
        if not entry.destination.exists() or _checksum(entry.destination) != entry.checksum:
            shutil.copy2(entry.source, entry.destination)

    index = {
        "schema_version": "1.0",
        "entries": [
            {
                "kind": entry.kind,
                "source": entry.source.relative_to(root).as_posix(),
                "destination": entry.destination.relative_to(root).as_posix(),
                "sha256": entry.checksum,
            }
            for entry in entries
        ],
    }
    if not dry_run:
        dump_yaml(index_path, index)
    return entries


def check(root: Path) -> list[str]:
    errors: list[str] = []
    entries = discover(root)
    index_path = _index_path(root)
    if not index_path.is_file():
        if not entries:
            return errors
        return ["Registry index is missing; run `aps registry sync`"]
    indexed = {
        item["destination"]: item
        for item in load_yaml(index_path).get("entries", [])
        if isinstance(item, dict) and "destination" in item
    }
    for entry in entries:
        relative = entry.destination.relative_to(root).as_posix()
        if not entry.destination.is_file():
            errors.append(f"Missing registered {entry.kind}: {relative}")
        elif _checksum(entry.destination) != entry.checksum:
            errors.append(f"Stale registered {entry.kind}: {relative}")
        elif indexed.get(relative, {}).get("sha256") != entry.checksum:
            errors.append(f"Stale registry index entry: {relative}")
    return errors
