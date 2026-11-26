"""Metadata-driven, unsliced Bambu 3MF assembly packages."""

from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from ai_product_studio.config import load_yaml
from ai_product_studio.groups import load_groups, resolve_group_asset, verify_groups
from ai_product_studio.models import (
    AssetGroup,
    GroupMesh,
    GroupPart,
    PrinterProfile,
    ProductManifest,
)

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PRODUCTION = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships"
MODEL_RELATIONSHIP = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0"
MATRIX = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"
GROUP_METADATA = "Metadata/aps_group.json"


@dataclass
class Mesh:
    source: GroupMesh
    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]


@dataclass
class Part:
    spec: GroupPart
    meshes: list[Mesh]
    lower: list[float]
    size: list[float]


def read_mesh(product_dir: Path, source: GroupMesh) -> Mesh:
    path = resolve_group_asset(product_dir, source.asset)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != source.sha256:
        raise ValueError(f"Mesh checksum mismatch: {source.asset}")
    if len(data) < 84:
        raise ValueError(f"Expected a binary millimeter STL: {source.asset}")
    count = struct.unpack_from("<I", data, 80)[0]
    if not count or len(data) != 84 + 50 * count:
        raise ValueError(f"Invalid binary STL triangle count: {source.asset}")
    vertices = []
    indices = {}
    triangles = []
    edges = Counter()
    winding = Counter()
    volume = 0.0
    for offset in range(84, len(data), 50):
        values = struct.unpack_from("<12fH", data, offset)
        coordinates = [tuple(values[start : start + 3]) for start in (3, 6, 9)]
        if not all(math.isfinite(value) for vertex in coordinates for value in vertex):
            raise ValueError(f"Non-finite STL geometry: {source.asset}")
        a, b, c = coordinates
        u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
        normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ]
        if sum(value * value for value in normal) <= 1e-20:
            raise ValueError(f"Degenerate STL triangle: {source.asset}")
        triangle = []
        for coordinate in coordinates:
            if coordinate not in indices:
                indices[coordinate] = len(vertices)
                vertices.append(coordinate)
            triangle.append(indices[coordinate])
        triangles.append(tuple(triangle))
        for first, second in [
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ]:
            key = tuple(sorted([first, second]))
            edges[key] += 1
            winding[key] += 1 if first < second else -1
        volume += (
            a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
        ) / 6
    if any(count != 2 for count in edges.values()) or any(winding.values()) or volume <= 0:
        raise ValueError(f"STL must be closed with outward consistent winding: {source.asset}")
    return Mesh(source, vertices, triangles)


def read_parts(product_dir: Path, group: AssetGroup) -> list[Part]:
    result = []
    for part in group.parts:
        meshes = [read_mesh(product_dir, mesh) for mesh in part.meshes]
        vertices = [vertex for mesh in meshes for vertex in mesh.vertices]
        lower = [min(vertex[axis] for vertex in vertices) for axis in range(3)]
        upper = [max(vertex[axis] for vertex in vertices) for axis in range(3)]
        result.append(Part(part, meshes, lower, [upper[i] - lower[i] for i in range(3)]))
    return result


def plan_plates(group: AssetGroup, parts: list[Part], printer: PrinterProfile) -> list[list[dict]]:
    """First-fit shelves; translate whole rigid parts, never individual color meshes."""
    width, depth, height = (printer.build_volume_mm[axis] for axis in ("x", "y", "z"))
    margin, gap = group.layout.margin_mm, group.layout.spacing_mm
    plates: list[list[dict]] = []
    shelves: list[list[dict]] = []
    for part in sorted(parts, key=lambda p: (-p.size[1], -p.size[0], p.spec.id)):
        if (
            part.size[0] > width - 2 * margin
            or part.size[1] > depth - 2 * margin
            or part.size[2] > height
        ):
            raise ValueError(
                f"Group {group.id}/{part.spec.id} cannot fit the configured print volume"
            )
        for copy in range(1, part.spec.quantity + 1):
            placed = False
            for plate_index, rows in enumerate(shelves):
                row = next(
                    (
                        row
                        for row in rows
                        if part.size[1] <= row["height"]
                        and row["x"] + part.size[0] <= width - margin
                    ),
                    None,
                )
                if row is None:
                    y = rows[-1]["y"] + rows[-1]["height"] + gap
                    if y + part.size[1] <= depth - margin:
                        row = {"x": margin, "y": y, "height": part.size[1]}
                        rows.append(row)
                if row is not None:
                    plates[plate_index].append(
                        {
                            "part": part,
                            "copy": copy,
                            "x": row["x"],
                            "y": row["y"],
                        }
                    )
                    row["x"] += part.size[0] + gap
                    placed = True
                    break
            if not placed:
                shelves.append(
                    [
                        {
                            "x": margin + part.size[0] + gap,
                            "y": margin,
                            "height": part.size[1],
                        }
                    ]
                )
                plates.append([{"part": part, "copy": copy, "x": margin, "y": margin}])
    return plates


def _xml(element: ET.Element) -> bytes:
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def _meta(parent: ET.Element, key: str, value: str | int) -> None:
    ET.SubElement(parent, "metadata", key=key, value=str(value))


def write_group_package(
    output: Path, product: str, group: AssetGroup, parts: list[Part], printer: PrinterProfile
) -> None:
    plates = plan_plates(group, parts, printer)
    columns = math.ceil(math.sqrt(len(plates)))
    width, depth = (printer.build_volume_mm[axis] for axis in ("x", "y"))
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
    # Bambu requires this compatibility marker to load project color assignments.
    for key, value in {
        "Application": "BambuStudio-02.09.01.70",
        "BambuStudio:3mfVersion": "1",
        "Designer": "AI Product Studio",
        "aps:Generator": "aps assets package",
        "Title": group.name,
        "Description": group.description,
        "aps:GroupId": group.id,
        "aps:Revision": group.revision,
    }.items():
        ET.SubElement(model, "metadata", name=key).text = value
    resources = ET.SubElement(model, "resources")
    build = ET.SubElement(model, "build")
    config = ET.Element("config")
    relations = ET.Element("Relationships", xmlns=RELATIONSHIPS)
    files = {}
    slots = {material.id: index + 1 for index, material in enumerate(group.materials)}
    material_names = {material.id: material.name for material in group.materials}
    next_id = 2
    plate_records = []
    for plate_index, instances in enumerate(plates):
        origin = [(plate_index % columns) * width * 1.2, -(plate_index // columns) * depth * 1.2, 0]
        plate_records.append(
            {
                "id": plate_index + 1,
                "name": f"{group.name} - Plate {plate_index + 1}",
                "origin_mm": origin,
                "instances": [],
            }
        )
        plate_config = ET.Element("plate")
        _meta(plate_config, "plater_id", plate_index + 1)
        _meta(plate_config, "plater_name", plate_records[-1]["name"])
        _meta(plate_config, "locked", "false")
        for instance in instances:
            part = instance["part"]
            mesh_ids = []
            mesh_records = []
            name = part.spec.name
            if part.spec.quantity > 1:
                name += f" ({instance['copy']})"
            for mesh in part.meshes:
                mesh_id = next_id
                next_id += 1
                mesh_ids.append(mesh_id)
                child = ET.Element("model", xmlns=CORE, unit="millimeter")
                child_resources = ET.SubElement(child, "resources")
                color_mesh = ET.SubElement(
                    child_resources,
                    "object",
                    id=str(mesh_id),
                    type="model",
                    name=f"{name} - {material_names[mesh.source.material]}",
                )
                geometry = ET.SubElement(color_mesh, "mesh")
                vertices = ET.SubElement(geometry, "vertices")
                for vertex in mesh.vertices:
                    ET.SubElement(
                        vertices,
                        "vertex",
                        **dict(
                            zip(
                                ("x", "y", "z"),
                                (format(value, ".9g") for value in vertex),
                                strict=True,
                            )
                        ),
                    )
                triangles = ET.SubElement(geometry, "triangles")
                for a, b, c in mesh.triangles:
                    ET.SubElement(triangles, "triangle", v1=str(a), v2=str(b), v3=str(c))
                ET.SubElement(child, "build")
                model_path = f"3D/Objects/object_{mesh_id}.model"
                files[model_path] = _xml(child)
                ET.SubElement(
                    relations,
                    "Relationship",
                    Id=f"rel-{mesh_id}",
                    Target="/" + model_path,
                    Type=MODEL_RELATIONSHIP,
                )
                mesh_records.append(
                    {
                        **mesh.source.model_dump(),
                        "object_id": mesh_id,
                        "name": color_mesh.attrib["name"],
                        "triangles": len(mesh.triangles),
                        "project_filament": slots[mesh.source.material],
                    }
                )
            root_id = next_id
            next_id += 1
            root = ET.SubElement(resources, "object", id=str(root_id), type="model", name=name)
            components = ET.SubElement(root, "components")
            obj_config = ET.SubElement(config, "object", id=str(root_id))
            _meta(obj_config, "name", name)
            _meta(obj_config, "extruder", slots[part.meshes[0].source.material])
            for mesh, mesh_id in zip(part.meshes, mesh_ids, strict=True):
                ET.SubElement(
                    components,
                    "component",
                    objectid=str(mesh_id),
                    transform=IDENTITY,
                    **{"p:path": f"/3D/Objects/object_{mesh_id}.model"},
                )
                volume = ET.SubElement(obj_config, "part", id=str(mesh_id), subtype="normal_part")
                _meta(volume, "name", f"{name} - {material_names[mesh.source.material]}")
                _meta(volume, "extruder", slots[mesh.source.material])
                _meta(volume, "matrix", MATRIX)
                _meta(volume, "source_file", Path(mesh.source.asset).name)
            local = [instance["x"] - part.lower[0], instance["y"] - part.lower[1], -part.lower[2]]
            translation = [local[axis] + origin[axis] for axis in range(3)]
            transform = "1 0 0 0 1 0 0 0 1 " + " ".join(format(v, ".12g") for v in translation)
            ET.SubElement(build, "item", objectid=str(root_id), transform=transform, printable="1")
            placement = ET.SubElement(plate_config, "model_instance")
            _meta(placement, "object_id", root_id)
            _meta(placement, "instance_id", 0)
            _meta(placement, "identify_id", root_id)
            plate_records[-1]["instances"].append(
                {
                    "part_id": part.spec.id,
                    "copy": instance["copy"],
                    "object_id": root_id,
                    "name": name,
                    "translation_mm": translation,
                    "bounds_on_plate_mm": [
                        [instance["x"], instance["y"], 0],
                        [instance["x"] + part.size[0], instance["y"] + part.size[1], part.size[2]],
                    ],
                    "meshes": mesh_records,
                }
            )
        config.append(plate_config)
    settings = {
        "printer_settings_id": "",
        "print_settings_id": "",
        "printer_model": "",
        "nozzle_diameter": [str(printer.nozzle_diameter_mm)],
        "printable_height": str(printer.build_volume_mm["z"]),
        "printable_area": ["0x0", f"{width}x0", f"{width}x{depth}", f"0x{depth}"],
        "inherits_group": [""] * (len(group.materials) + 2),
        "different_settings_to_system": [""] * (len(group.materials) + 2),
        "filament_is_support": ["0"] * len(group.materials),
        "filament_colour": [material.color for material in group.materials],
        "filament_type": [material.material.upper() for material in group.materials],
        "filament_settings_id": [
            f"Generic {material.material.upper()}" for material in group.materials
        ],
        "filament_diameter": ["1.75"] * len(group.materials),
    }
    content = ET.Element(
        "Types", xmlns="http://schemas.openxmlformats.org/package/2006/content-types"
    )
    for extension, kind in [
        ("rels", "application/vnd.openxmlformats-package.relationships+xml"),
        ("model", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"),
        ("config", "application/octet-stream"),
        ("json", "application/json"),
    ]:
        ET.SubElement(content, "Default", Extension=extension, ContentType=kind)
    package_relations = ET.Element("Relationships", xmlns=RELATIONSHIPS)
    ET.SubElement(
        package_relations,
        "Relationship",
        Id="rel-model",
        Target="/3D/3dmodel.model",
        Type=MODEL_RELATIONSHIP,
    )
    group_record = {
        "schema_version": "1.0",
        "product": product,
        "group": group.model_dump(mode="json"),
        "printer": printer.model_dump(mode="json"),
        "plates": plate_records,
        "validation": "unsliced-model-layout",
        "limitations": [
            "Layout reserves bounding-box gaps/margins, not support/brim/purge space",
            "Source orientations are preserved, not physically qualified",
            "Select actual printer/process/filament presets and AMS trays before slicing",
            "No slicing, fit, assembly, load or physical-print qualification is asserted",
        ],
    }
    files.update(
        {
            "[Content_Types].xml": _xml(content),
            "_rels/.rels": _xml(package_relations),
            "3D/3dmodel.model": _xml(model),
            "3D/_rels/3dmodel.model.rels": _xml(relations),
            "Metadata/model_settings.config": _xml(config),
            "Metadata/project_settings.config": json.dumps(settings, indent=2).encode(),
            GROUP_METADATA: json.dumps(group_record, indent=2).encode(),
        }
    )
    with ZipFile(output, "x", compression=ZIP_DEFLATED) as archive:
        for path, data in files.items():
            archive.writestr(path, data)


def build_group_packages(root: Path, product_dir: Path, group_id: str | None = None) -> list[Path]:
    product = ProductManifest.model_validate(load_yaml(product_dir / "product.yaml"))
    groups = load_groups(product_dir)
    if group_id is not None:
        groups = [group for group in groups if group.id == group_id]
    if not groups:
        raise ValueError(f"No asset groups found{f' for {group_id}' if group_id else ''}")
    errors = verify_groups(product_dir, groups, require_packages=False)
    if errors:
        raise ValueError("\n".join(errors))
    printer = PrinterProfile.model_validate(
        load_yaml(root / "config/printer" / f"{product.printer_profile}.yaml")
    )
    targets = [resolve_group_asset(product_dir, group.package) for group in groups]
    for group, target in zip(groups, targets, strict=True):
        if target.exists():
            raise FileExistsError(
                f"Refusing to overwrite {target}; choose a new package path/revision"
            )
        if len(group.materials) > printer.max_material_slots:
            raise ValueError(f"Group {group.id} exceeds printer material slots")
        unsupported = {material.material for material in group.materials} - set(
            printer.supported_materials
        )
        if unsupported:
            raise ValueError(
                f"Group {group.id}: unsupported materials: {', '.join(sorted(unsupported))}"
            )
    package_root = product_dir / "package"
    package_root.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".aps-groups-", dir=package_root) as temporary:
        staged = []
        for index, group in enumerate(groups):
            output = Path(temporary) / f"{index}.3mf"
            write_group_package(
                output, product.slug, group, read_parts(product_dir, group), printer
            )
            staged.append(output)
        for source, target in zip(staged, targets, strict=True):
            target.parent.mkdir(parents=True, exist_ok=True)
            os.link(source, target)
    return targets
