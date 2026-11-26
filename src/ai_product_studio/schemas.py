from __future__ import annotations

import json
from pathlib import Path

from ai_product_studio.models import (
    AssetManifest,
    GroupManifest,
    MaterialConfiguration,
    PrinterProfile,
    ProductLineManifest,
    ProductManifest,
    ReleaseManifest,
    SliceProfile,
    StudioManifest,
    VariantManifest,
    WorkflowManifest,
)

SCHEMAS = {
    "studio": StudioManifest,
    "product-line": ProductLineManifest,
    "variant": VariantManifest,
    "product": ProductManifest,
    "asset": AssetManifest,
    "group": GroupManifest,
    "material": MaterialConfiguration,
    "workflow": WorkflowManifest,
    "printer": PrinterProfile,
    "slice": SliceProfile,
    "release": ReleaseManifest,
}


def write_schemas(root: Path) -> list[Path]:
    destination = root / "schema"
    destination.mkdir(parents=True, exist_ok=True)
    expected = {f"{name}.schema.json" for name in SCHEMAS}
    for stale in destination.glob("*.schema.json"):
        if stale.name not in expected:
            stale.unlink()
    written: list[Path] = []
    for name, model in SCHEMAS.items():
        path = destination / f"{name}.schema.json"
        path.write_text(
            json.dumps(model.model_json_schema(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written.append(path)
    return written
