import { createHash } from "node:crypto";

export const meshContent = "example mesh";
export const meshHash = createHash("sha256").update(meshContent).digest("hex");

export function modelGroup() {
  return {
    id: "assembly",
    name: "Foundry assembly",
    revision: "v003",
    description: "A provisional wall with removable pins.",
    package: "package/assembly.3mf",
    materials: [
      { id: "stone", name: "Ash stone", color: "#BCB8AD", material: "pla" },
      { id: "metal", name: "Bronze", color: "#86A493", material: "pla" },
    ],
    parts: [
      {
        id: "wall",
        name: "Wall",
        quantity: 2,
        meshes: [
          {
            asset: "export/v999/shared.stl",
            material: "stone",
            sha256: meshHash,
          },
          {
            asset: "export/v999/metal.stl",
            material: "metal",
            sha256: meshHash,
          },
        ],
      },
      {
        id: "pin",
        name: "Locating pin",
        quantity: 4,
        meshes: [
          {
            asset: "export/v999/shared.stl",
            material: "stone",
            sha256: meshHash,
          },
        ],
      },
    ],
    layout: {
      spacing_mm: 6,
      margin_mm: 5,
      orientation: "preserve-source" as const,
    },
  };
}
