import {
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { stringify } from "./yaml.js";
import {
  loadMaterial,
  loadPrinter,
  loadStudio,
  validatePrinter,
  type Printer,
  type Studio,
} from "./manifests.js";
import { Prompts } from "./prompts.js";
import { formatGeneral } from "./numbers.js";

const presets: Record<
  string,
  {
    name: string;
    nozzle: [number, number];
    bed: [number, number];
    wall: number;
    shrink: number;
    notes: string[];
  }
> = {
  pla: {
    name: "PLA",
    nozzle: [190, 230],
    bed: [45, 65],
    wall: 1.2,
    shrink: 0.2,
    notes: ["General-purpose rigid filament with low warping."],
  },
  petg: {
    name: "PETG",
    nozzle: [220, 260],
    bed: [70, 90],
    wall: 1.2,
    shrink: 0.4,
    notes: ["Durable filament with good layer adhesion; manage stringing."],
  },
  abs: {
    name: "ABS",
    nozzle: [230, 270],
    bed: [90, 110],
    wall: 1.6,
    shrink: 0.8,
    notes: ["Enclosure and ventilation are strongly recommended."],
  },
  asa: {
    name: "ASA",
    nozzle: [240, 280],
    bed: [90, 110],
    wall: 1.6,
    shrink: 0.8,
    notes: [
      "UV-resistant material; enclosure and ventilation are recommended.",
    ],
  },
  tpu: {
    name: "TPU",
    nozzle: [210, 240],
    bed: [30, 60],
    wall: 1.2,
    shrink: 1,
    notes: [
      "Flexible filament; reduce speed and avoid unsupported thin columns.",
    ],
  },
  nylon: {
    name: "Nylon",
    nozzle: [245, 290],
    bed: [70, 100],
    wall: 1.6,
    shrink: 1.2,
    notes: ["Dry thoroughly before printing; enclosure may be required."],
  },
  pc: {
    name: "Polycarbonate",
    nozzle: [260, 310],
    bed: [90, 120],
    wall: 1.6,
    shrink: 1,
    notes: ["High-temperature hotend and enclosure are typically required."],
  },
};

function isFile(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

function materials(value: string): string[] {
  const slugs = [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!slugs.length) throw new Error("Select at least one material type");
  const unsupported = slugs
    .filter((slug) => !Object.hasOwn(presets, slug))
    .sort();
  if (unsupported.length)
    throw new Error(
      `Unsupported material type(s): ${unsupported.join(", ")}. Supported values: ${Object.keys(presets).sort().join(", ")}`,
    );
  return slugs;
}

function write(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringify(data));
}

export async function configure(
  root: string,
  yes: boolean,
  prompts: Prompts,
): Promise<void> {
  const studioFile = path.join(root, "config/studio.yaml");
  const studio: Studio = isFile(studioFile)
    ? loadStudio(studioFile)
    : {
        schema_version: "1.0",
        name: "AI Product Studio",
        default_printer: "generic-fdm",
        material_config: "config/material/material.yaml",
        product_lines: [],
        registry_index: ".aps/registry.yaml",
      };
  const previous = isFile(studioFile) ? studio.default_printer : undefined;
  const printerFile = path.join(
    root,
    "config/printer",
    `${studio.default_printer}.yaml`,
  );
  const defaultPrinter: Printer = isFile(printerFile)
    ? loadPrinter(printerFile)
    : validatePrinter({
        slug: "generic-fdm",
        name: "Generic FDM Printer",
        build_volume_mm: { x: 220, y: 220, z: 250 },
        nozzle_diameter_mm: 0.4,
        minimum_wall_mm: 1.2,
        minimum_detail_mm: 0.8,
        max_material_slots: 1,
        supported_materials: ["pla", "petg"],
      });
  const materialFile = path.join(root, studio.material_config);
  const defaults = isFile(materialFile)
    ? loadMaterial(materialFile).materials.map((material) => material.slug)
    : defaultPrinter.supported_materials;
  console.log("Configure AI Product Studio");
  console.log(
    `Supported material presets: ${Object.keys(presets).sort().join(", ")}`,
  );
  const studioName = await prompts.ask("Studio name", studio.name);
  const slug = await prompts.ask("Printer profile slug", defaultPrinter.slug);
  const name = await prompts.ask("Printer display name", defaultPrinter.name);
  const x = await prompts.number(
    "Build volume X (mm)",
    defaultPrinter.build_volume_mm.x,
  );
  const y = await prompts.number(
    "Build volume Y (mm)",
    defaultPrinter.build_volume_mm.y,
  );
  const z = await prompts.number(
    "Build volume Z (mm)",
    defaultPrinter.build_volume_mm.z,
  );
  const nozzle = await prompts.number(
    "Nozzle diameter (mm)",
    defaultPrinter.nozzle_diameter_mm,
  );
  const wall = await prompts.number(
    "Minimum wall thickness (mm)",
    defaultPrinter.minimum_wall_mm,
  );
  const detail = await prompts.number(
    "Minimum printable detail (mm)",
    defaultPrinter.minimum_detail_mm,
  );
  const multi = await prompts.confirm(
    "Supports an automated multi-material system?",
    defaultPrinter.supports_multi_material,
  );
  const slots = multi
    ? await prompts.number(
        "Maximum simultaneous material/color slots",
        Math.max(defaultPrinter.max_material_slots, 2),
        true,
      )
    : 1;
  const slicer = await prompts.ask("Preferred slicer", defaultPrinter.slicer);
  const format = (
    await prompts.ask(
      "Preferred package format (3mf or stl)",
      defaultPrinter.package_format,
    )
  ).toLowerCase();
  const selected = materials(
    await prompts.ask("Material types (comma-separated)", defaults.join(",")),
  );
  const printer = validatePrinter({
    slug,
    name,
    build_volume_mm: { x, y, z },
    nozzle_diameter_mm: nozzle,
    minimum_wall_mm: wall,
    minimum_detail_mm: detail,
    supports_multi_material: multi,
    max_material_slots: slots,
    supported_materials: selected,
    slicer,
    package_format: format,
  });
  console.log("");
  console.log(`Studio: ${studioName}`);
  console.log(
    `Printer: ${name} (${slug}), ${formatGeneral(x)} x ${formatGeneral(y)} x ${formatGeneral(z)} mm`,
  );
  console.log(
    `Nozzle: ${formatGeneral(nozzle)} mm; materials: ${selected.join(", ")}; package: ${format}`,
  );
  if (!yes && !(await prompts.confirm("Write this configuration?", true))) {
    console.log("Configuration unchanged");
    return;
  }
  studio.name = studioName;
  studio.default_printer = slug;
  studio.material_config = "config/material/material.yaml";
  const newPrinter = path.join(root, "config/printer", `${slug}.yaml`);
  const newMaterial = path.join(root, studio.material_config);
  const materialConfig = {
    schema_version: "1.0",
    materials: selected.map((key) => {
      const preset = presets[key];
      return {
        slug: key,
        name: preset.name,
        nozzle_temperature_c: {
          minimum: preset.nozzle[0],
          maximum: preset.nozzle[1],
        },
        bed_temperature_c: { minimum: preset.bed[0], maximum: preset.bed[1] },
        minimum_wall_mm: preset.wall,
        shrink_compensation_percent: preset.shrink,
        notes: preset.notes,
      };
    }),
  };
  write(studioFile, studio);
  write(newPrinter, printer);
  write(newMaterial, materialConfig);
  if (previous && previous !== slug) {
    const stale = path.join(root, "config/printer", `${previous}.yaml`);
    if (isFile(stale)) unlinkSync(stale);
  }
  console.log("Configuration written:");
  for (const file of [studioFile, newPrinter, newMaterial])
    console.log(`- ${path.relative(root, file).split(path.sep).join("/")}`);
}
