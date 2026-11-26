import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discover } from "./registry.js";
import { parse } from "./yaml.js";

type Entry = {
  destination: string;
  source: string;
  owner: string;
  sha256: string;
};
type State = { schema_version: "1.0"; version: string; entries: Entry[] };
type Desired = Entry & { content: Buffer };
const statePath = ".toolkit/manifest.json";
const hash = (content: Buffer) =>
  createHash("sha256").update(content).digest("hex");
const bundled = fileURLToPath(new URL("../capabilities/", import.meta.url));
const packageFile = fileURLToPath(new URL("../package.json", import.meta.url));

export function hasToolkit(root: string): boolean {
  return existsSync(path.join(root, statePath));
}

function safe(root: string, relative: string): string {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    path.posix.isAbsolute(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Unsafe managed path: ${relative}`);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Managed paths cannot contain symlinks: ${relative}`);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
  }
  return current;
}

function managed(value: string): boolean {
  return (
    /^\.github\/(?:agents|skills|instructions)\/.+/.test(value) ||
    /^\.specify\/(?:scripts|templates)\/.+/.test(value) ||
    /^template\/(?:agent|skill|blender)\/.+/.test(value) ||
    [".specify/.gitignore", ".specify/UPSTREAM-LICENSE"].includes(value)
  );
}

function state(root: string): State | null {
  const file = safe(root, statePath);
  if (!existsSync(file)) return null;
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    !("schema_version" in data) ||
    data.schema_version !== "1.0" ||
    !("version" in data) ||
    typeof data.version !== "string" ||
    !("entries" in data) ||
    !Array.isArray(data.entries)
  )
    throw new Error("Invalid toolkit ownership manifest.");
  const seen = new Set<string>();
  const entries: Entry[] = data.entries.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("destination" in entry) ||
      typeof entry.destination !== "string" ||
      !managed(entry.destination) ||
      !("source" in entry) ||
      typeof entry.source !== "string" ||
      !("owner" in entry) ||
      typeof entry.owner !== "string" ||
      !("sha256" in entry) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      seen.has(entry.destination)
    )
      throw new Error("Invalid toolkit ownership entry.");
    safe(root, entry.destination);
    seen.add(entry.destination);
    return {
      destination: entry.destination,
      source: entry.source,
      owner: entry.owner,
      sha256: entry.sha256,
    };
  });
  return { schema_version: "1.0", version: data.version, entries };
}

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Capability sources cannot be symlinks: ${file}`);
      if (entry.isDirectory()) return files(file);
      if (!entry.isFile()) throw new Error(`Not a capability file: ${file}`);
      return [file];
    });
}

function desired(root: string, resources: string): Desired[] {
  if (!existsSync(path.join(resources, ".github")))
    throw new Error(
      "Bundled capabilities are missing; run npm run build:toolchain.",
    );
  const entries: Desired[] = [];
  const seen = new Set<string>();
  const add = (
    file: string,
    destination: string,
    owner: string,
    source: string,
  ) => {
    if (seen.has(destination))
      throw new Error(`Capability collision: ${destination}`);
    if (!managed(destination))
      throw new Error(`Unsupported capability destination: ${destination}`);
    safe(root, destination);
    const content = readFileSync(file);
    entries.push({
      destination,
      owner,
      source,
      sha256: hash(content),
      content,
    });
    seen.add(destination);
  };
  for (const directory of [".github", ".specify", "template"])
    for (const file of files(path.join(resources, directory))) {
      const relative = path.relative(resources, file).split(path.sep).join("/");
      add(file, relative, "toolkit", relative);
    }
  for (const kind of ["agent", "skill"] as const) {
    const directory = safe(root, `ai/${kind}`);
    if (kind === "skill" && existsSync(directory))
      for (const entry of readdirSync(directory, { withFileTypes: true }))
        if (
          entry.isDirectory() &&
          !existsSync(path.join(directory, entry.name, "SKILL.md"))
        )
          throw new Error(`Studio skill is missing SKILL.md: ${entry.name}`);
    for (const file of files(directory)) {
      const relative = path.relative(directory, file).split(path.sep).join("/");
      const destination = `.github/${kind}s/${relative}`;
      if (kind === "agent" && !relative.endsWith(".agent.md"))
        throw new Error(`Studio agents must use .agent.md: ${relative}`);
      if (kind === "skill" && !relative.includes("/"))
        throw new Error(`Studio skills require a named directory: ${relative}`);
      if (kind === "agent" || relative.endsWith("/SKILL.md")) {
        const text = readFileSync(file, "utf8");
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        const metadata: unknown = match ? parse(match[1]) : null;
        if (
          !metadata ||
          typeof metadata !== "object" ||
          !("name" in metadata) ||
          typeof metadata.name !== "string" ||
          !metadata.name.trim() ||
          !("description" in metadata) ||
          typeof metadata.description !== "string" ||
          !metadata.description.trim()
        )
          throw new Error(`Invalid capability frontmatter: ${file}`);
        if (kind === "skill" && metadata.name !== relative.split("/")[0])
          throw new Error(`Skill name must match directory: ${file}`);
      }
      add(file, destination, "studio", `ai/${kind}/${relative}`);
    }
  }
  for (const entry of discover(root)) {
    const source = path.relative(root, entry.source).split(path.sep).join("/");
    safe(root, source);
    const destination = path
      .relative(root, entry.destination)
      .split(path.sep)
      .join("/");
    add(entry.source, destination, "product-line", source);
  }
  return entries;
}

export function syncToolkit(
  root: string,
  dryRun = false,
  resources = bundled,
  report: (message: string) => void = () => {},
): number {
  const previous = state(root);
  const entries = desired(root, resources);
  const old = new Map(
    previous?.entries.map((entry) => [entry.destination, entry]),
  );
  const next = new Map(entries.map((entry) => [entry.destination, entry]));
  for (const destination of new Set([...old.keys(), ...next.keys()])) {
    const target = safe(root, destination);
    if (!existsSync(target)) continue;
    const former = old.get(destination);
    const wanted = next.get(destination);
    if (!former)
      throw new Error(`Refusing to overwrite unowned file: ${destination}`);
    if (wanted && former.owner !== wanted.owner)
      throw new Error(`Capability ownership changed: ${destination}`);
    if (hash(readFileSync(target)) !== former.sha256)
      throw new Error(
        `Refusing to overwrite or remove edited managed file: ${destination}`,
      );
  }
  const seeds = [
    ["seed/constitution.md", ".specify/memory/constitution.md"],
    ["seed/integration.json", ".specify/integration.json"],
  ].map(([source, destination]) => ({
    source: path.join(resources, source),
    destination,
    target: safe(root, destination),
  }));
  const target = safe(root, statePath);
  const temporary = safe(root, `${statePath}.tmp`);
  if (existsSync(temporary))
    throw new Error(`Unfinished toolkit update exists: ${temporary}`);
  const version: string = JSON.parse(readFileSync(packageFile, "utf8")).version;
  for (const entry of entries) {
    const former = old.get(entry.destination);
    if (!existsSync(safe(root, entry.destination)))
      report(`Create ${entry.destination}`);
    else if (former?.sha256 !== entry.sha256)
      report(`Update ${entry.destination}`);
  }
  for (const entry of previous?.entries ?? [])
    if (!next.has(entry.destination)) report(`Remove ${entry.destination}`);
  for (const seed of seeds)
    if (!existsSync(seed.target) && existsSync(seed.source))
      report(`Seed ${seed.destination}`);
  if (previous?.version !== version)
    report(
      `Toolkit version: ${previous?.version ?? "not installed"} -> ${version}`,
    );
  if (dryRun) return entries.length;
  for (const entry of entries) {
    const target = safe(root, entry.destination);
    if (
      existsSync(target) &&
      old.get(entry.destination)?.sha256 === entry.sha256
    )
      continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.content, {
      mode: entry.destination.endsWith(".sh") ? 0o755 : 0o644,
    });
  }
  for (const entry of previous?.entries ?? [])
    if (!next.has(entry.destination)) {
      const target = safe(root, entry.destination);
      if (existsSync(target)) unlinkSync(target);
    }
  for (const seed of seeds)
    if (!existsSync(seed.target) && existsSync(seed.source)) {
      mkdirSync(path.dirname(seed.target), { recursive: true });
      writeFileSync(seed.target, readFileSync(seed.source), { flag: "wx" });
    }
  const manifest: State = {
    schema_version: "1.0",
    version,
    entries: entries.map(({ content: _content, ...entry }) => entry),
  };
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  renameSync(temporary, target);
  return entries.length;
}

export function checkToolkit(root: string, resources = bundled): string[] {
  const previous = state(root);
  if (!previous)
    return ["Toolkit is not synchronized; run `aps toolkit sync`."];
  const entries = desired(root, resources);
  const old = new Map(
    previous.entries.map((entry) => [entry.destination, entry]),
  );
  const errors: string[] = [];
  const version = JSON.parse(readFileSync(packageFile, "utf8")).version;
  if (previous.version !== version)
    errors.push(`Toolkit version changed: ${previous.version} -> ${version}`);
  for (const entry of entries) {
    const target = safe(root, entry.destination);
    const former = old.get(entry.destination);
    if (
      !former ||
      former.sha256 !== entry.sha256 ||
      former.owner !== entry.owner ||
      !existsSync(target) ||
      hash(readFileSync(target)) !== entry.sha256
    )
      errors.push(`Stale toolkit capability: ${entry.destination}`);
    old.delete(entry.destination);
  }
  for (const entry of old.values())
    errors.push(`Obsolete toolkit capability: ${entry.destination}`);
  return errors;
}
