from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.models import (
    AssetManifest,
    ProductManifest,
    ReleaseManifest,
    WorkflowStage,
)
from ai_product_studio.workflow import advance_workflow, load_workflow


def create_release(
    product_dir: Path,
    version: str,
    *,
    approval: str,
    notes: str = "",
) -> Path:
    destination = product_dir / "release" / version / "release.yaml"
    if destination.exists():
        raise FileExistsError(f"Release already exists and is immutable: {destination}")
    workflow = load_workflow(product_dir)
    if workflow.current_stage is not WorkflowStage.PRINT_VALIDATION:
        raise ValueError("Product must be in print-validation before release")
    if workflow.physical_print_status != "passed":
        raise ValueError("A passed physical print is required before release")

    product = ProductManifest.model_validate(load_yaml(product_dir / "product.yaml"))
    assets = AssetManifest.model_validate(load_yaml(product_dir / "assets.yaml"))
    release_assets = {asset.path: asset.sha256 for asset in assets.assets if asset.release_eligible}
    advance_workflow(
        product_dir,
        WorkflowStage.RELEASE,
        note=f"Released {version}",
        approval=approval,
    )
    manifest = ReleaseManifest(
        product=product.slug,
        version=version,
        created_at=datetime.now(UTC),
        printer_profile=product.printer_profile,
        asset_hashes=release_assets,
        validations=[
            "asset checksums recorded",
            "workflow gates satisfied",
            "physical print passed",
        ],
        physical_print_status="passed",
        notes=notes,
    )
    dump_yaml(destination, manifest)
    return destination
