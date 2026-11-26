"""Capture slicer settings from a real slicer project so prints are reproducible.

A slice profile is deliberately separate from a printer profile: the printer
profile describes what the machine can do, while a slice profile records how a
specific product was actually processed. Only settings read out of a project
file are recorded as captured evidence.
"""

from __future__ import annotations

import json
import re
import shutil
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ai_product_studio.assets import sha256_file
from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.models import PrinterProfile, ProductManifest, SliceProfile

SLICE_DIRNAME = "slice"
PROJECT_SETTINGS_ENTRY = "Metadata/project_settings.config"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug:
        raise ValueError(f"Unable to derive a slug from {value!r}")
    return slug


def slice_dir(product_dir: Path) -> Path:
    return product_dir / SLICE_DIRNAME


def read_project_settings(project_path: Path) -> dict[str, Any]:
    """Extract the flat settings mapping from a Bambu Studio / OrcaSlicer 3MF."""
    if not project_path.is_file():
        raise OSError(f"Project file not found: {project_path}")
    try:
        with zipfile.ZipFile(project_path) as archive:
            names = set(archive.namelist())
            if PROJECT_SETTINGS_ENTRY not in names:
                raise ValueError(
                    f"{project_path} contains no {PROJECT_SETTINGS_ENTRY}; it is a plain model "
                    "3MF, not a saved slicer project"
                )
            payload = archive.read(PROJECT_SETTINGS_ENTRY)
    except zipfile.BadZipFile as exc:
        raise ValueError(f"{project_path} is not a readable 3MF archive: {exc}") from exc
    settings = json.loads(payload.decode("utf-8"))
    if not isinstance(settings, dict):
        raise ValueError(f"{project_path}: {PROJECT_SETTINGS_ENTRY} is not a settings mapping")
    return settings


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _first_float(settings: dict[str, Any], key: str) -> float | None:
    values = _as_list(settings.get(key))
    if not values:
        return None
    try:
        return float(values[0])
    except ValueError:
        return None


def _scalar(settings: dict[str, Any], key: str) -> str | None:
    value = settings.get(key)
    if value is None or isinstance(value, list):
        values = _as_list(value)
        return values[0] if values else None
    text = str(value).strip()
    return text or None


def _truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_settings(settings: dict[str, Any]) -> str:
    """Render the settings as stable JSON so checksums compare across captures."""
    return json.dumps(settings, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def summarize_settings(settings: dict[str, Any]) -> dict[str, Any]:
    nozzles = {value for value in _as_list(settings.get("nozzle_diameter")) if value}
    nozzle = _first_float(settings, "nozzle_diameter")
    layer_height = _first_float(settings, "layer_height")
    first_layer = _first_float(settings, "initial_layer_print_height") or layer_height
    wall_loops = _first_float(settings, "wall_loops")
    missing = [
        key
        for key, value in (
            ("nozzle_diameter", nozzle),
            ("layer_height", layer_height),
            ("wall_loops", wall_loops),
        )
        if value is None
    ]
    if missing:
        raise ValueError(f"Project settings are missing required keys: {', '.join(missing)}")
    notes: list[str] = []
    if len(nozzles) > 1:
        notes.append(f"Project declares multiple nozzle diameters: {', '.join(sorted(nozzles))}")
    return {
        "slicer_version": _scalar(settings, "version"),
        "printer_model": _scalar(settings, "printer_model"),
        "printer_settings_id": _scalar(settings, "printer_settings_id"),
        "print_settings_id": _scalar(settings, "print_settings_id"),
        "filament_settings_ids": _as_list(settings.get("filament_settings_id")),
        "filament_types": _as_list(settings.get("filament_type")),
        "nozzle_diameter_mm": nozzle,
        "layer_height_mm": layer_height,
        "first_layer_height_mm": first_layer,
        "wall_loops": int(wall_loops),
        "sparse_infill_density": _scalar(settings, "sparse_infill_density"),
        "support_enabled": _truthy(settings.get("enable_support")),
        "support_type": _scalar(settings, "support_type"),
        "brim_type": _scalar(settings, "brim_type"),
        "build_plate": _scalar(settings, "curr_bed_type"),
        "notes": notes,
    }


def capture_slice_profile(
    product_dir: Path,
    project_path: Path,
    *,
    slug: str | None = None,
    name: str | None = None,
    note: str | None = None,
    force: bool = False,
) -> tuple[SliceProfile, Path]:
    """Extract a slicer project's settings into a versioned slice profile."""
    product_dir = product_dir.resolve()
    project_path = project_path.resolve()
    product = ProductManifest.model_validate(load_yaml(product_dir / "product.yaml"))
    settings = read_project_settings(project_path)
    summary = summarize_settings(settings)

    derived = slug or slugify(summary["print_settings_id"] or project_path.stem)
    profile_path = slice_dir(product_dir) / f"{derived}.yaml"
    if profile_path.exists() and not force:
        raise ValueError(f"Slice profile already exists: {profile_path}; pass --force to replace")

    slice_dir(product_dir).mkdir(parents=True, exist_ok=True)
    try:
        source_rel = project_path.relative_to(product_dir).as_posix()
    except ValueError:
        stored = slice_dir(product_dir) / f"{derived}{project_path.suffix or '.3mf'}"
        shutil.copy2(project_path, stored)
        source_rel = stored.relative_to(product_dir).as_posix()

    settings_path = slice_dir(product_dir) / f"{derived}.settings.json"
    settings_path.write_text(normalize_settings(settings), encoding="utf-8")

    notes = list(summary.pop("notes"))
    if note:
        notes.append(note)
    profile = SliceProfile(
        slug=derived,
        name=name or summary["print_settings_id"] or derived,
        product=product.slug,
        printer_profile=product.printer_profile,
        evidence="captured",
        recorded_at=datetime.now(UTC),
        source=source_rel,
        source_sha256=sha256_file(product_dir / source_rel),
        settings_file=settings_path.relative_to(product_dir).as_posix(),
        settings_sha256=sha256_file(settings_path),
        notes=notes,
        **summary,
    )
    dump_yaml(profile_path, profile)
    return profile, profile_path


def load_slice_profiles(product_dir: Path) -> list[SliceProfile]:
    directory = slice_dir(product_dir)
    if not directory.is_dir():
        return []
    return [
        SliceProfile.model_validate(load_yaml(path)) for path in sorted(directory.glob("*.yaml"))
    ]


def verify_slice_profile(product_dir: Path, profile: SliceProfile, root: Path) -> list[str]:
    """Check a slice profile's evidence still exists and agrees with the printer."""
    errors: list[str] = []
    for label, relative, checksum in (
        ("project file", profile.source, profile.source_sha256),
        ("settings file", profile.settings_file, profile.settings_sha256),
    ):
        if relative is None:
            continue
        path = product_dir / relative
        if not path.is_file():
            errors.append(f"slice/{profile.slug}: missing {label} {relative}")
        elif checksum and sha256_file(path) != checksum:
            errors.append(f"slice/{profile.slug}: checksum mismatch for {label} {relative}")

    printer_path = root / "config" / "printer" / f"{profile.printer_profile}.yaml"
    if not printer_path.is_file():
        errors.append(f"slice/{profile.slug}: unknown printer profile {profile.printer_profile}")
        return errors
    try:
        printer = PrinterProfile.model_validate(load_yaml(printer_path))
    except (OSError, ValueError) as exc:
        errors.append(f"slice/{profile.slug}: unreadable printer profile: {exc}")
        return errors
    if abs(printer.nozzle_diameter_mm - profile.nozzle_diameter_mm) > 1e-6:
        errors.append(
            f"slice/{profile.slug}: slice nozzle {profile.nozzle_diameter_mm:g} mm contradicts "
            f"printer profile {profile.printer_profile} nozzle {printer.nozzle_diameter_mm:g} mm"
        )
    return errors
