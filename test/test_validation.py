from __future__ import annotations

from pathlib import Path

from ai_product_studio.registry import sync
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant
from ai_product_studio.validation import validate_studio


def test_valid_empty_product_structure(studio_root: Path) -> None:
    create_product_line(studio_root, "line", "Line")
    create_variant(studio_root, "line", "variant", "Variant")
    create_product(studio_root, "line", "variant", "model", "Model")
    sync(studio_root)

    assert validate_studio(studio_root) == []
