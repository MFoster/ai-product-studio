from __future__ import annotations

from pathlib import Path

from ai_product_studio.assets import inventory_product, verify_asset_manifest
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant


def _product(studio_root: Path) -> Path:
    create_product_line(studio_root, "line", "Line")
    create_variant(studio_root, "line", "variant", "Variant")
    return create_product(studio_root, "line", "variant", "model", "Model")


def test_inventory_and_checksum_validation(studio_root: Path) -> None:
    product = _product(studio_root)
    source = product / "source" / "model.blend"
    source.write_bytes(b"blend-data")
    export = product / "export" / "stl" / "part.stl"
    export.write_bytes(b"solid part")

    manifest = inventory_product(product)
    assert len(manifest.assets) == 2
    assert verify_asset_manifest(product, manifest) == []

    export.write_bytes(b"changed")
    assert verify_asset_manifest(product, manifest) == [
        "Size mismatch: export/stl/part.stl",
        "Checksum mismatch: export/stl/part.stl",
    ]
