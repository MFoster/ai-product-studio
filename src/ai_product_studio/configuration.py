from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.models import (
    MaterialConfiguration,
    MaterialProfile,
    PrinterProfile,
    StudioManifest,
    TemperatureRange,
)

MATERIAL_PRESETS: dict[str, dict[str, object]] = {
    "pla": {
        "name": "PLA",
        "nozzle": (190, 230),
        "bed": (45, 65),
        "minimum_wall_mm": 1.2,
        "shrink": 0.2,
        "notes": ["General-purpose rigid filament with low warping."],
    },
    "petg": {
        "name": "PETG",
        "nozzle": (220, 260),
        "bed": (70, 90),
        "minimum_wall_mm": 1.2,
        "shrink": 0.4,
        "notes": ["Durable filament with good layer adhesion; manage stringing."],
    },
    "abs": {
        "name": "ABS",
        "nozzle": (230, 270),
        "bed": (90, 110),
        "minimum_wall_mm": 1.6,
        "shrink": 0.8,
        "notes": ["Enclosure and ventilation are strongly recommended."],
    },
    "asa": {
        "name": "ASA",
        "nozzle": (240, 280),
        "bed": (90, 110),
        "minimum_wall_mm": 1.6,
        "shrink": 0.8,
        "notes": ["UV-resistant material; enclosure and ventilation are recommended."],
    },
    "tpu": {
        "name": "TPU",
        "nozzle": (210, 240),
        "bed": (30, 60),
        "minimum_wall_mm": 1.2,
        "shrink": 1.0,
        "notes": ["Flexible filament; reduce speed and avoid unsupported thin columns."],
    },
    "nylon": {
        "name": "Nylon",
        "nozzle": (245, 290),
        "bed": (70, 100),
        "minimum_wall_mm": 1.6,
        "shrink": 1.2,
        "notes": ["Dry thoroughly before printing; enclosure may be required."],
    },
    "pc": {
        "name": "Polycarbonate",
        "nozzle": (260, 310),
        "bed": (90, 120),
        "minimum_wall_mm": 1.6,
        "shrink": 1.0,
        "notes": ["High-temperature hotend and enclosure are typically required."],
    },
}


@dataclass(frozen=True)
class ConfigurationDefaults:
    studio_name: str
    printer: PrinterProfile
    materials: list[str]


def parse_material_slugs(value: str) -> list[str]:
    slugs = list(dict.fromkeys(item.strip().lower() for item in value.split(",") if item.strip()))
    if not slugs:
        raise ValueError("Select at least one material type")
    unsupported = sorted(set(slugs) - MATERIAL_PRESETS.keys())
    if unsupported:
        supported = ", ".join(sorted(MATERIAL_PRESETS))
        raise ValueError(
            f"Unsupported material type(s): {', '.join(unsupported)}. Supported values: {supported}"
        )
    return slugs


def material_configuration(slugs: list[str]) -> MaterialConfiguration:
    materials: list[MaterialProfile] = []
    for slug in slugs:
        preset = MATERIAL_PRESETS[slug]
        nozzle_min, nozzle_max = preset["nozzle"]  # type: ignore[misc]
        bed_min, bed_max = preset["bed"]  # type: ignore[misc]
        materials.append(
            MaterialProfile(
                slug=slug,
                name=str(preset["name"]),
                nozzle_temperature_c=TemperatureRange(
                    minimum=int(nozzle_min), maximum=int(nozzle_max)
                ),
                bed_temperature_c=TemperatureRange(minimum=int(bed_min), maximum=int(bed_max)),
                minimum_wall_mm=float(preset["minimum_wall_mm"]),
                shrink_compensation_percent=float(preset["shrink"]),
                notes=list(preset["notes"]),  # type: ignore[arg-type]
            )
        )
    return MaterialConfiguration(materials=materials)


def load_configuration_defaults(root: Path) -> ConfigurationDefaults:
    studio_path = root / "config" / "studio.yaml"
    if studio_path.is_file():
        studio = StudioManifest.model_validate(load_yaml(studio_path))
    else:
        studio = StudioManifest(name="AI Product Studio", default_printer="generic-fdm")

    printer_path = root / "config" / "printer" / f"{studio.default_printer}.yaml"
    if printer_path.is_file():
        printer = PrinterProfile.model_validate(load_yaml(printer_path))
    else:
        printer = PrinterProfile(
            slug="generic-fdm",
            name="Generic FDM Printer",
            build_volume_mm={"x": 220.0, "y": 220.0, "z": 250.0},
            nozzle_diameter_mm=0.4,
            minimum_wall_mm=1.2,
            minimum_detail_mm=0.8,
            supports_multi_material=False,
            max_material_slots=1,
            supported_materials=["pla", "petg"],
        )

    material_path = root / studio.material_config
    if material_path.is_file():
        materials = MaterialConfiguration.model_validate(load_yaml(material_path))
        material_slugs = [material.slug for material in materials.materials]
    else:
        material_slugs = printer.supported_materials or ["pla", "petg"]
    return ConfigurationDefaults(studio.name, printer, material_slugs)


def write_configuration(
    root: Path,
    *,
    studio_name: str,
    printer: PrinterProfile,
    material_slugs: list[str],
) -> tuple[Path, Path, Path]:
    studio_path = root / "config" / "studio.yaml"
    if studio_path.is_file():
        studio = StudioManifest.model_validate(load_yaml(studio_path))
        previous_printer = studio.default_printer
    else:
        studio = StudioManifest(name=studio_name, default_printer=printer.slug)
        previous_printer = None

    studio.name = studio_name
    studio.default_printer = printer.slug
    studio.material_config = "config/material/material.yaml"
    printer.supported_materials = material_slugs

    printer_path = root / "config" / "printer" / f"{printer.slug}.yaml"
    material_path = root / studio.material_config
    dump_yaml(studio_path, studio)
    dump_yaml(printer_path, printer)
    dump_yaml(material_path, material_configuration(material_slugs))

    if previous_printer and previous_printer != printer.slug:
        stale = root / "config" / "printer" / f"{previous_printer}.yaml"
        if stale.is_file():
            stale.unlink()
    return studio_path, printer_path, material_path
