import { isRecord, type Json, type ModelGroup, type RecordData } from "./types";

function object(value: Json | undefined): RecordData {
  if (!isRecord(value)) throw new Error("Expected an object.");
  return value;
}

function name(value: Json | undefined): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Names and revisions must be nonempty strings.");
  return value.trim();
}

function slug(value: Json | undefined): string {
  const result = name(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result))
    throw new Error(`Invalid identity: ${result}`);
  return result;
}

function list(value: Json | undefined): Json[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error("Materials, parts and meshes must be nonempty lists.");
  return value;
}

function reference(
  value: Json | undefined,
  folder: string,
  extension: string,
): string {
  const result = name(value);
  if (
    !result.startsWith(`${folder}/`) ||
    !result.toLowerCase().endsWith(extension) ||
    result.includes("\\") ||
    result.split("/").some((part) => !part || part.startsWith("."))
  ) {
    throw new Error(`Invalid ${extension} reference: ${result}`);
  }
  return result;
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label}.`);
}

function distance(
  value: Json | undefined,
  fallback: number,
  allowZero: boolean,
): number {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== "number" ||
    !Number.isFinite(result) ||
    (allowZero ? result < 0 : result <= 0)
  )
    throw new Error("Invalid group layout distance.");
  return result;
}

export function parseModelGroups(value: Json | undefined): {
  groups: ModelGroup[];
  errors: string[];
} {
  const groups: ModelGroup[] = [];
  const errors: string[] = [];
  if (value === undefined) return { groups, errors };
  if (!Array.isArray(value))
    return { groups, errors: ["Groups must be a list."] };
  for (const [index, item] of value.entries()) {
    try {
      const source = object(item);
      const materials = list(source.materials).map((value) => {
        const material = object(value);
        const color = name(material.color);
        if (!/^#[a-f0-9]{6}$/i.test(color))
          throw new Error(`Invalid material color: ${color}`);
        return {
          id: slug(material.id),
          name: name(material.name),
          color,
          material:
            material.material === undefined ? "pla" : slug(material.material),
        };
      });
      unique(
        materials.map((material) => material.id),
        "material IDs",
      );
      const parts = list(source.parts).map((value) => {
        const part = object(value);
        const quantity = part.quantity === undefined ? 1 : part.quantity;
        if (
          typeof quantity !== "number" ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1
        )
          throw new Error("Part quantities must be positive integers.");
        const meshes = list(part.meshes).map((value) => {
          const mesh = object(value);
          const material = slug(mesh.material);
          if (!materials.some((entry) => entry.id === material))
            throw new Error(`Unknown material: ${material}`);
          const sha256 = name(mesh.sha256);
          if (!/^[a-f0-9]{64}$/.test(sha256))
            throw new Error("Invalid mesh SHA-256.");
          return {
            asset: reference(mesh.asset, "export", ".stl"),
            material,
            sha256,
          };
        });
        unique(
          meshes.map((mesh) => mesh.asset),
          "mesh paths within a part",
        );
        return { id: slug(part.id), name: name(part.name), quantity, meshes };
      });
      unique(
        parts.map((part) => part.id),
        "part IDs",
      );
      const layout = source.layout === undefined ? {} : object(source.layout);
      if (
        layout.orientation !== undefined &&
        layout.orientation !== "preserve-source"
      )
        throw new Error("Invalid group orientation.");
      if (
        source.description !== undefined &&
        typeof source.description !== "string"
      )
        throw new Error("Description must be a string.");
      const group: ModelGroup = {
        id: slug(source.id),
        name: name(source.name),
        revision: name(source.revision),
        description: source.description ?? "",
        package: reference(source.package, "package", ".3mf"),
        materials,
        parts,
        layout: {
          spacing_mm: distance(layout.spacing_mm, 6, false),
          margin_mm: distance(layout.margin_mm, 5, true),
          orientation: "preserve-source",
        },
      };
      if (
        groups.some(
          (entry) => entry.id === group.id || entry.package === group.package,
        )
      )
        throw new Error("Duplicate group ID or package target.");
      groups.push(group);
    } catch (error) {
      errors.push(
        `Group ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { groups, errors };
}
