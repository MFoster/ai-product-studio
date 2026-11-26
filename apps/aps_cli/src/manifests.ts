import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "./yaml.js";
import { Ajv, type ValidateFunction } from "ajv";
import { parseDecimal } from "./numbers.js";
import { normalizeRelativePath, unsafeRelativePath } from "./paths.js";

const require = createRequire(import.meta.url);
const addFormats: (ajv: Ajv) => void = require("ajv-formats");
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  strictNumbers: false,
  useDefaults: true,
});
addFormats(ajv);
ajv.addFormat("date-time", {
  type: "string",
  validate(value: string): boolean {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(
        value,
      );
    if (!match) return false;
    const [, year, month, day, hour, minute, second] = match;
    const m = Number(month);
    const d = Number(day);
    const y = Number(year);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) return false;
    return (
      hour === undefined ||
      (Number(hour) <= 23 &&
        Number(minute) <= 59 &&
        Number(second) <= 59 &&
        !Number.isNaN(
          Date.parse(
            `${value.replace(" ", "T")}${/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? "" : "Z"}`,
          ),
        ))
    );
  },
});
const validators = new Map<string, ValidateFunction>();
const schemas = new Map<string, Record<string, unknown>>();

export type {
  WorkflowStage,
  Workflow,
  Product,
  Printer,
  Studio,
  AssetRecord,
  AssetGroup,
  Assets,
  SliceProfile,
} from "@mfoster/aps-contracts";
import {
  readSchema,
  type WorkflowStage,
  type Workflow,
  type Product,
  type Printer,
  type Studio,
  type AssetRecord,
  type AssetGroup,
  type Assets,
  type SliceProfile,
} from "@mfoster/aps-contracts";

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setDefault(
  mapping: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (!(key in mapping)) mapping[key] = value;
}

function groupDefaults(groups: unknown): void {
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!isMapping(group)) continue;
    setDefault(group, "layout", {});
    for (const key of ["name", "revision"]) {
      if (typeof group[key] === "string") group[key] = group[key].trim();
    }
    for (const collection of [group.materials, group.parts]) {
      if (!Array.isArray(collection)) continue;
      for (const item of collection) {
        if (isMapping(item) && typeof item.name === "string")
          item.name = item.name.trim();
      }
    }
  }
}

function fixPatternAnchors(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) fixPatternAnchors(item);
  } else if (isMapping(value)) {
    if (typeof value.pattern === "string" && value.pattern.endsWith("$"))
      value.pattern = `${value.pattern.slice(0, -1)}(?![\\s\\S])`;
    for (const item of Object.values(value)) fixPatternAnchors(item);
  }
}

function coerce(
  value: unknown,
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  definition = "",
): unknown {
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/$defs/")) {
    const name = schema.$ref.slice("#/$defs/".length);
    const definitions = root.$defs;
    if (isMapping(definitions) && isMapping(definitions[name]))
      return coerce(value, definitions[name], root, name);
  }
  if (Array.isArray(schema.anyOf) && value !== null) {
    const branch = schema.anyOf.find(
      (item: unknown) => isMapping(item) && item.type !== "null",
    );
    if (isMapping(branch)) return coerce(value, branch, root, definition);
  }
  if (schema.format === "date-time" && value instanceof Date)
    return value.toISOString();
  if (
    schema.format === "date-time" &&
    (typeof value === "number" ||
      (typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(value)))
  ) {
    const timestamp = Number(value);
    const milliseconds =
      Math.abs(timestamp) > 20_000_000_000 ? timestamp : timestamp * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  if (
    schema.type === "number" ||
    (schema.type === "integer" && definition !== "strict-quantity")
  ) {
    if (typeof value === "boolean") value = Number(value);
    else if (typeof value === "string") {
      const text = value.trim();
      const number = parseDecimal(text);
      if (number !== undefined) {
        if (schema.type === "number" || Number.isInteger(number))
          value = number;
      } else if (
        schema.type === "number" &&
        /^[+-]?(?:inf(?:inity)?|nan)$/i.test(text)
      )
        value = text.toLowerCase().includes("nan")
          ? NaN
          : text.startsWith("-")
            ? -Infinity
            : Infinity;
    }
    if (
      typeof value === "number" &&
      Number.isNaN(value) &&
      ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].some(
        (key) => key in schema,
      )
    )
      throw new Error("number must satisfy its bounds");
  }
  if (schema.type === "boolean") {
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === "string") {
      const text = value.toLowerCase();
      if (["1", "true", "t", "yes", "y", "on"].includes(text)) return true;
      if (["0", "false", "f", "no", "n", "off"].includes(text)) return false;
    }
  }
  if (Array.isArray(value) && isMapping(schema.items))
    return value.map((item) =>
      coerce(item, schema.items as Record<string, unknown>, root, definition),
    );
  if (isMapping(value) && !(value instanceof Date)) {
    const properties = schema.properties;
    for (const [key, item] of Object.entries(value)) {
      const property =
        isMapping(properties) && isMapping(properties[key])
          ? properties[key]
          : isMapping(schema.additionalProperties)
            ? schema.additionalProperties
            : undefined;
      if (property)
        value[key] = coerce(
          item,
          property,
          root,
          definition === "GroupPart" && key === "quantity"
            ? "strict-quantity"
            : definition,
        );
    }
  }
  return value;
}

function validate<T>(
  file: string,
  schemaName: string,
  defaults: Record<string, unknown>,
): T {
  const parsed: unknown = parse(readFileSync(file, "utf8"));
  return validateData(
    parsed === null ? {} : parsed,
    file,
    schemaName,
    defaults,
  );
}

function validateData<T>(
  data: unknown,
  file: string,
  schemaName: string,
  defaults: Record<string, unknown>,
): T {
  if (!isMapping(data)) throw new Error(`Expected a YAML mapping in ${file}`);
  for (const [key, value] of Object.entries(defaults))
    setDefault(data, key, value);
  if (schemaName === "asset" || schemaName === "group")
    groupDefaults(data.groups);
  let validator = validators.get(schemaName);
  if (!validator) {
    const schema: unknown = readSchema(schemaName);
    if (!isMapping(schema)) throw new Error(`Invalid schema: ${schemaName}`);
    fixPatternAnchors(schema);
    validator = ajv.compile(schema);
    validators.set(schemaName, validator);
    schemas.set(schemaName, schema);
  }
  const schema = schemas.get(schemaName);
  if (!schema) throw new Error(`Missing schema: ${schemaName}`);
  coerce(data, schema, schema);
  if (!validator(data)) {
    throw new Error(
      `${file}: ${ajv.errorsText(validator.errors, { separator: "; " })}`,
    );
  }
  return data as T;
}

function validateGroupPaths(groups: AssetGroup[]): void {
  const ids = new Set<string>();
  const packages = new Set<string>();
  for (const group of groups) {
    if (
      !Number.isFinite(group.layout.spacing_mm) ||
      !Number.isFinite(group.layout.margin_mm)
    )
      throw new Error("group layout values must be finite");
    group.package = productAssetPath(group.package);
    if (
      !group.package.startsWith("package/") ||
      path.extname(group.package).toLowerCase() !== ".3mf"
    )
      throw new Error("group package targets must be 3MF paths under package/");
    if (ids.has(group.id) || packages.has(group.package))
      throw new Error(
        "group IDs and package targets must be unique within a product",
      );
    ids.add(group.id);
    packages.add(group.package);
    const materials = new Set<string>();
    for (const material of group.materials) {
      if (materials.has(material.id))
        throw new Error(
          "part IDs and material IDs must be unique within a group",
        );
      materials.add(material.id);
    }
    const parts = new Set<string>();
    for (const part of group.parts) {
      if (parts.has(part.id))
        throw new Error(
          "part IDs and material IDs must be unique within a group",
        );
      parts.add(part.id);
      const meshes = new Set<string>();
      for (const mesh of part.meshes) {
        mesh.asset = productAssetPath(mesh.asset);
        if (
          !mesh.asset.startsWith("export/") ||
          path.extname(mesh.asset).toLowerCase() !== ".stl"
        )
          throw new Error(
            "group meshes must reference STL assets under export/",
          );
        if (meshes.has(mesh.asset))
          throw new Error("a physical part cannot contain the same mesh twice");
        meshes.add(mesh.asset);
        if (!materials.has(mesh.material))
          throw new Error(
            `group meshes reference unknown materials: ${mesh.material}`,
          );
      }
    }
  }
}

function productAssetPath(value: string): string {
  if (
    !value ||
    value === "." ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").includes("..")
  )
    throw new Error(
      "references must be relative POSIX paths inside the product directory",
    );
  return normalizeRelativePath(value);
}

export function loadWorkflow(productDir: string): Workflow {
  return validate(path.join(productDir, "workflow.yaml"), "workflow", {
    approvals: {},
    blockers: [],
    history: [],
  });
}

export function loadProduct(productDir: string): Product {
  return validate(path.join(productDir, "product.yaml"), "product", {
    dimensions_mm: {},
    components: [],
    output_formats: ["blend", "stl", "3mf", "png"],
  });
}

export function loadPrinter(file: string): Printer {
  return checkPrinter(
    validate<Printer>(file, "printer", {
      supported_materials: ["pla"],
    }),
  );
}

export function validatePrinter(data: unknown): Printer {
  return checkPrinter(
    validateData<Printer>(data, "printer profile", "printer", {
      supported_materials: ["pla"],
    }),
  );
}

function checkPrinter(printer: Printer): Printer {
  const axes = Object.keys(printer.build_volume_mm).sort();
  if (
    axes.join(",") !== "x,y,z" ||
    axes.some((axis) => printer.build_volume_mm[axis] <= 0)
  )
    throw new Error(
      "build_volume_mm must contain positive x, y, and z dimensions",
    );
  if (!printer.supports_multi_material && printer.max_material_slots !== 1)
    throw new Error(
      "max_material_slots must be 1 when multi-material support is disabled",
    );
  return printer;
}

export function loadStudio(file: string): Studio {
  const studio = validate<Studio>(file, "studio", {
    product_lines: [],
  });
  if (unsafeRelativePath(studio.material_config))
    throw new Error("material_config must be a path inside the studio");
  studio.material_config = normalizeRelativePath(studio.material_config);
  return studio;
}

export function loadMaterial(file: string): { materials: { slug: string }[] } {
  const material = validate<{
    materials: {
      slug: string;
      nozzle_temperature_c: { minimum: number; maximum: number };
      bed_temperature_c: { minimum: number; maximum: number };
    }[];
  }>(file, "material", {});
  const slugs = new Set<string>();
  for (const item of material.materials) {
    if (slugs.has(item.slug)) throw new Error("material slugs must be unique");
    slugs.add(item.slug);
    for (const range of [item.nozzle_temperature_c, item.bed_temperature_c])
      if (range.maximum < range.minimum)
        throw new Error(
          "maximum temperature must be greater than or equal to minimum",
        );
  }
  return material;
}

export function loadLine(file: string): void {
  validate(file, "product-line", {
    audience: [],
    design_language: [],
    default_workflow: [
      "brief",
      "design",
      "review",
      "print-validation",
      "release",
    ],
    variants: [],
  });
}

export function loadVariant(file: string): void {
  validate(file, "variant", { palette: {}, constraints: [], products: [] });
}

export function loadAssets(productDir: string): Assets {
  const assets = validate<Assets>(
    path.join(productDir, "assets.yaml"),
    "asset",
    {
      assets: [],
      groups: [],
    },
  );
  for (const asset of assets.assets) {
    if (unsafeRelativePath(asset.path))
      throw new Error(
        "asset paths must be relative and remain inside the product directory",
      );
    asset.path = normalizeRelativePath(asset.path);
  }
  validateGroupPaths(assets.groups);
  return assets;
}

export function loadGroupManifest(file: string): {
  product: string;
  groups: AssetGroup[];
} {
  const manifest = validate<{ product: string; groups: AssetGroup[] }>(
    file,
    "group",
    { groups: [] },
  );
  validateGroupPaths(manifest.groups);
  return manifest;
}

export function validateSlice(data: unknown, label: string): SliceProfile {
  const slice = validateData<SliceProfile>(data, label, "slice", {
    filament_settings_ids: [],
    filament_types: [],
    notes: [],
  });
  for (const key of ["source", "settings_file"] as const) {
    const value = slice[key];
    if (value === null) continue;
    if (unsafeRelativePath(value))
      throw new Error(
        "slice profile references must stay inside the product directory",
      );
    slice[key] = normalizeRelativePath(value);
  }
  if (slice.evidence === "captured" && !(slice.source && slice.settings_file))
    throw new Error(
      "captured slice profiles must reference the project file and extracted settings",
    );
  return slice;
}

export function loadSlice(file: string): SliceProfile {
  const data: unknown = parse(readFileSync(file, "utf8"));
  return validateSlice(data === null ? {} : data, file);
}
