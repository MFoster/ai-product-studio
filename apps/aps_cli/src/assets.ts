import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { stringify } from "./yaml.js";
import { loadGroups, verifyGroups } from "./groups.js";
import { hash } from "./legacy-assets.js";
import {
  loadAssets,
  loadProduct,
  type AssetRecord,
  type Assets,
} from "./manifests.js";
import { comparePaths } from "./paths.js";

const ignored = new Set([
  "assets.yaml",
  "workflow.yaml",
  "product.yaml",
  "AGENTS.md",
  ".DS_Store",
]);

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    )
      return false;
    throw error;
  }
}

function files(directory: string): string[] {
  const result: string[] = [];
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (isFile(file)) result.push(file);
    }
  }
  walk(directory);
  return result.sort(comparePaths);
}

function classify(relative: string): AssetRecord["kind"] {
  const first = relative.split("/")[0];
  if (first === "source")
    return path.extname(relative).toLowerCase() === ".blend1"
      ? "backup"
      : "source";
  if (first === "export" || first === "package" || first === "preview")
    return first;
  return "document";
}

export async function inventoryProduct(productDir: string): Promise<number> {
  const product = loadProduct(productDir);
  const assetsPath = path.join(productDir, "assets.yaml");
  const previous = isFile(assetsPath) ? loadAssets(productDir).assets : [];
  const previousByPath = new Map(previous.map((asset) => [asset.path, asset]));
  const groups = loadGroups(productDir);
  const errors = await verifyGroups(productDir, groups);
  if (errors.length) throw new Error(errors.join("\n"));
  const assets: AssetRecord[] = [];
  for (const file of files(productDir)) {
    if (
      ignored.has(path.basename(file)) ||
      file.split(path.sep).includes("release")
    )
      continue;
    const relative = path.relative(productDir, file).split(path.sep).join("/");
    const extension = path.extname(file).toLowerCase();
    const kind = classify(relative);
    const old = previousByPath.get(relative);
    const record: AssetRecord = {
      path: relative,
      kind,
      format: extension.slice(1) || "none",
      role: old?.role ?? path.basename(file, path.extname(file)),
      sha256: hash(file),
      size_bytes: statSync(file).size,
      release_eligible: kind !== "backup" && (old?.release_eligible ?? true),
    };
    if (old?.source != null) record.source = old.source;
    assets.push(record);
  }
  writeFileSync(
    assetsPath,
    stringify({
      schema_version: "1.0",
      product: product.slug,
      generated_at: new Date().toISOString(),
      assets,
      groups,
    }),
  );
  return assets.length;
}

export function verifyAssetManifest(
  productDir: string,
  manifest: Assets,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (path.basename(asset.path) === ".DS_Store") {
      errors.push(
        `macOS metadata is not an asset: ${asset.path}; run aps assets inventory`,
      );
      continue;
    }
    if (seen.has(asset.path)) {
      errors.push(`Duplicate asset record: ${asset.path}`);
      continue;
    }
    seen.add(asset.path);
    const file = path.join(productDir, asset.path);
    if (!isFile(file)) {
      errors.push(`Missing asset: ${asset.path}`);
      continue;
    }
    if (statSync(file).size !== asset.size_bytes)
      errors.push(`Size mismatch: ${asset.path}`);
    if (hash(file) !== asset.sha256)
      errors.push(`Checksum mismatch: ${asset.path}`);
  }
  try {
    const groups = loadGroups(productDir);
    if (!isDeepStrictEqual(groups, manifest.groups))
      errors.push("Asset group metadata is stale; run aps assets inventory");
    const paths = new Set(manifest.assets.map((asset) => asset.path));
    for (const group of groups) {
      const references = new Set([
        group.package,
        ...group.parts.flatMap((part) => part.meshes.map((mesh) => mesh.asset)),
      ]);
      for (const reference of [...references]
        .filter((item) => !paths.has(item))
        .sort())
        errors.push(
          `Group ${group.id}: referenced asset is not inventoried: ${reference}`,
        );
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    errors.push(error.message);
  }
  return errors;
}
