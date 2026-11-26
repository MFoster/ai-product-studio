import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "./yaml.js";
import {
  normalizeRelativePath,
  requireSlug as slug,
  unsafeRelativePath,
} from "./paths.js";

type Options = { force: boolean; dryRun: boolean };
type Mapping = Record<string, unknown>;

function write(file: string, content: string, options: Options): void {
  if (existsSync(file) && !options.force) {
    throw new Error(`Refusing to overwrite existing file: ${file}`);
  }
  if (!options.dryRun) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function manifest(file: string, data: Mapping, options: Options): void {
  write(file, stringify(data), options);
}

function mapping(file: string): Mapping {
  const parsed: unknown = parse(readFileSync(file, "utf8"));
  if (parsed === null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a YAML mapping in ${file}`);
  }
  return parsed as Mapping;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function strings(value: unknown, label: string, slugs = false): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value.map((item) => {
    const text = string(item, label);
    return slugs ? slug(text, label) : text;
  });
}

function fields(data: Mapping, allowed: string[]): void {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
  }
  if (data.schema_version !== undefined && data.schema_version !== "1.0") {
    throw new Error("schema_version must be 1.0");
  }
}

function defaultValue(data: Mapping, key: string, value: unknown): unknown {
  return data[key] === undefined ? value : data[key];
}

function studio(data: Mapping): Mapping {
  fields(data, [
    "schema_version",
    "name",
    "default_printer",
    "material_config",
    "product_lines",
    "registry_index",
  ]);
  const material = string(
    defaultValue(data, "material_config", "config/material/material.yaml"),
    "material_config",
  );
  if (unsafeRelativePath(material)) {
    throw new Error("material_config must be a path inside the studio");
  }
  return {
    schema_version: "1.0",
    name: string(data.name, "name"),
    default_printer: slug(
      string(data.default_printer, "default_printer"),
      "default_printer",
    ),
    material_config: normalizeRelativePath(material),
    product_lines: strings(
      defaultValue(data, "product_lines", []),
      "product_lines",
      true,
    ),
    registry_index: string(
      defaultValue(data, "registry_index", ".aps/registry.yaml"),
      "registry_index",
    ),
  };
}

function productLine(data: Mapping): Mapping {
  fields(data, [
    "schema_version",
    "slug",
    "name",
    "description",
    "audience",
    "design_language",
    "default_workflow",
    "variants",
  ]);
  return {
    schema_version: "1.0",
    slug: slug(string(data.slug, "slug"), "slug"),
    name: string(data.name, "name"),
    description: string(defaultValue(data, "description", ""), "description"),
    audience: strings(defaultValue(data, "audience", []), "audience"),
    design_language: strings(
      defaultValue(data, "design_language", []),
      "design_language",
    ),
    default_workflow: strings(
      defaultValue(data, "default_workflow", [
        "brief",
        "design",
        "review",
        "print-validation",
        "release",
      ]),
      "default_workflow",
    ),
    variants: strings(defaultValue(data, "variants", []), "variants", true),
  };
}

function variant(data: Mapping): Mapping {
  fields(data, [
    "schema_version",
    "slug",
    "name",
    "theme",
    "palette",
    "constraints",
    "products",
  ]);
  const palette = defaultValue(data, "palette", {});
  if (
    typeof palette !== "object" ||
    palette === null ||
    Array.isArray(palette)
  ) {
    throw new Error("palette must be a mapping");
  }
  for (const value of Object.values(palette)) string(value, "palette");
  return {
    schema_version: "1.0",
    slug: slug(string(data.slug, "slug"), "slug"),
    name: string(data.name, "name"),
    theme: string(defaultValue(data, "theme", ""), "theme"),
    palette,
    constraints: strings(defaultValue(data, "constraints", []), "constraints"),
    products: strings(defaultValue(data, "products", []), "products", true),
  };
}

function append(
  file: string,
  convert: (data: Mapping) => Mapping,
  field: string,
  value: string,
  options: Options,
): void {
  if (options.dryRun && !existsSync(file)) return;
  const data = convert(mapping(file));
  const values = strings(data[field], field, true);
  if (values.includes(value) || options.dryRun) return;
  data[field] = [...values, value].sort();
  manifest(file, data, { ...options, force: true });
}

function directories(root: string, names: string[], dryRun: boolean): void {
  if (!dryRun)
    for (const name of names)
      mkdirSync(path.join(root, name), { recursive: true });
}

export function initialize(
  destination: string,
  name: string,
  options: Options,
): string {
  const studioFile = path.join(destination, "config/studio.yaml");
  if (existsSync(studioFile) && !options.force) {
    throw new Error(`Studio already exists: ${destination}`);
  }
  manifest(
    studioFile,
    studio({ name, default_printer: "generic-fdm" }),
    options,
  );
  manifest(
    path.join(destination, "config/printer/generic-fdm.yaml"),
    {
      schema_version: "1.0",
      slug: "generic-fdm",
      name: "Generic FDM Printer",
      technology: "FDM",
      build_volume_mm: { x: 220, y: 220, z: 250 },
      nozzle_diameter_mm: 0.4,
      minimum_wall_mm: 1.2,
      minimum_detail_mm: 0.8,
      supports_multi_material: false,
      max_material_slots: 1,
      supported_materials: ["pla", "petg"],
      slicer: "Generic slicer",
      package_format: "3mf",
      slicing: "manual",
    },
    options,
  );
  manifest(
    path.join(destination, "config/material/material.yaml"),
    {
      schema_version: "1.0",
      materials: [
        {
          slug: "pla",
          name: "PLA",
          nozzle_temperature_c: { minimum: 190, maximum: 230 },
          bed_temperature_c: { minimum: 45, maximum: 65 },
          minimum_wall_mm: 1.2,
          shrink_compensation_percent: 0.2,
          notes: ["General-purpose rigid filament with low warping."],
        },
        {
          slug: "petg",
          name: "PETG",
          nozzle_temperature_c: { minimum: 220, maximum: 260 },
          bed_temperature_c: { minimum: 70, maximum: 90 },
          minimum_wall_mm: 1.2,
          shrink_compensation_percent: 0.4,
          notes: [
            "Durable filament with good layer adhesion; manage stringing.",
          ],
        },
      ],
    },
    options,
  );
  write(
    path.join(destination, "AGENTS.md"),
    `# ${name} agent instructions

Read the nearest \`AGENTS.md\` and applicable manifests before changing product assets.
Use millimeters for printable geometry. Keep source, export, package, preview, and
release assets separate. Do not claim slicing or physical print success without evidence.
Run registry synchronization, asset inventory, and validation before release.
`,
    options,
  );
  directories(
    destination,
    [
      ".github/agents",
      ".github/skills",
      ".github/instructions",
      "product-line",
      "schema",
      "template",
    ],
    options.dryRun,
  );
  for (const [file, content] of [
    [".gitignore", ".DS_Store\n.aps/\n*.blend2\n*.blend@\n"],
    [
      ".gitattributes",
      "* text=auto eol=lf\n\n*.blend binary\n*.blend1 binary\n*.stl binary\n*.3mf binary\n*.png binary\n*.jpg binary\n*.jpeg binary\n",
    ],
    ["product-line/.gitkeep", ""],
  ]) {
    const target = path.join(destination, file);
    if (!existsSync(target))
      write(target, content, { ...options, force: false });
  }
  return destination;
}

export function createLine(
  root: string,
  id: string,
  name: string,
  description: string,
  options: Options,
): string {
  const destination = path.join(root, "product-line", slug(id, "product line"));
  if (existsSync(destination) && !options.force)
    throw new Error(`Product line already exists: ${destination}`);
  manifest(
    path.join(destination, "product-line.yaml"),
    productLine({ slug: id, name, description }),
    options,
  );
  write(
    path.join(destination, "AGENTS.md"),
    `# ${name} agent instructions

Read \`product-line.yaml\` and the active variant and product manifests before editing assets.
Preserve the product line's design language, shared mechanics, naming, and workflow gates.
Product-local agents and skills under \`ai/\` are authoritative; synchronize them with
\`aps registry sync\` rather than editing generated root copies.
`,
    options,
  );
  directories(
    destination,
    ["brief", "ai/agent", "ai/skill", "variant"],
    options.dryRun,
  );
  const parent = path.join(root, "config/studio.yaml");
  if (existsSync(parent)) append(parent, studio, "product_lines", id, options);
  return destination;
}

export function createVariant(
  root: string,
  line: string,
  id: string,
  name: string,
  theme: string,
  options: Options,
): string {
  const parent = path.join(root, "product-line", slug(line, "product line"));
  const destination = path.join(parent, "variant", slug(id, "variant"));
  if (existsSync(destination) && !options.force)
    throw new Error(`Variant already exists: ${destination}`);
  manifest(
    path.join(destination, "variant.yaml"),
    variant({ slug: id, name, theme }),
    options,
  );
  write(
    path.join(destination, "AGENTS.md"),
    `# ${name} variant instructions

Read \`variant.yaml\`, the parent product-line instructions, and each product manifest.
Apply this variant's theme, palette, and constraints consistently across its catalog.
Do not weaken shared mechanical interfaces without recording an explicit product exception.
`,
    options,
  );
  append(
    path.join(parent, "product-line.yaml"),
    productLine,
    "variants",
    id,
    options,
  );
  return destination;
}

export function createProduct(
  root: string,
  line: string,
  variantId: string,
  id: string,
  name: string,
  summary: string,
  options: Options,
): string {
  const parent = path.join(
    root,
    "product-line",
    slug(line, "product line"),
    "variant",
    slug(variantId, "variant"),
  );
  const destination = path.join(parent, slug(id, "product"));
  if (existsSync(destination) && !options.force)
    throw new Error(`Product already exists: ${destination}`);
  const config = studio(mapping(path.join(root, "config/studio.yaml")));
  manifest(
    path.join(destination, "product.yaml"),
    {
      schema_version: "1.0",
      slug: id,
      name,
      summary,
      intended_use: "",
      dimensions_mm: {},
      printer_profile: config.default_printer,
      components: [],
      output_formats: ["blend", "stl", "3mf", "png"],
    },
    options,
  );
  manifest(
    path.join(destination, "workflow.yaml"),
    {
      schema_version: "1.0",
      product: id,
      current_stage: "brief",
      approvals: {},
      blockers: [],
      physical_print_status: "pending",
      history: [],
    },
    options,
  );
  write(
    path.join(destination, "AGENTS.md"),
    `# ${name} product instructions

Read \`product.yaml\`, \`workflow.yaml\`, \`assets.yaml\` when present, and all parent
\`AGENTS.md\` files before changing this product.
Keep canonical editable files in \`source/\`, generated meshes in \`export/\`, slicer
packages in \`package/\`, renders in \`preview/\`, and immutable versions in \`release/\`.
Never mark a physical print as passed without recorded test-print evidence.
`,
    options,
  );
  directories(
    destination,
    [
      "source",
      "export/stl",
      "package",
      "preview",
      "script",
      "review",
      "release",
    ],
    options.dryRun,
  );
  append(path.join(parent, "variant.yaml"), variant, "products", id, options);
  return destination;
}
