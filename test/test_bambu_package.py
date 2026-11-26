"""Physical-object grouping and filament assignments in the standalone exporter."""

import json
import runpy
import struct
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

import pytest

EXPORTER = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "template/blender/package_bambu_3mf.py")
)
NS = {"m": EXPORTER["CORE"]}
PALETTE = [
    {"group": "structure", "name": "Stone & masonry", "color": "#AAA699"},
    {"group": "accent", "name": "Bronze", "color": "#557760"},
]


def part(name, group, offset=0):
    return {
        "name": name,
        "material_group": group,
        "vertices": [[offset, 0, 0], [offset + 1, 0, 0], [offset, 1, 0], [offset, 0, 1]],
        "triangles": [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    }


def test_one_object_preserves_aligned_color_parts_and_extruders(tmp_path):
    path = tmp_path / "wall.3mf"
    parts = [part("wall-stone", "structure"), part("wall-accent", "accent", 0.25)]
    EXPORTER["write_package"](path, "Wall & buttress", parts, PALETTE)
    with ZipFile(path) as archive:
        model = ET.fromstring(archive.read("3D/3dmodel.model"))
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        children = {
            entry: ET.fromstring(archive.read(entry))
            for entry in archive.namelist()
            if entry.startswith("3D/Objects/")
        }
    assert model.attrib["unit"] == "millimeter"
    items = model.findall("m:build/m:item", NS)
    assert len(items) == 1
    root = model.find(f"m:resources/m:object[@id='{items[0].attrib['objectid']}']", NS)
    assert root.attrib["name"] == "Wall & buttress"
    components = root.findall("m:components/m:component", NS)
    assert len(components) == 2
    for index, component in enumerate(components):
        child_path = component.attrib[f"{{{EXPORTER['PRODUCTION']}}}path"].lstrip("/")
        mesh = children[child_path].find(
            f"m:resources/m:object[@id='{component.attrib['objectid']}']", NS
        )
        assert component.attrib["transform"] == EXPORTER["IDENTITY"]
        assert mesh.attrib["name"] == parts[index]["name"]
        assert int(mesh.attrib["pindex"]) == index
        vertex = mesh.find("m:mesh/m:vertices/m:vertex", NS)
        assert float(vertex.attrib["x"]) == parts[index]["vertices"][0][0]
    assert [
        entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")
    ] == ["1", "2"]
    assert settings["filament_colour"] == ["#AAA699", "#557760"]
    assert len(settings["inherits_group"]) == len(PALETTE) + 2
    assert len(settings["different_settings_to_system"]) == len(PALETTE) + 2
    assert len(settings["filament_is_support"]) == len(PALETTE)
    assert settings["printer_model"] == ""
    assert settings["printer_settings_id"] == ""
    assert settings["print_settings_id"] == ""
    assert "layer_height" not in settings
    assert "wall_loops" not in settings
    with pytest.raises(FileExistsError):
        EXPORTER["write_package"](path, "Wall", parts, PALETTE)


def test_single_color_uses_its_global_slot_at_object_level(tmp_path):
    path = tmp_path / "pin.3mf"
    EXPORTER["write_package"](path, "Pin", [part("pin-accent", "accent")], PALETTE)
    with ZipFile(path) as archive:
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
    assert config.find("object/metadata[@key='extruder']").attrib["value"] == "2"
    assert config.find("object/part/metadata[@key='extruder']").attrib["value"] == "2"


@pytest.mark.parametrize("change", ["unknown-group", "bad-index", "nan", "empty", "duplicate"])
def test_rejects_invalid_parts_before_writing(tmp_path, change):
    parts = [part("stone", "structure")]
    if change == "unknown-group":
        parts[0]["material_group"] = "missing"
    elif change == "bad-index":
        parts[0]["triangles"][0][0] = 4
    elif change == "nan":
        parts[0]["vertices"][0][0] = float("nan")
    elif change == "empty":
        parts = []
    else:
        parts *= 2
    path = tmp_path / "invalid.3mf"
    with pytest.raises(ValueError):
        EXPORTER["write_package"](path, "Invalid", parts, PALETTE)
    assert not path.exists()


def test_component_stl_keeps_registration_and_refuses_overwrite(tmp_path):
    path = tmp_path / "part.stl"
    mesh = part("offset", "accent", 10)
    EXPORTER["write_stl"](path, mesh)
    data = path.read_bytes()
    assert struct.unpack_from("<I", data, 80)[0] == 4
    assert len(data) == 84 + 50 * 4
    assert struct.unpack_from("<3f", data, 84 + 12) == (10, 0, 0)
    with pytest.raises(FileExistsError):
        EXPORTER["write_stl"](path, mesh)
