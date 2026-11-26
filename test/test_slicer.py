from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from ai_product_studio.config import load_yaml
from ai_product_studio.models import SliceProfile
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant
from ai_product_studio.slicer import capture_slice_profile, load_slice_profiles
from ai_product_studio.validation import validate_studio

SETTINGS = {
    "printer_model": "Bambu Lab X2D",
    "printer_settings_id": "Bambu Lab X2D 0.4 nozzle",
    "print_settings_id": "0.20mm Standard @BBL X2D",
    "filament_settings_id": ["Generic PLA @BBL X2D 0.4 nozzle"],
    "filament_type": ["PLA"],
    "nozzle_diameter": ["0.4"],
    "layer_height": "0.2",
    "initial_layer_print_height": "0.2",
    "wall_loops": "2",
    "sparse_infill_density": "15%",
    "enable_support": "1",
    "support_type": "tree(auto)",
    "brim_type": "auto_brim",
    "curr_bed_type": "Textured PEI Plate",
    "version": "02.08.02.61",
}


def write_project(path: Path, settings: dict[str, object] | None = None) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("3D/3dmodel.model", "<model/>")
        archive.writestr(
            "Metadata/project_settings.config", json.dumps(settings if settings else SETTINGS)
        )
    return path


@pytest.fixture
def product(studio_root: Path) -> Path:
    create_product_line(studio_root, "line", "Line")
    create_variant(studio_root, "line", "variant", "Variant")
    return create_product(studio_root, "line", "variant", "model", "Model")


def test_capture_records_settings_and_evidence(studio_root: Path, product: Path) -> None:
    project = write_project(studio_root / "project.3mf")
    profile, profile_path = capture_slice_profile(product, project, note="First slice")

    assert profile.slug == "0-20mm-standard-bbl-x2d"
    assert profile.evidence == "captured"
    assert profile.printer_model == "Bambu Lab X2D"
    assert profile.nozzle_diameter_mm == 0.4
    assert profile.layer_height_mm == 0.2
    assert profile.wall_loops == 2
    assert profile.support_enabled is True
    assert profile.notes == ["First slice"]

    # The project lived outside the product, so it is preserved alongside the profile.
    assert profile.source == "slice/0-20mm-standard-bbl-x2d.3mf"
    assert (product / profile.source).is_file()
    settings = json.loads((product / profile.settings_file).read_text(encoding="utf-8"))
    assert settings["print_settings_id"] == "0.20mm Standard @BBL X2D"
    assert SliceProfile.model_validate(load_yaml(profile_path)) == profile
    assert [item.slug for item in load_slice_profiles(product)] == [profile.slug]


def test_capture_refuses_to_overwrite_without_force(studio_root: Path, product: Path) -> None:
    project = write_project(studio_root / "project.3mf")
    capture_slice_profile(product, project)
    with pytest.raises(ValueError, match="already exists"):
        capture_slice_profile(product, project)
    capture_slice_profile(product, project, force=True)


def test_capture_rejects_a_plain_model_3mf(studio_root: Path, product: Path) -> None:
    path = studio_root / "model.3mf"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("3D/3dmodel.model", "<model/>")
    with pytest.raises(ValueError, match="not a saved slicer project"):
        capture_slice_profile(product, path)


def test_capture_requires_core_settings(studio_root: Path, product: Path) -> None:
    settings = dict(SETTINGS)
    del settings["layer_height"]
    project = write_project(studio_root / "partial.3mf", settings)
    with pytest.raises(ValueError, match="missing required keys"):
        capture_slice_profile(product, project)


def test_validation_detects_a_contradictory_nozzle(studio_root: Path, product: Path) -> None:
    settings = dict(SETTINGS)
    settings["nozzle_diameter"] = ["0.6"]
    project = write_project(studio_root / "wide.3mf", settings)
    capture_slice_profile(product, project)
    errors = validate_studio(studio_root)
    assert any("contradicts" in error for error in errors)


def test_validation_detects_tampered_slice_evidence(studio_root: Path, product: Path) -> None:
    project = write_project(studio_root / "project.3mf")
    profile, _ = capture_slice_profile(product, project)
    (product / profile.settings_file).write_text("{}\n", encoding="utf-8")
    errors = validate_studio(studio_root)
    assert any("checksum mismatch" in error for error in errors)
