from __future__ import annotations

from pathlib import Path

import pytest

from ai_product_studio.config import load_yaml
from ai_product_studio.scaffolding import (
    ScaffoldConflictError,
    create_product,
    create_product_line,
    create_variant,
    initialize_studio,
)


def test_scaffolds_hierarchy_and_updates_parents(studio_root: Path) -> None:
    create_product_line(studio_root, "winter-village", "Winter Village")
    create_variant(studio_root, "winter-village", "2027", "2027 Collection")
    product = create_product(studio_root, "winter-village", "2027", "clock-tower", "Clock Tower")

    assert product.relative_to(studio_root).as_posix() == (
        "product-line/winter-village/variant/2027/clock-tower"
    )
    assert (product / "AGENTS.md").is_file()
    assert (product / "source").is_dir()
    assert not (product.parent / "products").exists()
    assert load_yaml(studio_root / "config" / "studio.yaml")["product_lines"] == ["winter-village"]
    assert load_yaml(studio_root / "product-line" / "winter-village" / "product-line.yaml")[
        "variants"
    ] == ["2027"]


def test_scaffolding_refuses_overwrite(studio_root: Path) -> None:
    create_product_line(studio_root, "winter-village", "Winter Village")
    with pytest.raises(ScaffoldConflictError):
        create_product_line(studio_root, "winter-village", "Replacement")


def test_dry_run_writes_nothing(studio_root: Path) -> None:
    destination = create_product_line(studio_root, "dry-run-line", "Dry Run", dry_run=True)
    assert not destination.exists()
    assert load_yaml(studio_root / "config" / "studio.yaml")["product_lines"] == []


def test_initializes_new_studio(tmp_path: Path) -> None:
    destination = tmp_path / "new-studio"
    initialize_studio(destination, "New Studio")
    assert load_yaml(destination / "config" / "studio.yaml")["name"] == "New Studio"
    assert (destination / "config" / "printer" / "generic-fdm.yaml").is_file()
    assert (destination / "AGENTS.md").is_file()
