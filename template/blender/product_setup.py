"""Reusable Blender setup and validation helpers for AI Product Studio."""

from __future__ import annotations

import json
from pathlib import Path

import bmesh
import bpy


def ensure_object_mode() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def configure_millimeters() -> None:
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.unit_settings.scale_length = 0.001


def mesh_diagnostics(obj: bpy.types.Object) -> dict[str, object]:
    if obj.type != "MESH":
        return {"name": obj.name, "type": obj.type, "skipped": True}
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
        loose_vertices = sum(1 for vertex in bm.verts if not vertex.link_edges)
    finally:
        bm.free()
    return {
        "name": obj.name,
        "type": obj.type,
        "dimensions_mm": [round(value, 4) for value in obj.dimensions],
        "non_manifold_edges": non_manifold,
        "loose_vertices": loose_vertices,
    }


def validate_scene(report_path: Path) -> list[dict[str, object]]:
    ensure_object_mode()
    report = [mesh_diagnostics(obj) for obj in bpy.context.scene.objects]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def export_mesh_objects(destination: Path) -> list[Path]:
    ensure_object_mode()
    destination.mkdir(parents=True, exist_ok=True)
    exported: list[Path] = []
    for obj in sorted(bpy.context.scene.objects, key=lambda item: item.name):
        if obj.type != "MESH" or obj.hide_render:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        output = destination / f"{obj.name}.stl"
        bpy.ops.wm.stl_export(
            filepath=str(output),
            export_selected_objects=True,
            ascii_format=False,
        )
        exported.append(output)
    return exported


if __name__ == "__main__":
    configure_millimeters()
