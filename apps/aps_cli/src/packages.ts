import {
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { planPlates, readParts, type Part } from "./geometry.js";
import { loadGroups, resolveGroupAsset, verifyGroups } from "./groups.js";
import {
  loadPrinter,
  loadProduct,
  type AssetGroup,
  type Printer,
} from "./manifests.js";
import { formatGeneral } from "./numbers.js";
import { floatString } from "./slicer.js";
import { Xml } from "./xml.js";

const core = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const production =
  "http://schemas.microsoft.com/3dmanufacturing/production/2015/06";
const relationships =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const modelRelationship =
  "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const identity = "1 0 0 0 1 0 0 0 1 0 0 0";
const matrix = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";

function meta(parent: Xml, key: string, value: string | number): void {
  parent.add("metadata", { key, value });
}

async function writePackage(
  output: string,
  product: string,
  group: AssetGroup,
  parts: Part[],
  printer: Printer,
): Promise<void> {
  const plates = planPlates(group, parts, printer);
  const columns = Math.ceil(Math.sqrt(plates.length));
  const { x: width, y: depth } = printer.build_volume_mm;
  const model = new Xml("model", {
    xmlns: core,
    "xmlns:p": production,
    requiredextensions: "p",
    unit: "millimeter",
    "xml:lang": "en-US",
  });
  for (const [name, value] of Object.entries({
    Application: "BambuStudio-02.09.01.70",
    "BambuStudio:3mfVersion": "1",
    Designer: "AI Product Studio",
    "aps:Generator": "aps assets package",
    Title: group.name,
    Description: group.description,
    "aps:GroupId": group.id,
    "aps:Revision": group.revision,
  }))
    model.add("metadata", { name }).text = value;
  const resources = model.add("resources");
  const build = model.add("build");
  const config = new Xml("config");
  const relations = new Xml("Relationships", { xmlns: relationships });
  const files = new Map<string, string>();
  const slots = new Map(
    group.materials.map((material, index) => [material.id, index + 1]),
  );
  const names = new Map(
    group.materials.map((material) => [material.id, material.name]),
  );
  let nextId = 2;
  const records = [];
  for (let plateIndex = 0; plateIndex < plates.length; plateIndex++) {
    const origin = [
      (plateIndex % columns) * width * 1.2,
      -Math.floor(plateIndex / columns) * depth * 1.2,
      0,
    ];
    const record = {
      id: plateIndex + 1,
      name: `${group.name} - Plate ${plateIndex + 1}`,
      origin_mm: origin,
      instances: [] as Record<string, unknown>[],
    };
    records.push(record);
    const plateConfig = new Xml("plate");
    meta(plateConfig, "plater_id", record.id);
    meta(plateConfig, "plater_name", record.name);
    meta(plateConfig, "locked", "false");
    for (const instance of plates[plateIndex]) {
      const { part } = instance;
      const meshIds: number[] = [];
      const meshRecords: Record<string, unknown>[] = [];
      const name =
        part.spec.quantity > 1
          ? `${part.spec.name} (${instance.copy})`
          : part.spec.name;
      for (const mesh of part.meshes) {
        const meshId = nextId++;
        meshIds.push(meshId);
        const child = new Xml("model", { xmlns: core, unit: "millimeter" });
        const childResources = child.add("resources");
        const meshName = `${name} - ${names.get(mesh.source.material)}`;
        const geometry = childResources
          .add("object", { id: meshId, type: "model", name: meshName })
          .add("mesh");
        const vertices = geometry.add("vertices");
        for (const vertex of mesh.vertices)
          vertices.add("vertex", {
            x: formatGeneral(vertex[0], 9),
            y: formatGeneral(vertex[1], 9),
            z: formatGeneral(vertex[2], 9),
          });
        const triangles = geometry.add("triangles");
        for (const [a, b, c] of mesh.triangles)
          triangles.add("triangle", { v1: a, v2: b, v3: c });
        child.add("build");
        const modelPath = `3D/Objects/object_${meshId}.model`;
        files.set(modelPath, child.document());
        relations.add("Relationship", {
          Id: `rel-${meshId}`,
          Target: `/${modelPath}`,
          Type: modelRelationship,
        });
        meshRecords.push({
          ...mesh.source,
          object_id: meshId,
          name: meshName,
          triangles: mesh.triangles.length,
          project_filament: slots.get(mesh.source.material),
        });
      }
      const rootId = nextId++;
      const object = resources.add("object", {
        id: rootId,
        type: "model",
        name,
      });
      const components = object.add("components");
      const objectConfig = config.add("object", { id: rootId });
      meta(objectConfig, "name", name);
      meta(
        objectConfig,
        "extruder",
        slots.get(part.meshes[0].source.material)!,
      );
      for (let index = 0; index < part.meshes.length; index++) {
        const mesh = part.meshes[index];
        const meshId = meshIds[index];
        components.add("component", {
          objectid: meshId,
          transform: identity,
          "p:path": `/3D/Objects/object_${meshId}.model`,
        });
        const volume = objectConfig.add("part", {
          id: meshId,
          subtype: "normal_part",
        });
        meta(volume, "name", `${name} - ${names.get(mesh.source.material)}`);
        meta(volume, "extruder", slots.get(mesh.source.material)!);
        meta(volume, "matrix", matrix);
        meta(volume, "source_file", path.basename(mesh.source.asset));
      }
      const local = [
        instance.x - part.lower[0],
        instance.y - part.lower[1],
        -part.lower[2],
      ];
      const translation = local.map((value, axis) => value + origin[axis]);
      build.add("item", {
        objectid: rootId,
        transform: `1 0 0 0 1 0 0 0 1 ${translation.map((value) => formatGeneral(value, 12)).join(" ")}`,
        printable: "1",
      });
      const placement = plateConfig.add("model_instance");
      meta(placement, "object_id", rootId);
      meta(placement, "instance_id", 0);
      meta(placement, "identify_id", rootId);
      record.instances.push({
        part_id: part.spec.id,
        copy: instance.copy,
        object_id: rootId,
        name,
        translation_mm: translation,
        bounds_on_plate_mm: [
          [instance.x, instance.y, 0],
          [instance.x + part.size[0], instance.y + part.size[1], part.size[2]],
        ],
        meshes: meshRecords,
      });
    }
    config.children.push(plateConfig);
  }
  const count = group.materials.length;
  const settings = {
    printer_settings_id: "",
    print_settings_id: "",
    printer_model: "",
    nozzle_diameter: [floatString(printer.nozzle_diameter_mm)],
    printable_height: floatString(printer.build_volume_mm.z),
    printable_area: [
      "0x0",
      `${floatString(width)}x0`,
      `${floatString(width)}x${floatString(depth)}`,
      `0x${floatString(depth)}`,
    ],
    inherits_group: Array(count + 2).fill(""),
    different_settings_to_system: Array(count + 2).fill(""),
    filament_is_support: Array(count).fill("0"),
    filament_colour: group.materials.map((material) => material.color),
    filament_type: group.materials.map((material) =>
      material.material.toUpperCase(),
    ),
    filament_settings_id: group.materials.map(
      (material) => `Generic ${material.material.toUpperCase()}`,
    ),
    filament_diameter: Array(count).fill("1.75"),
  };
  const content = new Xml("Types", {
    xmlns: "http://schemas.openxmlformats.org/package/2006/content-types",
  });
  for (const [extension, type] of [
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["model", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"],
    ["config", "application/octet-stream"],
    ["json", "application/json"],
  ])
    content.add("Default", { Extension: extension, ContentType: type });
  const packageRelations = new Xml("Relationships", { xmlns: relationships });
  packageRelations.add("Relationship", {
    Id: "rel-model",
    Target: "/3D/3dmodel.model",
    Type: modelRelationship,
  });
  const groupRecord = {
    schema_version: "1.0",
    product,
    group,
    printer,
    plates: records,
    validation: "unsliced-model-layout",
    limitations: [
      "Layout reserves bounding-box gaps/margins, not support/brim/purge space",
      "Source orientations are preserved, not physically qualified",
      "Select actual printer/process/filament presets and AMS trays before slicing",
      "No slicing, fit, assembly, load or physical-print qualification is asserted",
    ],
  };
  files.set("[Content_Types].xml", content.document());
  files.set("_rels/.rels", packageRelations.document());
  files.set("3D/3dmodel.model", model.document());
  files.set("3D/_rels/3dmodel.model.rels", relations.document());
  files.set("Metadata/model_settings.config", config.document());
  files.set(
    "Metadata/project_settings.config",
    JSON.stringify(settings, null, 2),
  );
  files.set("Metadata/aps_group.json", JSON.stringify(groupRecord, null, 2));
  const archive = new ZipFile();
  for (const [name, data] of files) archive.addBuffer(Buffer.from(data), name);
  const writing = pipeline(
    archive.outputStream,
    createWriteStream(output, { flags: "wx" }),
  );
  archive.end();
  await writing;
}

export async function buildPackages(
  root: string,
  productDir: string,
  groupId?: string,
): Promise<string[]> {
  const product = loadProduct(productDir);
  let groups = loadGroups(productDir);
  if (groupId !== undefined)
    groups = groups.filter((group) => group.id === groupId);
  if (!groups.length)
    throw new Error(`No asset groups found${groupId ? ` for ${groupId}` : ""}`);
  const errors = await verifyGroups(productDir, groups, false);
  if (errors.length) throw new Error(errors.join("\n"));
  const printer = loadPrinter(
    path.join(root, "config/printer", `${product.printer_profile}.yaml`),
  );
  const targets = groups.map((group) =>
    resolveGroupAsset(productDir, group.package),
  );
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (existsSync(targets[index]))
      throw new Error(
        `Refusing to overwrite ${targets[index]}; choose a new package path/revision`,
      );
    if (group.materials.length > printer.max_material_slots)
      throw new Error(`Group ${group.id} exceeds printer material slots`);
    const unsupported = [
      ...new Set(
        group.materials
          .map((material) => material.material)
          .filter(
            (material) => !printer.supported_materials.includes(material),
          ),
      ),
    ].sort();
    if (unsupported.length)
      throw new Error(
        `Group ${group.id}: unsupported materials: ${unsupported.join(", ")}`,
      );
  }
  const packageRoot = path.join(productDir, "package");
  mkdirSync(packageRoot, { recursive: true });
  const temp = mkdtempSync(path.join(packageRoot, ".aps-groups-"));
  try {
    const staged: string[] = [];
    for (let index = 0; index < groups.length; index++) {
      const file = path.join(temp, `${index}.3mf`);
      await writePackage(
        file,
        product.slug,
        groups[index],
        readParts(productDir, groups[index]),
        printer,
      );
      staged.push(file);
    }
    for (let index = 0; index < staged.length; index++) {
      mkdirSync(path.dirname(targets[index]), { recursive: true });
      linkSync(staged[index], targets[index]);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return targets;
}
