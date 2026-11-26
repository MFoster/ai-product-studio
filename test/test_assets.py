from __future__ import annotations

from pathlib import Path

from ai_product_studio.assets import inventory_product, verify_asset_manifest
from ai_product_studio.config import dump_yaml
from ai_product_studio.models import AssetRecord
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


def test_inventory_excludes_macos_metadata(studio_root: Path) -> None:
    product = _product(studio_root)
    export = product / "export" / "stl" / "part.stl"
    export.write_bytes(b"solid part")
    for directory in (product, product / "source", export.parent):
        (directory / ".DS_Store").write_bytes(b"Finder metadata")

    manifest = inventory_product(product)

    assert [asset.path for asset in manifest.assets] == ["export/stl/part.stl"]
    assert verify_asset_manifest(product, manifest) == []
    assert ".DS_Store" not in (product / "assets.yaml").read_text()


def test_stale_macos_metadata_records_require_reinventory(studio_root: Path) -> None:
    product = _product(studio_root)
    manifest = inventory_product(product)
    manifest.assets.append(
        AssetRecord(
            path="export/.DS_Store",
            kind="export",
            format="none",
            role=".DS_Store",
            sha256="0" * 64,
            size_bytes=1,
        )
    )

    assert verify_asset_manifest(product, manifest) == [
        "macOS metadata is not an asset: export/.DS_Store; run aps assets inventory"
    ]
    (product / "export" / ".DS_Store").write_bytes(b"changed")
    assert verify_asset_manifest(product, manifest) == [
        "macOS metadata is not an asset: export/.DS_Store; run aps assets inventory"
    ]
    assert inventory_product(product).assets == []


def test_reinventory_preserves_authored_metadata_and_refreshes_hashes(studio_root: Path) -> None:
    product = _product(studio_root)
    source = product / "source" / "model.blend"
    source.write_bytes(b"blend-data")
    backup = product / "source" / "model.blend1"
    backup.write_bytes(b"backup")
    manifest = inventory_product(product)
    model_record = next(asset for asset in manifest.assets if asset.path == "source/model.blend")
    model_record.role = "photography-shoot-not-canonical"
    model_record.source = "source/canonical.blend"
    model_record.release_eligible = False
    backup_record = next(asset for asset in manifest.assets if asset.path == "source/model.blend1")
    backup_record.release_eligible = True
    dump_yaml(product / "assets.yaml", manifest)
    source.write_bytes(b"updated blend-data")

    refreshed = inventory_product(product)
    refreshed_model = next(asset for asset in refreshed.assets if asset.path == model_record.path)

    assert refreshed_model.role == model_record.role
    assert refreshed_model.source == model_record.source
    assert refreshed_model.release_eligible is False
    assert refreshed_model.sha256 != model_record.sha256
    assert refreshed_model.size_bytes == len(b"updated blend-data")
    assert not next(
        asset for asset in refreshed.assets if asset.path == "source/model.blend1"
    ).release_eligible
    assert verify_asset_manifest(product, refreshed) == []
