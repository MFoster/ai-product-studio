from __future__ import annotations

import hashlib
import json
import struct
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

import pytest
from pydantic import ValidationError
from typer.testing import CliRunner

from ai_product_studio.assets import inventory_product, verify_asset_manifest
from ai_product_studio.cli import app
from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.groups import load_groups, verify_groups
from ai_product_studio.models import AssetGroup, GroupManifest
from ai_product_studio.packages import GROUP_METADATA, build_group_packages, read_mesh
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant
from ai_product_studio.validation import validate_studio

NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
P = "{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}"


def _stl(path: Path, size=(140, 160, 10), origin=(0, 0, 0)) -> str:
    vertices = [
        origin,
        (origin[0] + size[0], origin[1], origin[2]),
        (origin[0], origin[1] + size[1], origin[2]),
        (origin[0], origin[1], origin[2] + size[2]),
    ]
    triangles = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)]
    data = b"test mesh".ljust(80, b"\0") + struct.pack("<I", len(triangles))
    for triangle in triangles:
        coordinates = [value for index in triangle for value in vertices[index]]
        data += struct.pack("<12fH", 0, 0, 0, *coordinates, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def grouped_product(studio_root: Path) -> Path:
    create_product_line(studio_root, "line", "Line")
    create_variant(studio_root, "line", "variant", "Variant")
    product = create_product(studio_root, "line", "variant", "model", "Model")
    profile_path = studio_root / "config/printer/generic-fdm.yaml"
    profile = load_yaml(profile_path)
    profile.update(supports_multi_material=True, max_material_slots=4)
    dump_yaml(profile_path, profile)
    sha_body = _stl(product / "export/stl/body.stl", origin=(12, 14, -5))
    sha_color = _stl(product / "export/stl/color.stl", size=(10, 10, 3), origin=(15, 17, -4))
    sha_pin = _stl(product / "export/stl/pin.stl", size=(2, 2, 20))
    groups = GroupManifest.model_validate(
        {
            "product": "model",
            "groups": [
                {
                    "id": "folding-corner",
                    "name": "Foundry Corner",
                    "revision": "v1",
                    "description": "Complete corner and service pin",
                    "package": "package/v1/foundry-corner.3mf",
                    "materials": [
                        {"id": "stone", "name": "Ash Stone", "color": "#BBBBBB"},
                        {"id": "metal", "name": "Charcoal", "color": "#222222"},
                    ],
                    "parts": [
                        {
                            "id": "wall",
                            "name": "Wall",
                            "quantity": 2,
                            "meshes": [
                                {
                                    "asset": "export/stl/body.stl",
                                    "material": "stone",
                                    "sha256": sha_body,
                                },
                                {
                                    "asset": "export/stl/color.stl",
                                    "material": "metal",
                                    "sha256": sha_color,
                                },
                            ],
                        },
                        {
                            "id": "pin",
                            "name": "Service Pin",
                            "meshes": [
                                {
                                    "asset": "export/stl/pin.stl",
                                    "material": "metal",
                                    "sha256": sha_pin,
                                },
                            ],
                        },
                    ],
                }
            ],
        }
    )
    dump_yaml(product / "groups.yaml", groups)
    return product


def test_composes_complete_quantity_and_color_preserving_plates(studio_root, grouped_product):
    [path] = build_group_packages(studio_root, grouped_product)
    with ZipFile(path) as archive:
        record = json.loads(archive.read(GROUP_METADATA))
        model = ET.fromstring(archive.read("3D/3dmodel.model"))
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        models = {
            entry: ET.fromstring(archive.read(entry))
            for entry in archive.namelist()
            if entry.startswith("3D/Objects/")
        }
    assert record["group"]["name"] == "Foundry Corner"
    assert len(record["plates"]) == 2
    assert len(model.findall("m:build/m:item", NS)) == 3
    assert len(config.findall("object")) == 3
    assert len(config.findall("plate")) == 2
    assert len(models) == 5
    counts = {}
    for plate in record["plates"]:
        for instance in plate["instances"]:
            counts[instance["part_id"]] = counts.get(instance["part_id"], 0) + 1
            lower, upper = instance["bounds_on_plate_mm"]
            assert lower[0] >= 5 and lower[1] >= 5 and lower[2] == 0
            assert upper[0] <= 215 and upper[1] <= 215
        for index, first in enumerate(plate["instances"]):
            for second in plate["instances"][index + 1 :]:
                a, b = first["bounds_on_plate_mm"], second["bounds_on_plate_mm"]
                assert (
                    a[1][0] + 6 <= b[0][0]
                    or b[1][0] + 6 <= a[0][0]
                    or a[1][1] + 6 <= b[0][1]
                    or b[1][1] + 6 <= a[0][1]
                )
    assert counts == {"wall": 2, "pin": 1}
    for obj in config.findall("object"):
        slots = [entry.attrib["value"] for entry in obj.findall("part/metadata[@key='extruder']")]
        name = obj.find("metadata[@key='name']").attrib["value"]
        assert slots == (["2"] if name == "Service Pin" else ["1", "2"])
    root = model.find("m:resources/m:object", NS)
    children = root.findall("m:components/m:component", NS)
    assert len(children) == 2
    for child in children:
        assert child.attrib["transform"] == "1 0 0 0 1 0 0 0 1 0 0 0"
    color_mesh = models[children[1].attrib[P + "path"].lstrip("/")]
    vertex = color_mesh.find(".//m:vertex", NS)
    assert tuple(float(vertex.attrib[axis]) for axis in ("x", "y", "z")) == (15, 17, -4)
    assert settings["filament_colour"] == ["#BBBBBB", "#222222"]
    assert settings["printer_settings_id"] == ""
    assert settings["print_settings_id"] == ""
    assert "layer_height" not in settings
    assert verify_groups(grouped_product, load_groups(grouped_product)) == []


def test_inventory_exposes_groups_and_rejects_stale_membership(studio_root, grouped_product):
    build_group_packages(studio_root, grouped_product)
    inventory = inventory_product(grouped_product)
    assert inventory.groups[0].name == "Foundry Corner"
    assert inventory.groups[0].parts[0].quantity == 2
    assert verify_asset_manifest(grouped_product, inventory) == []
    definition = load_yaml(grouped_product / "groups.yaml")
    definition["groups"][0]["parts"][0]["quantity"] = 3
    dump_yaml(grouped_product / "groups.yaml", definition)
    errors = verify_asset_manifest(grouped_product, inventory)
    assert "Asset group metadata is stale; run aps assets inventory" in errors
    with pytest.raises(ValueError, match="package metadata is stale"):
        inventory_product(grouped_product)


def test_missing_changed_or_escaping_mesh_is_not_packaged(studio_root, grouped_product):
    mesh = grouped_product / "export/stl/body.stl"
    original = mesh.read_bytes()
    mesh.write_bytes(original + b"changed")
    with pytest.raises(ValueError, match="checksum mismatch"):
        build_group_packages(studio_root, grouped_product)
    mesh.unlink()
    with pytest.raises(ValueError, match="missing mesh"):
        build_group_packages(studio_root, grouped_product)
    outside = studio_root / "outside.stl"
    outside.write_bytes(original)
    mesh.symlink_to(outside)
    with pytest.raises(ValueError, match="escapes product"):
        build_group_packages(studio_root, grouped_product)
    assert not (grouped_product / "package/v1/foundry-corner.3mf").exists()


def test_refuses_overwriting_existing_packages(studio_root, grouped_product):
    [path] = build_group_packages(studio_root, grouped_product)
    before = path.read_bytes()
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        build_group_packages(studio_root, grouped_product)
    assert path.read_bytes() == before


@pytest.mark.parametrize("change", ["oversize", "slots", "unsupported"])
def test_invalid_print_constraints_do_not_leave_output(studio_root, grouped_product, change):
    definition = load_yaml(grouped_product / "groups.yaml")
    group = definition["groups"][0]
    if change == "oversize":
        group["layout"]["margin_mm"] = 100
    elif change == "slots":
        profile_path = studio_root / "config/printer/generic-fdm.yaml"
        profile = load_yaml(profile_path)
        profile["max_material_slots"] = 1
        dump_yaml(profile_path, profile)
    else:
        group["materials"][0]["material"] = "nylon"
    dump_yaml(grouped_product / "groups.yaml", definition)
    with pytest.raises(ValueError, match="cannot fit|material slots|unsupported materials"):
        build_group_packages(studio_root, grouped_product)
    assert not (grouped_product / "package/v1/foundry-corner.3mf").exists()
    assert not list((grouped_product / "package").glob(".aps-groups-*"))


@pytest.mark.parametrize(
    "change",
    [
        "duplicate-group",
        "duplicate-package",
        "duplicate-part",
        "unknown-material",
        "empty-name",
        "parent-path",
        "absolute-path",
        "zero-quantity",
        "fractional-quantity",
        "output-outside-package",
        "duplicate-mesh",
        "infinite-margin",
    ],
)
def test_rejects_ambiguous_or_invalid_group_definitions(grouped_product, change):
    definition = load_yaml(grouped_product / "groups.yaml")
    group = definition["groups"][0]
    if change == "duplicate-group":
        definition["groups"].append(group.copy())
    elif change == "duplicate-package":
        definition["groups"].append({**group, "id": "another-corner"})
    elif change == "duplicate-part":
        group["parts"].append(group["parts"][0].copy())
    elif change == "unknown-material":
        group["parts"][0]["meshes"][0]["material"] = "missing"
    elif change == "empty-name":
        group["name"] = " "
    elif change in {"parent-path", "absolute-path"}:
        group["parts"][0]["meshes"][0]["asset"] = (
            "../escape.stl" if change == "parent-path" else "/tmp/escape.stl"
        )
    elif change in {"zero-quantity", "fractional-quantity"}:
        group["parts"][0]["quantity"] = 0 if change == "zero-quantity" else 1.5
    elif change == "output-outside-package":
        group["package"] = "source/output.3mf"
    elif change == "duplicate-mesh":
        group["parts"][0]["meshes"].append(group["parts"][0]["meshes"][0].copy())
    else:
        group["layout"]["margin_mm"] = float("inf")
    with pytest.raises(ValidationError):
        GroupManifest.model_validate(definition)


def test_validation_checks_groups_without_an_asset_inventory(studio_root, grouped_product):
    errors = validate_studio(studio_root)
    assert any("missing package: package/v1/foundry-corner.3mf" in error for error in errors)
    definition = load_yaml(grouped_product / "groups.yaml")
    definition["product"] = "wrong-product"
    dump_yaml(grouped_product / "groups.yaml", definition)
    assert any("product must be model" in error for error in validate_studio(studio_root))


def test_package_command_and_group_selection(studio_root, grouped_product):
    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "assets",
            "package",
            str(grouped_product),
            "--group",
            "missing",
            "--root",
            str(studio_root),
        ],
    )
    assert result.exit_code == 1
    assert "No asset groups found for missing" in result.output
    result = runner.invoke(
        app,
        [
            "assets",
            "package",
            str(grouped_product),
            "--group",
            "folding-corner",
            "--root",
            str(studio_root),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Built 1 group packages" in result.output


def test_stl_parser_rejects_non_binary_or_corrupt_data(grouped_product):
    group: AssetGroup = load_groups(grouped_product)[0]
    mesh = group.parts[0].meshes[0]
    path = grouped_product / mesh.asset
    path.write_bytes(b"solid ascii STL")
    mesh.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(ValueError, match="binary"):
        read_mesh(grouped_product, mesh)
