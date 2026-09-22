from __future__ import annotations

from pathlib import Path

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.models import (
    PrinterProfile,
    ProductLineManifest,
    ProductManifest,
    StudioManifest,
    VariantManifest,
    WorkflowManifest,
)
from ai_product_studio.paths import product_line_path, product_path, variant_path


class ScaffoldConflictError(FileExistsError):
    pass


def _write_text(path: Path, content: str, *, force: bool, dry_run: bool) -> None:
    if path.exists() and not force:
        raise ScaffoldConflictError(f"Refusing to overwrite existing file: {path}")
    if dry_run:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_manifest(path: Path, model: object, *, force: bool, dry_run: bool) -> None:
    if path.exists() and not force:
        raise ScaffoldConflictError(f"Refusing to overwrite existing file: {path}")
    if not dry_run:
        dump_yaml(path, model)  # type: ignore[arg-type]


def _append_unique(path: Path, model_type: type, field: str, value: str, *, dry_run: bool) -> None:
    if dry_run and not path.exists():
        return
    model = model_type.model_validate(load_yaml(path))
    values = getattr(model, field)
    if value in values or dry_run:
        return
    values.append(value)
    values.sort()
    dump_yaml(path, model)


def initialize_studio(
    destination: Path,
    name: str,
    *,
    force: bool = False,
    dry_run: bool = False,
) -> Path:
    studio_path = destination / "config" / "studio.yaml"
    if studio_path.exists() and not force:
        raise ScaffoldConflictError(f"Studio already exists: {destination}")
    _write_manifest(
        studio_path,
        StudioManifest(name=name, default_printer="generic-fdm"),
        force=force,
        dry_run=dry_run,
    )
    _write_manifest(
        destination / "config" / "printer" / "generic-fdm.yaml",
        PrinterProfile(
            slug="generic-fdm",
            name="Generic FDM Printer",
            build_volume_mm={"x": 220.0, "y": 220.0, "z": 250.0},
            nozzle_diameter_mm=0.4,
            minimum_wall_mm=1.2,
            minimum_detail_mm=0.8,
            supports_ams=False,
            max_ams_colors=1,
        ),
        force=force,
        dry_run=dry_run,
    )
    _write_text(
        destination / "AGENTS.md",
        f"""# {name} agent instructions

Read the nearest `AGENTS.md` and applicable manifests before changing product assets.
Use millimeters for printable geometry. Keep source, export, package, preview, and
release assets separate. Do not claim slicing or physical print success without evidence.
Run registry synchronization, asset inventory, and validation before release.
""",
        force=force,
        dry_run=dry_run,
    )
    if not dry_run:
        for relative in (
            ".github/agents",
            ".github/skills",
            ".github/instructions",
            "product-line",
            "schema",
            "template",
        ):
            (destination / relative).mkdir(parents=True, exist_ok=True)
    return destination


def create_product_line(
    root: Path,
    slug: str,
    name: str,
    *,
    description: str = "",
    force: bool = False,
    dry_run: bool = False,
) -> Path:
    destination = product_line_path(root, slug)
    if destination.exists() and not force:
        raise ScaffoldConflictError(f"Product line already exists: {destination}")

    manifest = ProductLineManifest(slug=slug, name=name, description=description)
    _write_manifest(destination / "product-line.yaml", manifest, force=force, dry_run=dry_run)
    _write_text(
        destination / "AGENTS.md",
        f"""# {name} agent instructions

Read `product-line.yaml` and the active variant and product manifests before editing assets.
Preserve the product line's design language, shared mechanics, naming, and workflow gates.
Product-local agents and skills under `ai/` are authoritative; synchronize them with
`aps registry sync` rather than editing generated root copies.
""",
        force=force,
        dry_run=dry_run,
    )
    for relative in ("brief", "ai/agent", "ai/skill", "variant"):
        if not dry_run:
            (destination / relative).mkdir(parents=True, exist_ok=True)

    studio_path = root / "config" / "studio.yaml"
    if studio_path.exists():
        _append_unique(studio_path, StudioManifest, "product_lines", slug, dry_run=dry_run)
    return destination


def create_variant(
    root: Path,
    product_line: str,
    slug: str,
    name: str,
    *,
    theme: str = "",
    force: bool = False,
    dry_run: bool = False,
) -> Path:
    destination = variant_path(root, product_line, slug)
    if destination.exists() and not force:
        raise ScaffoldConflictError(f"Variant already exists: {destination}")

    manifest = VariantManifest(slug=slug, name=name, theme=theme)
    _write_manifest(destination / "variant.yaml", manifest, force=force, dry_run=dry_run)
    _write_text(
        destination / "AGENTS.md",
        f"""# {name} variant instructions

Read `variant.yaml`, the parent product-line instructions, and each product manifest.
Apply this variant's theme, palette, and constraints consistently across its catalog.
Do not weaken shared mechanical interfaces without recording an explicit product exception.
""",
        force=force,
        dry_run=dry_run,
    )

    line_manifest = product_line_path(root, product_line) / "product-line.yaml"
    _append_unique(line_manifest, ProductLineManifest, "variants", slug, dry_run=dry_run)
    return destination


def create_product(
    root: Path,
    product_line: str,
    variant: str,
    slug: str,
    name: str,
    *,
    summary: str = "",
    force: bool = False,
    dry_run: bool = False,
) -> Path:
    destination = product_path(root, product_line, variant, slug)
    if destination.exists() and not force:
        raise ScaffoldConflictError(f"Product already exists: {destination}")

    _write_manifest(
        destination / "product.yaml",
        ProductManifest(slug=slug, name=name, summary=summary),
        force=force,
        dry_run=dry_run,
    )
    _write_manifest(
        destination / "workflow.yaml",
        WorkflowManifest(product=slug),
        force=force,
        dry_run=dry_run,
    )
    _write_text(
        destination / "AGENTS.md",
        f"""# {name} product instructions

Read `product.yaml`, `workflow.yaml`, `assets.yaml` when present, and all parent
`AGENTS.md` files before changing this product.
Keep canonical editable files in `source/`, generated meshes in `export/`, slicer
packages in `package/`, renders in `preview/`, and immutable versions in `release/`.
Never mark a physical print as passed without recorded test-print evidence.
""",
        force=force,
        dry_run=dry_run,
    )
    for relative in (
        "source",
        "export/stl",
        "package",
        "preview",
        "script",
        "review",
        "release",
    ):
        if not dry_run:
            (destination / relative).mkdir(parents=True, exist_ok=True)

    variant_manifest = variant_path(root, product_line, variant) / "variant.yaml"
    _append_unique(variant_manifest, VariantManifest, "products", slug, dry_run=dry_run)
    return destination
