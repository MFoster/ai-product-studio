from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from ai_product_studio.assets import verify_asset_manifest
from ai_product_studio.config import load_yaml
from ai_product_studio.models import (
    AssetManifest,
    PrinterProfile,
    ProductLineManifest,
    ProductManifest,
    StudioManifest,
    VariantManifest,
    WorkflowManifest,
)
from ai_product_studio.registry import check as check_registry
from ai_product_studio.skill_library import validate_skill_library


def _validate_file(path: Path, model: type) -> list[str]:
    try:
        model.model_validate(load_yaml(path))
    except (OSError, ValueError, ValidationError) as exc:
        return [f"{path}: {exc}"]
    return []


def validate_studio(root: Path) -> list[str]:
    errors: list[str] = []
    errors.extend(_validate_file(root / "config" / "studio.yaml", StudioManifest))
    for profile in sorted((root / "config" / "printer").glob("*.yaml")):
        errors.extend(_validate_file(profile, PrinterProfile))
    for line in sorted((root / "product-line").glob("*")):
        if not line.is_dir():
            continue
        errors.extend(_validate_file(line / "product-line.yaml", ProductLineManifest))
        if not (line / "AGENTS.md").is_file():
            errors.append(f"{line}: missing AGENTS.md")
        for variant in sorted((line / "variant").glob("*")):
            if not variant.is_dir():
                continue
            errors.extend(_validate_file(variant / "variant.yaml", VariantManifest))
            if not (variant / "AGENTS.md").is_file():
                errors.append(f"{variant}: missing AGENTS.md")
            for product in sorted(variant.iterdir()):
                if not product.is_dir():
                    continue
                if not (product / "product.yaml").is_file():
                    continue
                errors.extend(_validate_file(product / "product.yaml", ProductManifest))
                errors.extend(_validate_file(product / "workflow.yaml", WorkflowManifest))
                if not (product / "AGENTS.md").is_file():
                    errors.append(f"{product}: missing AGENTS.md")
                assets_path = product / "assets.yaml"
                if assets_path.is_file():
                    try:
                        manifest = AssetManifest.model_validate(load_yaml(assets_path))
                        errors.extend(
                            f"{product}: {error}"
                            for error in verify_asset_manifest(product, manifest)
                        )
                    except (OSError, ValueError, ValidationError) as exc:
                        errors.append(f"{assets_path}: {exc}")
    errors.extend(check_registry(root))
    errors.extend(validate_skill_library(root))
    return errors
