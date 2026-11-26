import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { stringify } from "./yaml.js";
import { readArchiveEntry } from "./archive.js";
import { copyPreservingMetadata } from "./files.js";
import { hash } from "./legacy-assets.js";
import { formatGeneral } from "./numbers.js";
import {
  loadProduct,
  loadPrinter,
  loadSlice,
  validateSlice,
  type SliceProfile,
} from "./manifests.js";
import {
  comparePaths,
  matchesPathSuffix,
  requireSlug,
  resolvePath,
} from "./paths.js";

class FloatValue {
  constructor(readonly value: number) {}
}

export function floatString(value: number): string {
  if (!Number.isFinite(value))
    return value > 0 ? "Infinity" : value < 0 ? "-Infinity" : "NaN";
  if (Object.is(value, -0)) return "-0.0";
  if (value === 0) return "0.0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -4 || exponent >= 16) {
    const [mantissa, power] = value.toExponential().split("e");
    const number = Number(power);
    return `${mantissa}e${number >= 0 ? "+" : "-"}${String(Math.abs(number)).padStart(2, "0")}`;
  }
  const text = String(value);
  return text.includes(".") ? text : `${text}.0`;
}

function pythonString(value: unknown): string {
  if (value instanceof FloatValue) return floatString(value.value);
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function array(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(pythonString) : [pythonString(value)];
}

function firstFloat(
  settings: Record<string, unknown>,
  key: string,
): number | null {
  const first = array(settings[key])[0];
  if (first === undefined || !first.trim()) return null;
  const number = Number(first);
  return Number.isNaN(number) ? null : number;
}

function scalar(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  if (value === undefined || value === null || Array.isArray(value))
    return array(value)[0] ?? null;
  return pythonString(value).trim() || null;
}

function compareKeys(a: string, b: string): number {
  const left = Array.from(a, (char) => char.codePointAt(0) ?? 0);
  const right = Array.from(b, (char) => char.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function normalize(value: unknown, depth = 0): string {
  if (value instanceof FloatValue) return floatString(value.value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const indent = "  ".repeat(depth + 1);
    return `[\n${indent}${value.map((item) => normalize(item, depth + 1)).join(`,\n${indent}`)}\n${"  ".repeat(depth)}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => compareKeys(a, b));
    if (!entries.length) return "{}";
    const indent = "  ".repeat(depth + 1);
    return `{\n${indent}${entries.map(([key, item]) => `${JSON.stringify(key)}: ${normalize(item, depth + 1)}`).join(`,\n${indent}`)}\n${"  ".repeat(depth)}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Invalid slicer settings value");
  return result;
}

function parseSettings(text: string): Record<string, unknown> {
  const result: unknown = JSON.parse(
    text,
    (_key: string, value: unknown, context?: { source: string }) =>
      typeof value === "number" && context && /[.eE]/.test(context.source)
        ? new FloatValue(value)
        : value,
  );
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new Error(
      "Metadata/project_settings.config is not a settings mapping",
    );
  return result as Record<string, unknown>;
}

function summarize(settings: Record<string, unknown>) {
  const nozzles = [
    ...new Set(array(settings.nozzle_diameter).filter(Boolean)),
  ].sort();
  const nozzle = firstFloat(settings, "nozzle_diameter");
  const layer = firstFloat(settings, "layer_height");
  const first = firstFloat(settings, "initial_layer_print_height") || layer;
  const walls = firstFloat(settings, "wall_loops");
  const missing = [
    ["nozzle_diameter", nozzle],
    ["layer_height", layer],
    ["wall_loops", walls],
  ]
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (missing.length)
    throw new Error(
      `Project settings are missing required keys: ${missing.join(", ")}`,
    );
  return {
    slicer_version: scalar(settings, "version"),
    printer_model: scalar(settings, "printer_model"),
    printer_settings_id: scalar(settings, "printer_settings_id"),
    print_settings_id: scalar(settings, "print_settings_id"),
    filament_settings_ids: array(settings.filament_settings_id),
    filament_types: array(settings.filament_type),
    nozzle_diameter_mm: nozzle,
    layer_height_mm: layer,
    first_layer_height_mm: first,
    wall_loops: walls === null ? null : Math.trunc(walls),
    sparse_infill_density: scalar(settings, "sparse_infill_density"),
    support_enabled: ["1", "true", "yes", "on"].includes(
      pythonString(settings.enable_support).trim().toLowerCase(),
    ),
    support_type: scalar(settings, "support_type"),
    brim_type: scalar(settings, "brim_type"),
    build_plate: scalar(settings, "curr_bed_type"),
    notes:
      nozzles.length > 1
        ? [`Project declares multiple nozzle diameters: ${nozzles.join(", ")}`]
        : [],
  };
}

export async function capture(
  productDir: string,
  projectPath: string,
  options: { slug?: string; name?: string; note?: string; force: boolean },
): Promise<{ profile: SliceProfile; file: string }> {
  const product = loadProduct(productDir);
  if (!existsSync(projectPath) || !statSync(projectPath).isFile())
    throw new Error(`Project file not found: ${projectPath}`);
  let payload: Buffer;
  try {
    payload = await readArchiveEntry(
      projectPath,
      "Metadata/project_settings.config",
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error.message.includes("There is no item named"))
      throw new Error(
        `${projectPath} contains no Metadata/project_settings.config; it is a plain model 3MF, not a saved slicer project`,
      );
    throw new Error(
      `${projectPath} is not a readable 3MF archive: ${error.message}`,
    );
  }
  const settings = parseSettings(
    new TextDecoder("utf-8", { fatal: true }).decode(payload),
  );
  const summary = summarize(settings);
  const derived =
    options.slug ||
    (summary.print_settings_id || path.parse(projectPath).name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  if (!derived)
    throw new Error(
      `Unable to derive a slug from '${summary.print_settings_id || path.parse(projectPath).name}'`,
    );
  requireSlug(derived, "slice profile slug");
  const directory = path.join(productDir, "slice");
  const file = path.join(directory, `${derived}.yaml`);
  if (existsSync(file) && !options.force)
    throw new Error(
      `Slice profile already exists: ${file}; pass --force to replace`,
    );
  mkdirSync(directory, { recursive: true });
  const relative = path.relative(productDir, projectPath);
  let source: string;
  if (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    source = relative.split(path.sep).join("/");
  } else {
    const stored = path.join(
      directory,
      `${derived}${path.extname(projectPath) || ".3mf"}`,
    );
    copyPreservingMetadata(projectPath, stored);
    source = path.relative(productDir, stored).split(path.sep).join("/");
  }
  const settingsPath = path.join(directory, `${derived}.settings.json`);
  writeFileSync(settingsPath, `${normalize(settings)}\n`);
  const notes = [...summary.notes];
  if (options.note) notes.push(options.note);
  const profile = validateSlice(
    {
      slug: derived,
      name: options.name || summary.print_settings_id || derived,
      product: product.slug,
      printer_profile: product.printer_profile,
      evidence: "captured",
      recorded_at: new Date().toISOString(),
      source,
      source_sha256: hash(path.join(productDir, source)),
      settings_file: path
        .relative(productDir, settingsPath)
        .split(path.sep)
        .join("/"),
      settings_sha256: hash(settingsPath),
      ...summary,
      notes,
    },
    file,
  );
  const data = Object.fromEntries(
    Object.entries(profile).filter(([, value]) => value !== null),
  );
  writeFileSync(file, stringify(data));
  return { profile, file: resolvePath(file) };
}

export function listProfiles(productDir: string): SliceProfile[] {
  const directory = path.join(productDir, "slice");
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .filter((name) => matchesPathSuffix(name, ".yaml"))
    .sort(comparePaths)
    .map((name) => loadSlice(path.join(directory, name)));
}

export function verifySlice(
  productDir: string,
  profile: SliceProfile,
  root: string,
): string[] {
  const errors: string[] = [];
  for (const [label, relative, checksum] of [
    ["project file", profile.source, profile.source_sha256],
    ["settings file", profile.settings_file, profile.settings_sha256],
  ] as const) {
    if (relative === null) continue;
    const file = path.join(productDir, relative);
    if (!existsSync(file) || !statSync(file).isFile())
      errors.push(`slice/${profile.slug}: missing ${label} ${relative}`);
    else if (checksum && hash(file) !== checksum)
      errors.push(
        `slice/${profile.slug}: checksum mismatch for ${label} ${relative}`,
      );
  }
  const file = path.join(
    root,
    "config/printer",
    `${profile.printer_profile}.yaml`,
  );
  if (!existsSync(file) || !statSync(file).isFile()) {
    errors.push(
      `slice/${profile.slug}: unknown printer profile ${profile.printer_profile}`,
    );
    return errors;
  }
  try {
    const printer = loadPrinter(file);
    if (
      Math.abs(printer.nozzle_diameter_mm - profile.nozzle_diameter_mm) > 1e-6
    )
      errors.push(
        `slice/${profile.slug}: slice nozzle ${formatGeneral(profile.nozzle_diameter_mm)} mm contradicts printer profile ${profile.printer_profile} nozzle ${formatGeneral(printer.nozzle_diameter_mm)} mm`,
      );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    errors.push(
      `slice/${profile.slug}: unreadable printer profile: ${error.message}`,
    );
  }
  return errors;
}
