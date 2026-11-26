from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.groups import load_groups, verify_groups
from ai_product_studio.models import AssetKind, AssetManifest, AssetRecord, ProductManifest

IGNORED_NAMES = {"assets.yaml", "workflow.yaml", "product.yaml", "AGENTS.md", ".DS_Store"}


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
    assets_path = product_dir / "assets.yaml"
    existing = (
        AssetManifest.model_validate(load_yaml(assets_path)).assets if assets_path.is_file() else []
    )
    existing_by_path = {asset.path: asset for asset in existing}
    groups = load_groups(product_dir)
    group_errors = verify_groups(product_dir, groups)
    if group_errors:
        raise ValueError("\n".join(group_errors))
    records: list[AssetRecord] = []
    for path in sorted(product_dir.rglob("*")):
        if not path.is_file() or path.name in IGNORED_NAMES or "release" in path.parts:
            continue
        relative = path.relative_to(product_dir)
        suffix = path.suffix.lower().lstrip(".") or "none"
        kind = classify_asset(relative)
        previous = existing_by_path.get(relative.as_posix())
        records.append(
            AssetRecord(
                path=relative.as_posix(),
                kind=kind,
                format=suffix,
                role=previous.role if previous else path.stem,
                sha256=sha256_file(path),
                size_bytes=path.stat().st_size,
                source=previous.source if previous else None,
                release_eligible=kind is not AssetKind.BACKUP
                and (previous.release_eligible if previous else True),
            )
        )
    manifest = AssetManifest(
        product=product_manifest.slug,
        generated_at=datetime.now(UTC),
        assets=records,
        groups=groups,
    )
    dump_yaml(product_dir / "assets.yaml", manifest)
    return manifest


def verify_asset_manifest(product_dir: Path, manifest: AssetManifest) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for asset in manifest.assets:
        if Path(asset.path).name == ".DS_Store":
            errors.append(f"macOS metadata is not an asset: {asset.path}; run aps assets inventory")
            continue
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
    try:
        groups = load_groups(product_dir)
        if groups != manifest.groups:
            errors.append("Asset group metadata is stale; run aps assets inventory")
        paths = {asset.path for asset in manifest.assets}
        for group in groups:
            references = {group.package} | {
                mesh.asset for part in group.parts for mesh in part.meshes
            }
            for reference in sorted(references - paths):
                errors.append(f"Group {group.id}: referenced asset is not inventoried: {reference}")
    except (OSError, ValueError) as exc:
        errors.append(str(exc))
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
