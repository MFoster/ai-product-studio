"""Package named STL components into a millimeter-unit 3MF.

Run outside Blender in an isolated environment containing lib3mf and numpy-stl.
"""

from __future__ import annotations

import sys
from pathlib import Path

import lib3mf
import numpy as np
from stl import mesh as stl_mesh


def package(source_dir: Path, output: Path) -> None:
    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    model.SetUnit(lib3mf.ModelUnit.MilliMeter)
    stls = sorted(source_dir.glob("*.stl"))
    if not stls:
        raise ValueError(f"No STL files found in {source_dir}")
    for path in stls:
        mesh = stl_mesh.Mesh.from_file(str(path))
        vertices = mesh.vectors.reshape(-1, 3)
        unique, inverse = np.unique(np.round(vertices, 5), axis=0, return_inverse=True)
        obj = model.AddMeshObject()
        obj.SetName(path.stem)
        obj.SetGeometry(
            [lib3mf.Position((float(x), float(y), float(z))) for x, y, z in unique],
            [lib3mf.Triangle((int(a), int(b), int(c))) for a, b, c in inverse.reshape(-1, 3)],
        )
        model.AddBuildItem(obj, wrapper.GetIdentityTransform())
    output.parent.mkdir(parents=True, exist_ok=True)
    model.QueryWriter("3mf").WriteToFile(str(output))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: package_3mf.py STL_DIRECTORY OUTPUT.3mf")
    package(Path(sys.argv[1]), Path(sys.argv[2]))
