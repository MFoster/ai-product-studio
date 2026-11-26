from __future__ import annotations

import json
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from ai_product_studio.config import load_yaml
from ai_product_studio.models import AssetGroup, GroupManifest, ProductManifest

GROUPS_FILE = "groups.yaml"


def resolve_group_asset(product_dir: Path, relative: str) -> Path:
    root = product_dir.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"Group asset escapes product directory: {relative}")
    return path


def load_groups(product_dir: Path) -> list[AssetGroup]:
    path = product_dir / GROUPS_FILE
    if not path.is_file():
        return []
    manifest = GroupManifest.model_validate(load_yaml(path))
    product = ProductManifest.model_validate(load_yaml(product_dir / "product.yaml"))
    if manifest.product != product.slug:
        raise ValueError(f"{path}: product must be {product.slug}")
    return manifest.groups


def verify_groups(
    product_dir: Path, groups: list[AssetGroup], *, require_packages: bool = True
) -> list[str]:
    from ai_product_studio.assets import sha256_file

    errors = []
    for group in groups:
        for part in group.parts:
            for mesh in part.meshes:
                try:
                    path = resolve_group_asset(product_dir, mesh.asset)
                except ValueError as exc:
                    errors.append(str(exc))
                    continue
                if not path.is_file():
                    errors.append(f"Group {group.id}/{part.id}: missing mesh: {mesh.asset}")
                elif sha256_file(path) != mesh.sha256:
                    errors.append(
                        f"Group {group.id}/{part.id}: mesh checksum mismatch: {mesh.asset}"
                    )
        try:
            package = resolve_group_asset(product_dir, group.package)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if require_packages and not package.is_file():
            errors.append(f"Group {group.id}: missing package: {group.package}")
        elif require_packages:
            try:
                with ZipFile(package) as archive:
                    embedded = json.loads(archive.read("Metadata/aps_group.json"))
                if embedded["group"] != group.model_dump(mode="json"):
                    errors.append(
                        f"Group {group.id}: package metadata is stale; build a new package revision"
                    )
            except (OSError, BadZipFile, KeyError, ValueError, TypeError) as exc:
                errors.append(f"Group {group.id}: invalid group package {group.package}: {exc}")
    return errors
