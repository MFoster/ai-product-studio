"""Write one physical object with aligned, filament-assigned parts per Bambu 3MF.

This model handoff deliberately contains no printer, process, or calibrated
filament preset. Project filament numbers are not physical AMS tray numbers.
"""

from __future__ import annotations

import json
import math
import struct
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PRODUCTION = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"
RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships"
IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0"
MATRIX = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"


def xml(element: ET.Element) -> bytes:
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def metadata(parent: ET.Element, key: str, value: str) -> None:
    ET.SubElement(parent, "metadata", key=key, value=value)


def validate_parts(parts: list[dict], palette: list[dict]) -> None:
    if not parts or not 1 <= len(palette) <= 4:
        raise ValueError("Provide parts and between one and four project filaments")
    groups = [entry["group"] for entry in palette]
    if len(set(groups)) != len(groups):
        raise ValueError("Palette groups must be unique")
    names = [part["name"] for part in parts]
    if len(set(names)) != len(names):
        raise ValueError("Part names must be unique")
    for entry in palette:
        color = entry["color"]
        if len(color) != 7 or color[0] != "#":
            raise ValueError(f"Expected #RRGGBB color: {color}")
        int(color[1:], 16)
    for part in parts:
        if part["material_group"] not in groups:
            raise ValueError(f"Unknown material group: {part['material_group']}")
        vertices, triangles = part["vertices"], part["triangles"]
        if not vertices or not triangles:
            raise ValueError(f"Empty mesh: {part['name']}")
        if any(len(v) != 3 or not all(math.isfinite(x) for x in v) for v in vertices):
            raise ValueError(f"Invalid vertex: {part['name']}")
        for triangle in triangles:
            if (
                len(triangle) != 3
                or len(set(triangle)) != 3
                or any(not isinstance(i, int) or not 0 <= i < len(vertices) for i in triangle)
            ):
                raise ValueError(f"Invalid triangle: {part['name']}")


def write_package(
    output: Path,
    name: str,
    parts: list[dict],
    palette: list[dict],
    *,
    printer_volume: tuple[float, float, float] = (256, 256, 261),
    nozzle_diameter: float = 0.4,
) -> None:
    """Keep parts aligned in one build item, not independent auto-arranged objects."""
    validate_parts(parts, palette)
    if output.exists():
        raise FileExistsError(output)
    slots = {entry["group"]: index + 1 for index, entry in enumerate(palette)}
    model = ET.Element(
        "model",
        {
            "xmlns": CORE,
            "xmlns:p": PRODUCTION,
            "requiredextensions": "p",
            "unit": "millimeter",
            "xml:lang": "en-US",
        },
    )
    # Bambu ignores project filament colors unless Application has this prefix.
    # This is its compatibility marker; actual authorship is recorded separately.
    ET.SubElement(model, "metadata", name="Application").text = "BambuStudio-02.09.01.70"
    ET.SubElement(model, "metadata", name="Designer").text = "AI Product Studio"
    ET.SubElement(model, "metadata", name="aps:Generator").text = "package_bambu_3mf.py"
    ET.SubElement(model, "metadata", name="BambuStudio:3mfVersion").text = "1"
    ET.SubElement(model, "metadata", name="Title").text = name
    ET.SubElement(model, "metadata", name="Description").text = (
        "One physical part, aligned color volumes. Select printer/material presets "
        "and map project filaments to AMS before slicing."
    )
    resources = ET.SubElement(model, "resources")
    mesh_files = {}
    root_id = len(parts) + 2
    config = ET.Element("config")
    obj_config = ET.SubElement(config, "object", id=str(root_id))
    metadata(obj_config, "name", name)
    metadata(obj_config, "extruder", str(slots[parts[0]["material_group"]]))
    for index, part in enumerate(parts, start=2):
        slot = slots[part["material_group"]]
        child = ET.Element("model", xmlns=CORE, unit="millimeter")
        child_resources = ET.SubElement(child, "resources")
        materials = ET.SubElement(child_resources, "basematerials", id="1")
        for entry in palette:
            ET.SubElement(materials, "base", name=entry["name"], displaycolor=entry["color"] + "FF")
        obj = ET.SubElement(
            child_resources,
            "object",
            id=str(index),
            type="model",
            name=part["name"],
            pid="1",
            pindex=str(slot - 1),
        )
        mesh = ET.SubElement(obj, "mesh")
        vertices = ET.SubElement(mesh, "vertices")
        for vertex in part["vertices"]:
            ET.SubElement(
                vertices,
                "vertex",
                **dict(
                    zip(["x", "y", "z"], (format(float(x), ".9g") for x in vertex), strict=True)
                ),
            )
        triangles = ET.SubElement(mesh, "triangles")
        for a, b, c in part["triangles"]:
            ET.SubElement(triangles, "triangle", v1=str(a), v2=str(b), v3=str(c))
        ET.SubElement(child, "build")
        mesh_files[f"3D/Objects/object_{index}.model"] = xml(child)
        part_config = ET.SubElement(obj_config, "part", id=str(index), subtype="normal_part")
        metadata(part_config, "name", part["name"])
        metadata(part_config, "extruder", str(slot))
        metadata(part_config, "matrix", MATRIX)
        metadata(part_config, "source_file", part["name"] + ".stl")
        metadata(part_config, "source_object_id", "0")
        metadata(part_config, "source_volume_id", str(index - 2))
        ET.SubElement(
            part_config,
            "mesh_stat",
            face_count=str(len(part["triangles"])),
            edges_fixed="0",
            degenerate_facets="0",
            facets_removed="0",
            facets_reversed="0",
            backwards_edges="0",
        )
    assembly = ET.SubElement(resources, "object", id=str(root_id), type="model", name=name)
    components = ET.SubElement(assembly, "components")
    for index in range(2, root_id):
        ET.SubElement(
            components,
            "component",
            objectid=str(index),
            transform=IDENTITY,
            **{"p:path": f"/3D/Objects/object_{index}.model"},
        )
    build = ET.SubElement(model, "build")
    ET.SubElement(build, "item", objectid=str(root_id), transform=IDENTITY, printable="1")
    plate = ET.SubElement(config, "plate")
    metadata(plate, "plater_id", "1")
    metadata(plate, "plater_name", name)
    metadata(plate, "locked", "false")
    instance = ET.SubElement(plate, "model_instance")
    metadata(instance, "object_id", str(root_id))
    metadata(instance, "instance_id", "0")
    metadata(instance, "identify_id", "1")
    settings = {
        "printer_settings_id": "",
        "print_settings_id": "",
        "printer_model": "",
        "nozzle_diameter": [str(nozzle_diameter)],
        "printable_height": str(printer_volume[2]),
        "printable_area": [
            "0x0",
            f"{printer_volume[0]}x0",
            f"{printer_volume[0]}x{printer_volume[1]}",
            f"0x{printer_volume[1]}",
        ],
        "inherits_group": [""] * (len(palette) + 2),
        "different_settings_to_system": [""] * (len(palette) + 2),
        "filament_is_support": ["0"] * len(palette),
        "filament_colour": [entry["color"] for entry in palette],
        "filament_type": ["PLA"] * len(palette),
        "filament_settings_id": ["Generic PLA"] * len(palette),
        "filament_diameter": ["1.75"] * len(palette),
    }
    content = ET.Element("Types", xmlns=CONTENT_TYPES)
    for extension, kind in [
        ("rels", "application/vnd.openxmlformats-package.relationships+xml"),
        ("model", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"),
        ("config", "application/octet-stream"),
    ]:
        ET.SubElement(content, "Default", Extension=extension, ContentType=kind)
    relationships = ET.Element("Relationships", xmlns=RELATIONSHIPS)
    ET.SubElement(
        relationships,
        "Relationship",
        Id="rel-model",
        Target="/3D/3dmodel.model",
        Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
    )
    model_relationships = ET.Element("Relationships", xmlns=RELATIONSHIPS)
    for index in range(2, root_id):
        ET.SubElement(
            model_relationships,
            "Relationship",
            Id=f"rel-part-{index}",
            Target=f"/3D/Objects/object_{index}.model",
            Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "x", compression=ZIP_DEFLATED) as archive:
        for path, data in {
            "[Content_Types].xml": xml(content),
            "_rels/.rels": xml(relationships),
            "3D/3dmodel.model": xml(model),
            "3D/_rels/3dmodel.model.rels": xml(model_relationships),
            "Metadata/model_settings.config": xml(config),
            "Metadata/project_settings.config": json.dumps(settings, indent=2).encode(),
            **mesh_files,
        }.items():
            archive.writestr(path, data)


def write_stl(output: Path, part: dict) -> None:
    """Preserve each color mesh's common object-local millimeter coordinates."""
    vertices = part["vertices"]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream:
        stream.write(b"AI Product Studio aligned color component".ljust(80, b"\0"))
        stream.write(struct.pack("<I", len(part["triangles"])))
        for triangle in part["triangles"]:
            a, b, c = [vertices[index] for index in triangle]
            u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
            normal = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ]
            length = math.sqrt(sum(x * x for x in normal))
            if length <= 1e-10:
                raise ValueError(f"Degenerate triangle in {part['name']}")
            stream.write(struct.pack("<12fH", *(x / length for x in normal), *a, *b, *c, 0))
