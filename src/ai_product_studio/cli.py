from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ai_product_studio.assets import inventory_legacy_assets, inventory_product
from ai_product_studio.configuration import (
    MATERIAL_PRESETS,
    load_configuration_defaults,
    parse_material_slugs,
    write_configuration,
)
from ai_product_studio.models import PrinterProfile, WorkflowStage
from ai_product_studio.paths import find_studio_root
from ai_product_studio.registry import check as check_registry
from ai_product_studio.registry import sync as sync_registry
from ai_product_studio.release import create_release
from ai_product_studio.scaffolding import (
    create_product,
    create_product_line,
    create_variant,
    initialize_studio,
)
from ai_product_studio.schemas import write_schemas
from ai_product_studio.validation import validate_studio
from ai_product_studio.workflow import advance_workflow, load_workflow, record_print_result

app = typer.Typer(no_args_is_help=True, help="Manage AI-first printable product lines.")
product_line_app = typer.Typer(no_args_is_help=True)
variant_app = typer.Typer(no_args_is_help=True)
product_app = typer.Typer(no_args_is_help=True)
registry_app = typer.Typer(no_args_is_help=True)
assets_app = typer.Typer(no_args_is_help=True)
workflow_app = typer.Typer(no_args_is_help=True)
schema_app = typer.Typer(no_args_is_help=True)
release_app = typer.Typer(no_args_is_help=True)

app.add_typer(product_line_app, name="product-line")
app.add_typer(variant_app, name="variant")
app.add_typer(product_app, name="product")
app.add_typer(registry_app, name="registry")
app.add_typer(assets_app, name="assets")
app.add_typer(workflow_app, name="workflow")
app.add_typer(schema_app, name="schema")
app.add_typer(release_app, name="release")

RootOption = Annotated[
    Path | None,
    typer.Option("--root", help="Studio root; defaults to discovery from the current directory."),
]


def _root(value: Path | None) -> Path:
    return value.resolve() if value else find_studio_root()


def _fail(exc: Exception) -> None:
    typer.echo(f"Error: {exc}", err=True)
    raise typer.Exit(1) from exc


@app.command("config")
def configure(
    root: RootOption = None,
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Write without final confirmation.")] = (
        False
    ),
) -> None:
    """Interactively configure the studio printer and material profiles."""
    try:
        base = _root(root)
        defaults = load_configuration_defaults(base)
        typer.echo("Configure AI Product Studio")
        typer.echo(f"Supported material presets: {', '.join(sorted(MATERIAL_PRESETS))}")

        studio_name = typer.prompt("Studio name", default=defaults.studio_name)
        printer_slug = typer.prompt("Printer profile slug", default=defaults.printer.slug)
        printer_name = typer.prompt("Printer display name", default=defaults.printer.name)
        build_x = typer.prompt(
            "Build volume X (mm)", default=defaults.printer.build_volume_mm["x"], type=float
        )
        build_y = typer.prompt(
            "Build volume Y (mm)", default=defaults.printer.build_volume_mm["y"], type=float
        )
        build_z = typer.prompt(
            "Build volume Z (mm)", default=defaults.printer.build_volume_mm["z"], type=float
        )
        nozzle = typer.prompt(
            "Nozzle diameter (mm)", default=defaults.printer.nozzle_diameter_mm, type=float
        )
        minimum_wall = typer.prompt(
            "Minimum wall thickness (mm)",
            default=defaults.printer.minimum_wall_mm,
            type=float,
        )
        minimum_detail = typer.prompt(
            "Minimum printable detail (mm)",
            default=defaults.printer.minimum_detail_mm,
            type=float,
        )
        supports_multi_material = typer.confirm(
            "Supports an automated multi-material system?",
            default=defaults.printer.supports_multi_material,
        )
        max_material_slots = (
            typer.prompt(
                "Maximum simultaneous material/color slots",
                default=max(defaults.printer.max_material_slots, 2),
                type=int,
            )
            if supports_multi_material
            else 1
        )
        slicer = typer.prompt("Preferred slicer", default=defaults.printer.slicer)
        package_format = typer.prompt(
            "Preferred package format (3mf or stl)",
            default=defaults.printer.package_format,
        ).lower()
        material_input = typer.prompt(
            "Material types (comma-separated)",
            default=",".join(defaults.materials),
        )
        materials = parse_material_slugs(material_input)
        printer = PrinterProfile(
            slug=printer_slug,
            name=printer_name,
            build_volume_mm={"x": build_x, "y": build_y, "z": build_z},
            nozzle_diameter_mm=nozzle,
            minimum_wall_mm=minimum_wall,
            minimum_detail_mm=minimum_detail,
            supports_multi_material=supports_multi_material,
            max_material_slots=max_material_slots,
            supported_materials=materials,
            slicer=slicer,
            package_format=package_format,
        )

        typer.echo("")
        typer.echo(f"Studio: {studio_name}")
        typer.echo(
            f"Printer: {printer.name} ({printer.slug}), {build_x:g} x {build_y:g} x {build_z:g} mm"
        )
        typer.echo(
            f"Nozzle: {nozzle:g} mm; materials: {', '.join(materials)}; package: {package_format}"
        )
        if not yes and not typer.confirm("Write this configuration?", default=True):
            typer.echo("Configuration unchanged")
            return
        paths = write_configuration(
            base,
            studio_name=studio_name,
            printer=printer,
            material_slugs=materials,
        )
        typer.echo("Configuration written:")
        for path in paths:
            typer.echo(f"- {path.relative_to(base)}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@app.command("init")
def init(
    destination: Annotated[Path, typer.Argument()] = Path("."),
    name: Annotated[str, typer.Option("--name")] = "AI Product Studio",
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    try:
        path = initialize_studio(destination.resolve(), name, dry_run=dry_run, force=force)
        typer.echo(f"{'Would initialize' if dry_run else 'Initialized'} {path}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@product_line_app.command("create")
def product_line_create(
    slug: str,
    name: Annotated[str, typer.Option("--name")],
    description: Annotated[str, typer.Option("--description")] = "",
    root: RootOption = None,
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    try:
        path = create_product_line(
            _root(root), slug, name, description=description, dry_run=dry_run, force=force
        )
        typer.echo(f"{'Would create' if dry_run else 'Created'} {path}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@variant_app.command("create")
def variant_create(
    product_line: str,
    slug: str,
    name: Annotated[str, typer.Option("--name")],
    theme: Annotated[str, typer.Option("--theme")] = "",
    root: RootOption = None,
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    try:
        path = create_variant(
            _root(root),
            product_line,
            slug,
            name,
            theme=theme,
            dry_run=dry_run,
            force=force,
        )
        typer.echo(f"{'Would create' if dry_run else 'Created'} {path}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@product_app.command("create")
def product_create(
    product_line: str,
    variant: str,
    slug: str,
    name: Annotated[str, typer.Option("--name")],
    summary: Annotated[str, typer.Option("--summary")] = "",
    root: RootOption = None,
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    try:
        path = create_product(
            _root(root),
            product_line,
            variant,
            slug,
            name,
            summary=summary,
            dry_run=dry_run,
            force=force,
        )
        typer.echo(f"{'Would create' if dry_run else 'Created'} {path}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@registry_app.command("sync")
def registry_sync(
    root: RootOption = None,
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
) -> None:
    try:
        entries = sync_registry(_root(root), dry_run=dry_run)
        typer.echo(f"{'Would synchronize' if dry_run else 'Synchronized'} {len(entries)} entries")
    except (OSError, ValueError) as exc:
        _fail(exc)


@registry_app.command("check")
def registry_check(root: RootOption = None) -> None:
    try:
        errors = check_registry(_root(root))
    except (OSError, ValueError) as exc:
        _fail(exc)
        return
    if errors:
        for error in errors:
            typer.echo(f"ERROR {error}", err=True)
        raise typer.Exit(1)
    typer.echo("Registry is synchronized")


@assets_app.command("inventory")
def assets_inventory(
    product_path: Path,
    root: RootOption = None,
) -> None:
    try:
        base = _root(root)
        path = product_path if product_path.is_absolute() else base / product_path
        manifest = inventory_product(path.resolve())
        typer.echo(f"Inventoried {len(manifest.assets)} assets")
    except (OSError, ValueError) as exc:
        _fail(exc)


@assets_app.command("legacy-inventory")
def assets_legacy_inventory(
    source: Path,
    output: Annotated[Path, typer.Option("--output")] = Path("report/legacy-assets.yaml"),
    root: RootOption = None,
) -> None:
    try:
        base = _root(root)
        destination = output if output.is_absolute() else base / output
        report = inventory_legacy_assets(source.resolve(), destination.resolve())
        typer.echo(f"Inventoried {len(report['assets'])} unmanaged assets")
    except (OSError, ValueError) as exc:
        _fail(exc)


@workflow_app.command("status")
def workflow_status(product_path: Path, root: RootOption = None) -> None:
    try:
        base = _root(root)
        path = product_path if product_path.is_absolute() else base / product_path
        workflow = load_workflow(path.resolve())
        typer.echo(
            f"{workflow.product}: {workflow.current_stage.value}; "
            f"print={workflow.physical_print_status}; blockers={len(workflow.blockers)}"
        )
    except (OSError, ValueError) as exc:
        _fail(exc)


@workflow_app.command("advance")
def workflow_advance(
    product_path: Path,
    stage: WorkflowStage,
    note: Annotated[str, typer.Option("--note")],
    approval: Annotated[str | None, typer.Option("--approval")] = None,
    root: RootOption = None,
) -> None:
    try:
        base = _root(root)
        path = product_path if product_path.is_absolute() else base / product_path
        workflow = advance_workflow(path.resolve(), stage, note=note, approval=approval)
        typer.echo(f"Advanced {workflow.product} to {workflow.current_stage.value}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@workflow_app.command("print-result")
def workflow_print_result(
    product_path: Path,
    status: str,
    evidence: Annotated[str, typer.Option("--evidence")],
    root: RootOption = None,
) -> None:
    try:
        base = _root(root)
        path = product_path if product_path.is_absolute() else base / product_path
        workflow = record_print_result(path.resolve(), status, evidence=evidence)
        typer.echo(f"Recorded physical print status: {workflow.physical_print_status}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@schema_app.command("write")
def schema_write(root: RootOption = None) -> None:
    try:
        paths = write_schemas(_root(root))
        typer.echo(f"Wrote {len(paths)} schemas")
    except OSError as exc:
        _fail(exc)


@release_app.command("create")
def release_create(
    product_path: Path,
    version: str,
    approval: Annotated[str, typer.Option("--approval")],
    notes: Annotated[str, typer.Option("--notes")] = "",
    root: RootOption = None,
) -> None:
    try:
        base = _root(root)
        path = product_path if product_path.is_absolute() else base / product_path
        release_path = create_release(path.resolve(), version, approval=approval, notes=notes)
        typer.echo(f"Created immutable release manifest {release_path}")
    except (OSError, ValueError) as exc:
        _fail(exc)


@app.command("validate")
def validate(root: RootOption = None) -> None:
    try:
        errors = validate_studio(_root(root))
    except (OSError, ValueError) as exc:
        _fail(exc)
        return
    if errors:
        for error in errors:
            typer.echo(f"ERROR {error}", err=True)
        raise typer.Exit(1)
    typer.echo("Studio validation passed")
