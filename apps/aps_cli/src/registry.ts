import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse, stringify } from "./yaml.js";
import { copyPreservingMetadata } from "./files.js";
import { checkToolkit, hasToolkit, syncToolkit } from "./toolkit.js";
import {
  comparePaths,
  joinRoot,
  matchesPathSuffix,
  relativePosix,
  requireSlug,
  resolvePath,
} from "./paths.js";

type Entry = {
  kind: string;
  source: string;
  destination: string;
  checksum: string;
};
type Mapping = Record<string, unknown>;

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

function children(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .sort(comparePaths)
    .map((name) => path.join(directory, name));
}

function checksum(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function object(value: unknown, file: string): Mapping {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a YAML mapping in ${file}`);
  }
  return value as Mapping;
}

function yaml(file: string): Mapping {
  const parsed: unknown = parse(readFileSync(file, "utf8"));
  return parsed === null ? {} : object(parsed, file);
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0)
    return false;
  if (typeof value === "string" || Array.isArray(value))
    return value.length > 0;
  if (value instanceof Map || value instanceof Set) return value.size > 0;
  if (value instanceof Date) return true;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function frontmatter(file: string): Mapping {
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---\n"))
    throw new Error(`Missing YAML frontmatter: ${file}`);
  const parts = text.split("---", 3);
  if (parts.length !== 3)
    throw new Error(`Invalid YAML frontmatter in ${file}`);
  const value: unknown = parse(parts[1]);
  const data = object(value, file);
  if (!pythonTruthy(data.name) || !pythonTruthy(data.description)) {
    throw new Error(`Frontmatter must include name and description: ${file}`);
  }
  return data;
}

function nestedFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...nestedFiles(file));
    else if (isFile(file)) files.push(file);
  }
  return files.sort(comparePaths);
}

export function discover(root: string): Entry[] {
  const entries: Entry[] = [];
  const seen = new Map<string, string>();
  const add = (kind: string, source: string, destination: string) => {
    const previous = seen.get(destination);
    if (previous)
      throw new Error(`Registry collision: ${source} and ${previous}`);
    seen.set(destination, source);
    entries.push({ kind, source, destination, checksum: checksum(source) });
  };
  for (const lineDir of children(path.join(root, "product-line"))) {
    if (!statSync(lineDir).isDirectory()) continue;
    const line = requireSlug(path.basename(lineDir), "product line");
    for (const source of children(path.join(lineDir, "ai/agent"))) {
      if (!matchesPathSuffix(source, ".agent.md")) continue;
      frontmatter(source);
      add(
        "agent",
        source,
        path.join(root, ".github/agents", `${line}--${path.basename(source)}`),
      );
    }
    for (const directory of children(path.join(lineDir, "ai/skill"))) {
      const skill = path.join(directory, "SKILL.md");
      if (!isFile(skill)) continue;
      const metadata = frontmatter(skill);
      const local = requireSlug(path.basename(directory), "skill");
      const registered = local.startsWith(`${line}-`)
        ? local
        : `${line}-${local}`;
      if (metadata.name !== registered) {
        throw new Error(
          `Skill name must be '${registered}' for registry synchronization: ${skill}`,
        );
      }
      for (const source of nestedFiles(directory)) {
        add(
          "skill",
          source,
          path.join(
            root,
            ".github/skills",
            registered,
            path.relative(directory, source),
          ),
        );
      }
    }
  }
  return entries;
}

function indexPath(root: string): string {
  const config = yaml(path.join(root, "config/studio.yaml"));
  if (
    config.registry_index !== undefined &&
    typeof config.registry_index !== "string"
  ) {
    throw new Error("registry_index must be a string");
  }
  return joinRoot(
    root,
    (config.registry_index as string | undefined) ?? ".aps/registry.yaml",
  );
}

function indexEntries(file: string): Mapping[] {
  if (!isFile(file)) return [];
  const entries = yaml(file).entries ?? [];
  if (!Array.isArray(entries))
    throw new Error(`Invalid registry entries in ${file}`);
  return entries.map((entry) => object(entry, file));
}

export function sync(root: string, dryRun: boolean): number {
  if (hasToolkit(root)) return syncToolkit(root, dryRun);
  const entries = discover(root);
  const index = indexPath(root);
  const destinations = new Set(
    entries.map((entry) => relativePosix(root, entry.destination)),
  );
  for (const old of indexEntries(index)) {
    if (
      typeof old.destination !== "string" ||
      destinations.has(old.destination)
    )
      continue;
    const stale = resolvePath(joinRoot(root, old.destination));
    const relative = path.relative(root, stale);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Refusing to prune path outside studio root: ${stale}`);
    }
    if (!dryRun && isFile(stale)) {
      unlinkSync(stale);
      if (path.basename(path.dirname(stale)) !== "agents") {
        try {
          rmdirSync(path.dirname(stale));
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            ["ENOTEMPTY", "ENOENT"].includes(String(error.code))
          ))
            throw error;
        }
      }
    }
  }
  if (!dryRun) {
    for (const entry of entries) {
      mkdirSync(path.dirname(entry.destination), { recursive: true });
      if (
        !existsSync(entry.destination) ||
        checksum(entry.destination) !== entry.checksum
      ) {
        copyPreservingMetadata(entry.source, entry.destination);
      }
    }
    mkdirSync(path.dirname(index), { recursive: true });
    writeFileSync(
      index,
      stringify({
        schema_version: "1.0",
        entries: entries.map((entry) => ({
          kind: entry.kind,
          source: relativePosix(root, entry.source),
          destination: relativePosix(root, entry.destination),
          sha256: entry.checksum,
        })),
      }),
    );
  }
  return entries.length;
}

export function check(root: string): string[] {
  if (hasToolkit(root)) return checkToolkit(root);
  const entries = discover(root);
  const index = indexPath(root);
  if (!isFile(index))
    return entries.length
      ? ["Registry index is missing; run `aps registry sync`"]
      : [];
  const indexed = new Map(
    indexEntries(index)
      .filter((entry) => typeof entry.destination === "string")
      .map((entry) => [entry.destination, entry]),
  );
  const errors: string[] = [];
  for (const entry of entries) {
    const relative = relativePosix(root, entry.destination);
    if (!isFile(entry.destination))
      errors.push(`Missing registered ${entry.kind}: ${relative}`);
    else if (checksum(entry.destination) !== entry.checksum)
      errors.push(`Stale registered ${entry.kind}: ${relative}`);
    else if (indexed.get(relative)?.sha256 !== entry.checksum)
      errors.push(`Stale registry index entry: ${relative}`);
  }
  return errors;
}
