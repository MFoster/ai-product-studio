"""Render explicit group snapshots using their checksummed source-export mapping.

Run Blender --background --python this-file -- --config prepared-config.json.
The config contains product, groups, export_report and shoot keys. Groups must
be validated APS group snapshots. Use --test for a low-resolution first frame.
Never saves or overwrites the canonical source or an existing output.
"""

import argparse
import json
import math
import runpy
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    config = json.loads(args.config.read_text())
    product = Path(config["product"]).resolve()
    export = json.loads((product / config["export_report"]).read_text())
    helpers = runpy.run_path(str(Path(__file__).with_name("catalog_photography.py")))
    digest = helpers["digest"]
    source = product / export["source"]
    if digest(source) != export["source_sha256"]:
        raise ValueError("Source no longer matches the export provenance")
    shoot = config["shoot"]
    report_path = product / f"review/group-previews-{shoot}.json"
    shoot_path = product / f"source/group-previews-{shoot}-shoot.blend"
    outputs = [product / f"preview/groups-{shoot}/{group['id']}.png" for group in config["groups"]]
    for target in [report_path, shoot_path, *outputs]:
        if target.exists():
            raise FileExistsError(f"Refusing overwrite: {target}")
    preserved = {
        str(path.relative_to(product)): digest(path)
        for directory in ["source", "preview", "export", "package", "release"]
        for path in (product / directory).rglob("*")
        if path.is_file()
    }
    components = {
        component["stl"]: (part, component)
        for part in export["parts"]
        for component in part["components"]
    }
    selections = []
    for group in config["groups"]:
        palette = {material["group"]: material["color"].lower() for material in export["palette"]}
        if any(
            material["color"].lower() != palette[material["id"]] for material in group["materials"]
        ):
            raise ValueError("Group palette differs from authored source colors")
        names = []
        for part in group["parts"]:
            if part["quantity"] != 1:
                raise ValueError("Repeated instances require explicit authored placement evidence")
            parents = set()
            for mesh in part["meshes"]:
                record, component = components[mesh["asset"]]
                if (
                    digest(product / mesh["asset"]) != mesh["sha256"]
                    or mesh["sha256"] != component["stl_sha256"]
                ):
                    raise ValueError(f"Mesh provenance mismatch: {mesh['asset']}")
                if mesh["material"] != component["material_group"]:
                    raise ValueError("Group material disagrees with source-export mapping")
                parents.add(record["physical_part"])
                names.append(component["name"])
            if len(parents) != 1:
                raise ValueError("One named part must map to exactly one authored rigid parent")
        if len(set(names)) != len(names):
            raise ValueError("Duplicated source objects require explicit instance placements")
        selections.append(names)

    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    print(
        "SOURCE",
        scene.name,
        "MODE",
        bpy.context.mode,
        "UNITS",
        scene.unit_settings.scale_length,
        flush=True,
    )
    if (
        bpy.context.mode != "OBJECT"
        or scene.name != export["scene"]
        or not math.isclose(scene.unit_settings.scale_length, 0.001, abs_tol=1e-9)
    ):
        raise ValueError("Expected the millimeter source scene in Object Mode")
    scene.frame_set(1)
    inspection = helpers["inspect_scene"]()
    inspection["product_geometry_signatures"] = helpers["geometry_signatures"]()
    helpers["write_json"](args.config.with_suffix(".inspection.json"), inspection)
    if any(
        texture["used"] and not texture["packed"] and not texture["exists"]
        for texture in inspection["textures"]
    ):
        raise ValueError("The source has missing required textures")
    records = []
    for group, names, output in zip(config["groups"], selections, outputs, strict=True):
        selected = [scene.objects[name] for name in names]
        for obj in scene.objects:
            if obj.type in {"MESH", "CURVE", "FONT", "SURFACE", "META", "VOLUME"}:
                obj.hide_render = obj.name not in names
        scene.view_layers[0].update()
        entry = {
            "inspection": inspection,
            "renderer": "workbench",
            "views": {"hero": {"direction": [1.3, 1.7, 1.25]}} if len(group["parts"]) > 1 else {},
        }
        bounds = helpers["setup"](scene, selected, entry, f"{shoot}-{group['id']}")
        low, high = map(Vector, bounds)
        span = max(high - low)
        distance = (scene.camera.location - (low + high) / 2).length
        # Tight camera clipping retains depth precision for authored color inlays.
        scene.camera.data.clip_start = max(0.01, distance - span * 2)
        scene.camera.data.clip_end = distance + span * 2
        if args.test:
            scene.render.resolution_percentage = 40
            output = args.config.with_suffix(".test.png")
        output.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        helpers["verify_materials"](entry)
        records.append(
            {
                "group": group,
                "image": str(output.relative_to(product)) if not args.test else str(output),
                "image_sha256": digest(output),
                "width": 2000,
                "height": 1500,
                "source_objects": names,
                "bounds_mm": bounds,
                "camera": {
                    "name": scene.camera.name,
                    "location": list(scene.camera.location),
                    "rotation_euler": list(scene.camera.rotation_euler),
                    "lens_mm": scene.camera.data.lens,
                },
            }
        )
        print("GROUP_PREVIEW", group["id"], output, flush=True)
        if args.test:
            break
    for relative, expected in preserved.items():
        if digest(product / relative) != expected:
            raise ValueError(f"Pre-existing asset changed: {relative}")
    if not args.test:
        scene["aps_group_preview_report"] = str(report_path.relative_to(product))
        bpy.ops.wm.save_as_mainfile(filepath=str(shoot_path), check_existing=True)
        helpers["write_json"](
            report_path,
            {
                "schema_version": "1.0",
                "product": product.name,
                "shoot": shoot,
                "source": export["source"],
                "source_sha256": digest(source),
                "scene": scene.name,
                "frame": 1,
                "units": "millimeter",
                "shoot_scene": str(shoot_path.relative_to(product)),
                "driver_sha256": digest(Path(__file__)),
                "export_report": config["export_report"],
                "export_report_sha256": digest(product / config["export_report"]),
                "render": {
                    "engine": "BLENDER_WORKBENCH",
                    "studio_light": "paint.sl",
                    "color_type": "MATERIAL",
                    "view_transform": "AgX",
                    "exposure": 0,
                    "gamma": 1,
                    "samples": 32,
                    "reason": "Preserve authored viewport colors without editing materials",
                },
                "status": "Deployed assembly review renders; not slice or physical-print approval",
                "preserved_assets": preserved,
                "groups": records,
            },
        )


if __name__ == "__main__":
    main()
