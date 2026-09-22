from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.models import AssetKind, AssetManifest, AssetRecord, ProductManifest

IGNORED_NAMES = {"assets.yaml", "workflow.yaml", "product.yaml", "AGENTS.md"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def classify_asset(relative: Path) -> AssetKind:
    if relative.parts[0] == "source":
        return AssetKind.BACKUP if relative.suffix.lower() == ".blend1" else AssetKind.SOURCE
    if relative.parts[0] == "export":
        return AssetKind.EXPORT
    if relative.parts[0] == "package":
        return AssetKind.PACKAGE
    if relative.parts[0] == "preview":
        return AssetKind.PREVIEW
    return AssetKind.DOCUMENT


def inventory_product(product_dir: Path) -> AssetManifest:
    product_manifest = ProductManifest.model_validate(load_yaml(product_dir / "product.yaml"))
    records: list[AssetRecord] = []
    for path in sorted(product_dir.rglob("*")):
        if not path.is_file() or path.name in IGNORED_NAMES or "release" in path.parts:
            continue
        relative = path.relative_to(product_dir)
        suffix = path.suffix.lower().lstrip(".") or "none"
        kind = classify_asset(relative)
        records.append(
            AssetRecord(
                path=relative.as_posix(),
                kind=kind,
                format=suffix,
                role=path.stem,
                sha256=sha256_file(path),
                size_bytes=path.stat().st_size,
                source=None,
                release_eligible=kind is not AssetKind.BACKUP,
            )
        )
    manifest = AssetManifest(
        product=product_manifest.slug,
        generated_at=datetime.now(UTC),
        assets=records,
    )
    dump_yaml(product_dir / "assets.yaml", manifest)
    return manifest


def verify_asset_manifest(product_dir: Path, manifest: AssetManifest) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for asset in manifest.assets:
        if asset.path in seen:
            errors.append(f"Duplicate asset record: {asset.path}")
            continue
        seen.add(asset.path)
        path = product_dir / asset.path
        if not path.is_file():
            errors.append(f"Missing asset: {asset.path}")
            continue
        if path.stat().st_size != asset.size_bytes:
            errors.append(f"Size mismatch: {asset.path}")
        if sha256_file(path) != asset.sha256:
            errors.append(f"Checksum mismatch: {asset.path}")
    return errors


def inventory_legacy_assets(source_root: Path, output: Path) -> dict[str, object]:
    extensions = {".blend", ".blend1", ".stl", ".3mf", ".png"}
    records: list[dict[str, object]] = []
    for path in sorted(source_root.iterdir()):
        if not path.is_file() or path.suffix.lower() not in extensions:
            continue
        stem = path.name.split(".", 1)[0]
        candidate = stem.split("_", 1)[0].split("-", 1)[0].lower()
        records.append(
            {
                "path": path.name,
                "format": path.suffix.lower().lstrip("."),
                "size_bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "candidate_product_line": candidate,
                "action": "unmanaged",
            }
        )
    report: dict[str, object] = {
        "schema_version": "1.0",
        "source": str(source_root.resolve()),
        "generated_at": datetime.now(UTC).isoformat(),
        "assets": records,
    }
    dump_yaml(output, report)
    return report
