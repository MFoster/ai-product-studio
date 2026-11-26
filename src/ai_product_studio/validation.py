from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from ai_product_studio.assets import verify_asset_manifest
from ai_product_studio.config import load_yaml
from ai_product_studio.groups import load_groups, verify_groups
from ai_product_studio.models import (
    AssetManifest,
    MaterialConfiguration,
    PrinterProfile,
    ProductLineManifest,
    ProductManifest,
    SliceProfile,
    StudioManifest,
    VariantManifest,
    WorkflowManifest,
)
from ai_product_studio.registry import check as check_registry
from ai_product_studio.skill_library import validate_skill_library
from ai_product_studio.slicer import slice_dir, verify_slice_profile


def _validate_file(path: Path, model: type) -> list[str]:
    try:
        model.model_validate(load_yaml(path))
    except (OSError, ValueError, ValidationError) as exc:
        return [f"{path}: {exc}"]
    return []


def validate_studio(root: Path) -> list[str]:
    errors: list[str] = []
    studio_path = root / "config" / "studio.yaml"
    errors.extend(_validate_file(studio_path, StudioManifest))
    material_path = root / "config" / "material" / "material.yaml"
    if studio_path.is_file():
        try:
            configured_path = load_yaml(studio_path).get("material_config")
            if isinstance(configured_path, str):
                material_path = root / configured_path
        except (OSError, ValueError):
            pass
    errors.extend(_validate_file(material_path, MaterialConfiguration))
    material_slugs: set[str] = set()
    if material_path.is_file():
        try:
            material_config = MaterialConfiguration.model_validate(load_yaml(material_path))
            material_slugs = {material.slug for material in material_config.materials}
        except (OSError, ValueError, ValidationError):
            pass
    for profile in sorted((root / "config" / "printer").glob("*.yaml")):
        errors.extend(_validate_file(profile, PrinterProfile))
        try:
            printer = PrinterProfile.model_validate(load_yaml(profile))
            missing = sorted(set(printer.supported_materials) - material_slugs)
            if missing:
                errors.append(
                    f"{profile}: supported materials missing from material config: "
                    f"{', '.join(missing)}"
                )
        except (OSError, ValueError, ValidationError):
            pass
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
                try:
                    errors.extend(
                        f"{product}: {error}"
                        for error in verify_groups(product, load_groups(product))
                    )
                except (OSError, ValueError) as exc:
                    errors.append(f"{product}: {exc}")
                for profile_path in sorted(slice_dir(product).glob("*.yaml")):
                    errors.extend(_validate_file(profile_path, SliceProfile))
                    try:
                        profile = SliceProfile.model_validate(load_yaml(profile_path))
                    except (OSError, ValueError, ValidationError):
                        continue
                    errors.extend(
                        f"{product}: {error}"
                        for error in verify_slice_profile(product, profile, root)
                    )
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
