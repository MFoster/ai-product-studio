from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise OSError(f"Unable to read {path}: {exc}") from exc
    try:
        value = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML in {path}: {exc}") from exc
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"Expected a YAML mapping in {path}")
    return value


def dump_yaml(path: Path, value: BaseModel | dict[str, Any]) -> None:
    data = (
        value.model_dump(mode="json", exclude_none=True) if isinstance(value, BaseModel) else value
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=False),
        encoding="utf-8",
    )
