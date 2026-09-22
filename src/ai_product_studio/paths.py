from __future__ import annotations

import re
from pathlib import Path

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def require_slug(value: str, label: str = "slug") -> str:
    if not SLUG_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must use lowercase kebab-case: {value!r}")
    return value


def find_studio_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "config" / "studio.yaml").is_file():
            return candidate
    raise FileNotFoundError(
        "Could not find AI Product Studio root; expected config/studio.yaml in this directory "
        "or a parent."
    )


def product_line_path(root: Path, product_line: str) -> Path:
    return root / "product-line" / require_slug(product_line, "product line")


def variant_path(root: Path, product_line: str, variant: str) -> Path:
    return product_line_path(root, product_line) / "variant" / require_slug(variant, "variant")


def product_path(root: Path, product_line: str, variant: str, product: str) -> Path:
    return variant_path(root, product_line, variant) / require_slug(product, "product")
