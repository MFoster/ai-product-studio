"""Non-destructive, headless catalog photography of explicitly selected authored scenes.

Run with Blender --background --python this_file -- --config report/...json
--product <catalog key> --phase inspect|test|render|finalize|verify. Use
revise-test only before production rendering. Prepare the JSON configuration
outside Blender after reviewing manifests and source provenance.
No product mesh, transform, material, or texture definition is edited.
"""

import argparse
import hashlib
import json
import sys
from array import array
from pathlib import Path

import bpy
from mathutils import Vector


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[i] for point in points) for i in range(3))),
        Vector(tuple(max(point[i] for point in points) for i in range(3))),
    )


def material_signature():
    return {material.name: digest_bytes(material) for material in bpy.data.materials}


def digest_bytes(material):
    values = {"diffuse": list(material.diffuse_color), "use_nodes": material.use_nodes}
    if material.use_nodes:
        values["nodes"] = [
            {
                "name": node.name,
                "type": node.bl_idname,
                "inputs": {
                    socket.identifier: (
                        list(socket.default_value)
                        if hasattr(socket.default_value, "__len__")
                        and not isinstance(socket.default_value, str)
                        else socket.default_value
                    )
                    for socket in node.inputs
                    if hasattr(socket, "default_value")
                    and isinstance(
                        socket.default_value, (int, float, str, Vector, bpy.types.bpy_prop_array)
                    )
                },
                "image": node.image.name if hasattr(node, "image") and node.image else None,
            }
            for node in material.node_tree.nodes
        ]
        values["links"] = [
            (
                link.from_node.name,
                link.from_socket.identifier,
                link.to_node.name,
                link.to_socket.identifier,
            )
            for link in material.node_tree.links
        ]
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def inspect_scene():
    scene = bpy.context.scene
    objects = []
    for obj in scene.objects:
        item = {
            "name": obj.name,
            "type": obj.type,
            "hide_render": obj.hide_render,
            "hide_viewport": obj.hide_viewport,
            "visible": obj.visible_get(),
            "collections": [collection.name for collection in obj.users_collection],
            "location": list(obj.location),
            "scale": list(obj.scale),
            "materials": [
                slot.material.name if slot.material else None for slot in obj.material_slots
            ],
            "properties": {key: str(obj[key]) for key in obj.keys()},  # noqa: SIM118
        }
        if obj.type in {"MESH", "CURVE", "FONT", "SURFACE", "META"}:
            low, high = bounds([obj])
            item.update(bounds=[list(low), list(high)], dimensions=list(high - low))
            if obj.type == "MESH":
                item.update(vertices=len(obj.data.vertices), polygons=len(obj.data.polygons))
        objects.append(item)
    textures = []
    for image in bpy.data.images:
        if image.source in {"FILE", "TILED"}:
            absolute = bpy.path.abspath(image.filepath, library=image.library)
            textures.append(
                {
                    "name": image.name,
                    "path": image.filepath,
                    "absolute": absolute,
                    "packed": bool(image.packed_file),
                    "exists": Path(absolute).is_file(),
                    "used": image.users > 0,
                }
            )
    return {
        "scene": scene.name,
        "mode": bpy.context.mode,
        "scenes": [item.name for item in bpy.data.scenes],
        "units": {
            "system": scene.unit_settings.system,
            "scale_length": scene.unit_settings.scale_length,
            "length_unit": scene.unit_settings.length_unit,
        },
        "objects": objects,
        "textures": textures,
        "linked_libraries": [
            {"path": lib.filepath, "exists": Path(bpy.path.abspath(lib.filepath)).is_file()}
            for lib in bpy.data.libraries
        ],
        "materials": material_signature(),
        "material_color_evidence": {
            material.name: {
                "viewport_diffuse_rgba": list(material.diffuse_color),
                "principled_base_rgba": [
                    list(node.inputs["Base Color"].default_value)
                    for node in material.node_tree.nodes
                    if node.type == "BSDF_PRINCIPLED"
                ]
                if material.node_tree
                else [],
            }
            for material in bpy.data.materials
        },
        "collections": [
            {"name": collection.name, "hide_render": collection.hide_render}
            for collection in bpy.data.collections
        ],
        "view_layers": [{"name": layer.name, "use": layer.use} for layer in scene.view_layers],
        "authored_camera": scene.camera.name if scene.camera else None,
        "authored_render_engine": scene.render.engine,
        "product_geometry_signatures": geometry_signatures(),
    }


def geometry_signatures():
    signatures = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        values = array("f", [0.0]) * (3 * len(obj.data.vertices))
        obj.data.vertices.foreach_get("co", values)
        indices = array("i", [0]) * len(obj.data.loops)
        obj.data.loops.foreach_get("vertex_index", indices)
        slots = array("i", [0]) * len(obj.data.polygons)
        obj.data.polygons.foreach_get("material_index", slots)
        value = hashlib.sha256(values.tobytes() + indices.tobytes() + slots.tobytes())
        value.update(str([list(row) for row in obj.matrix_world]).encode())
        signatures[obj.name] = value.hexdigest()
    return signatures


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup(scene, selected, entry, shoot):
    low, high = bounds(selected)
    center = (low + high) / 2
    span = max(high - low)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.unit_settings.scale_length = entry["inspection"]["units"]["scale_length"]
    # All subjects retain their authored transforms; a world-only background
    # avoids adding backdrop geometry or unauthorized material definitions.
    world = bpy.data.worlds.new("Catalog-neutral-" + shoot)
    world.color = (0.208, 0.208, 0.208)
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.32, 0.32, 0.32, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 6
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 1500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.use_nodes = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.use_file_extension = True
    scene.render.use_compositing = False
    if entry.get("renderer") == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.studio_light = "paint.sl"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = "BOTH"
        scene.display.shading.background_type = "WORLD"
        scene.display.render_aa = "32"
    for obj in scene.objects:
        if obj.type in {"CAMERA", "LIGHT"}:
            obj.hide_render = True
    for name in entry.get("exclude", []):
        bpy.data.objects[name].hide_render = True
    rig = bpy.data.collections.new("Catalog studio " + shoot)
    scene.collection.children.link(rig)
    for name, offset, power, size in [
        ("key", (-1.5, -2.0, 2.8), 65, 2.4),
        ("fill", (2.1, -0.5, 1.5), 25, 2.6),
        ("rim", (0.2, 1.8, 2.4), 55, 1.8),
    ]:
        light = bpy.data.lights.new("Catalog " + name, "AREA")
        # Blender powers are watts in meter-based coordinates, not mm.
        light.energy = power * span * span
        light.shape = "DISK"
        light.size = span * size
        obj = bpy.data.objects.new(light.name, light)
        rig.objects.link(obj)
        obj.location = center + Vector(offset) * span
        aim(obj, center)
    for name in ("hero", "rear", "detail"):
        settings = entry.get("views", {}).get(name, {})
        target = Vector(settings.get("target", list(center)))
        direction = Vector(
            settings.get(
                "direction",
                {
                    "hero": (1.0, -1.7, 0.85),
                    "rear": (-1.0, 1.7, 0.85),
                    "detail": (0.35, -0.7, 1.3),
                }[name],
            )
        ).normalized()
        data = bpy.data.cameras.new("Catalog " + name)
        data.lens = 65
        data.sensor_width = 36
        data.dof.use_dof = False
        data.dof.aperture_fstop = 9
        data.clip_start = max(span / 10000, 0.00001)
        data.clip_end = span * 100
        obj = bpy.data.objects.new(data.name, data)
        rig.objects.link(obj)
        if "distance" in settings:
            distance = span * settings["distance"]
        else:
            rotation = (-direction).to_track_quat("-Z", "Y")
            right, up = rotation @ Vector((1, 0, 0)), rotation @ Vector((0, 1, 0))
            tangent_x = data.sensor_width / (2 * data.lens)
            tangent_y = tangent_x * scene.render.resolution_y / scene.render.resolution_x
            corners = [
                Vector((x, y, z)) - target
                for x in (low.x, high.x)
                for y in (low.y, high.y)
                for z in (low.z, high.z)
            ]
            distance = max(
                max(
                    abs(point.dot(right)) / (tangent_x * 0.82),
                    abs(point.dot(up)) / (tangent_y * 0.82),
                )
                + point.dot(direction)
                for point in corners
            )
        obj.location = target + direction * distance
        aim(obj, target)
        if name == "hero":
            scene.camera = obj
    return [list(low), list(high)]


def verify_materials(entry):
    actual = material_signature()
    expected = entry["inspection"]["materials"]
    used = {
        material
        for obj in entry["inspection"]["objects"]
        for material in obj["materials"]
        if material
    }
    assert used <= actual.keys(), "Referenced authored material was lost"
    assert all(expected.get(name) == signature for name, signature in actual.items()), (
        "Authored materials changed"
    )
    assert geometry_signatures() == entry["inspection"]["product_geometry_signatures"], (
        "Authored mesh or transform changed"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--product", required=True)
    parser.add_argument(
        "--phase",
        choices=["inspect", "test", "revise-test", "render", "finalize", "verify"],
        required=True,
    )
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    config = json.loads(options.config.read_text())
    entry = config["products"][options.product]
    product = Path(entry["product_path"]).resolve()
    source = Path(entry["source_path"]).resolve()
    shoot = config["shoot_id"]
    report = product / "review" / f"catalog-{shoot}.json"
    shoot_file = product / "source" / f"catalog-{shoot}-shoot.blend"
    source_hash = digest(source)
    assert source_hash == entry["source_sha256"], "Source changed since provenance capture"
    bpy.ops.wm.open_mainfile(
        filepath=str(shoot_file if options.phase in {"render", "finalize", "verify"} else source)
    )
    inspection = inspect_scene()
    if options.phase == "inspect":
        write_json(Path(config["inspection_dir"]) / (options.product + ".json"), inspection)
        print("CATALOG_INSPECTED", options.product)
        return
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    if options.phase in {"test", "revise-test"}:
        if options.phase == "test":
            assert not shoot_file.exists(), "Refusing to overwrite an existing shoot"
        else:
            previous = json.loads(report.read_text())
            assert previous["shoot_id"] == shoot and previous["source_sha256_before"] == source_hash
            assert not previous["renders"], (
                "Cannot revise a production shoot after images are rendered"
            )
        bpy.context.preferences.filepaths.save_version = 0
        missing = [
            image
            for image in inspection["textures"]
            if image["used"] and not image["packed"] and not image["exists"]
        ]
        assert not missing, f"Missing authored texture resources: {missing}"
        assert not [lib for lib in inspection["linked_libraries"] if not lib["exists"]], (
            "Missing linked library"
        )
        entry["inspection"] = inspection
        selected = [bpy.data.objects[name] for name in entry["subjects"]]
        product_bounds = setup(bpy.context.scene, selected, entry, shoot)
        bpy.context.scene.render.filepath = str(product / "preview" / f"catalog-{shoot}-hero.png")
        verify_materials(entry)
        # Save in the source directory so original // texture paths keep exactly
        # the same base directory. Blender remaps resources on save as well.
        assert shoot_file.parent == source.parent
        bpy.ops.wm.save_as_mainfile(
            filepath=str(shoot_file), check_existing=True, relative_remap=True
        )
        data = {
            "shoot_id": shoot,
            "product_path": entry["product_path"],
            "source_path": entry["source_path"],
            "source_sha256_before": source_hash,
            "source_selection_evidence": entry["evidence"],
            "caveats": entry.get("caveats", []),
            "shoot_path": str(shoot_file.relative_to(Path.cwd())),
            "authored_inspection": inspection,
            "subjects": entry["subjects"],
            "excluded_props": entry.get("exclude", []),
            "product_bounds_authored_units": product_bounds,
            "units_preserved": inspection["units"],
            "geometry_edits": False,
            "material_edits": False,
            "authored_material_signatures": inspection["materials"],
            "authored_geometry_signatures": inspection["product_geometry_signatures"],
            "renderer": (
                "Workbench studio material-color rendering: authored viewport colors differ "
                "from unconfigured default BSDFs; no material correction authorized."
                if entry.get("renderer") == "workbench"
                else "Cycles CPU, six threads; predictable shared-machine resource use"
            ),
            "resolution": [2000, 1500],
            "samples": 32,
            "denoise": True,
            "color_management": {
                "view_transform": "AgX",
                "look": "None",
                "exposure": 0,
                "gamma": 1,
            },
            "background": "neutral gray world only; no backdrop materials or geometry added",
            "cameras": [
                {
                    "name": obj.name,
                    "location": list(obj.location),
                    "rotation": list(obj.rotation_euler),
                    "lens_mm": obj.data.lens,
                    "fstop": obj.data.dof.aperture_fstop,
                    "depth_of_field": obj.data.dof.use_dof,
                }
                for obj in bpy.context.scene.objects
                if obj.type == "CAMERA" and obj.name.startswith("Catalog ")
            ],
            "lights": [
                {
                    "name": obj.name,
                    "type": obj.data.type,
                    "location": list(obj.location),
                    "energy": obj.data.energy,
                    "size": obj.data.size,
                    "color": list(obj.data.color),
                }
                for obj in bpy.context.scene.objects
                if obj.type == "LIGHT" and obj.name.startswith("Catalog ")
            ],
            "renders": [],
            "visual_qc": "awaiting actual image inspection",
            "validation_scope": (
                "Photography only. No geometry, slice, or physical validation inferred."
            ),
        }
        write_json(report, data)
        scene = bpy.context.scene
        scene.render.resolution_percentage = 25
        scene.cycles.samples = 8
        scene.render.filepath = str(
            Path(config["inspection_dir"]).resolve() / (options.product + "-test.png")
        )
        bpy.ops.render.render(write_still=True)
    elif options.phase == "render":
        data = json.loads(report.read_text())
        entry["inspection"] = data["authored_inspection"]
        verify_materials(entry)
        scene = bpy.context.scene
        for view in ("hero", "rear", "detail"):
            path = product / "preview" / f"catalog-{shoot}-{view}.png"
            assert not path.exists(), "Refusing to overwrite an existing production image"
            path.parent.mkdir(parents=True, exist_ok=True)
            scene.camera = bpy.data.objects["Catalog " + view]
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            data["renders"].append(
                {
                    "view": view,
                    "path": str(path.relative_to(Path.cwd())),
                    "dimensions": [scene.render.resolution_x, scene.render.resolution_y],
                    "sha256": digest(path),
                }
            )
            write_json(report, data)
    else:
        data = json.loads(report.read_text())
        entry["inspection"] = data["authored_inspection"]
        verify_materials(entry)
        scene = bpy.context.scene
        if options.phase == "finalize":
            scene.camera = bpy.data.objects["Catalog hero"]
            scene.render.filepath = str(product / "preview" / f"catalog-{shoot}-hero.png")
            for view in ("hero", "rear", "detail"):
                bpy.data.objects["Catalog " + view]["catalog_render_path"] = str(
                    product / "preview" / f"catalog-{shoot}-{view}.png"
                )
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(shoot_file), relative_remap=True)
            data["saved_default_output"] = scene.render.filepath
        data["saved_shoot_sha256"] = digest(shoot_file)
        data["saved_shoot_engine"] = scene.render.engine
        data["samples"] = scene.cycles.samples if scene.render.engine == "CYCLES" else None
        data["denoise"] = scene.cycles.use_denoising if scene.render.engine == "CYCLES" else False
        data["workbench_studio"] = (
            {
                "studio_light": scene.display.shading.studio_light,
                "color_type": scene.display.shading.color_type,
                "antialiasing": scene.display.render_aa,
                "area_lights_affect_render": False,
            }
            if scene.render.engine == "BLENDER_WORKBENCH"
            else None
        )
        data["saved_resource_check"] = {
            "images": inspection["textures"],
            "libraries": inspection["linked_libraries"],
        }
        assert not [
            image
            for image in inspection["textures"]
            if image["used"] and not image["packed"] and not image["exists"]
        ], "Saved shoot has missing texture dependencies"
        for image in data["renders"]:
            path = Path(image["path"])
            assert path.is_file() and digest(path) == image["sha256"]
            loaded = bpy.data.images.load(str(path.resolve()), check_existing=False)
            assert list(loaded.size) == image["dimensions"]
            bpy.data.images.remove(loaded)
        data["saved_shoot_reopened"] = True
        data["unused_materials_omitted_by_blender_save"] = sorted(
            set(data["authored_material_signatures"]) - set(material_signature())
        )
        data["source_sha256_after"] = digest(source)
        data["source_preserved"] = data["source_sha256_after"] == data["source_sha256_before"]
        assert data["source_preserved"]
        write_json(report, data)
    assert digest(source) == source_hash
    print("CATALOG_COMPLETE", options.phase, options.product)


if __name__ == "__main__":
    main()
