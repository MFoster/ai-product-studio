import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readArchiveEntry } from "./archive.js";
import { hash } from "./legacy-assets.js";
import {
  loadGroupManifest,
  loadProduct,
  type AssetGroup,
} from "./manifests.js";
import { resolvePath } from "./paths.js";

export function resolveGroupAsset(
  productDir: string,
  relative: string,
): string {
  const root = resolvePath(productDir);
  const result = resolvePath(path.join(root, relative));
  const outside = path.relative(root, result);
  if (
    outside === ".." ||
    outside.startsWith(`..${path.sep}`) ||
    path.isAbsolute(outside)
  )
    throw new Error(`Group asset escapes product directory: ${relative}`);
  return result;
}

export function loadGroups(productDir: string): AssetGroup[] {
  const file = path.join(productDir, "groups.yaml");
  if (!existsSync(file) || !statSync(file).isFile()) return [];
  const manifest = loadGroupManifest(file);
  const product = loadProduct(productDir);
  if (manifest.product !== product.slug)
    throw new Error(`${file}: product must be ${product.slug}`);
  return manifest.groups;
}

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

export async function verifyGroups(
  productDir: string,
  groups: AssetGroup[],
  requirePackages = true,
): Promise<string[]> {
  const errors: string[] = [];
  for (const group of groups) {
    for (const part of group.parts) {
      for (const mesh of part.meshes) {
        let file: string;
        try {
          file = resolveGroupAsset(productDir, mesh.asset);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          errors.push(error.message);
          continue;
        }
        if (!isFile(file))
          errors.push(
            `Group ${group.id}/${part.id}: missing mesh: ${mesh.asset}`,
          );
        else if (hash(file) !== mesh.sha256)
          errors.push(
            `Group ${group.id}/${part.id}: mesh checksum mismatch: ${mesh.asset}`,
          );
      }
    }
    let packageFile: string;
    try {
      packageFile = resolveGroupAsset(productDir, group.package);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.push(error.message);
      continue;
    }
    if (!requirePackages) continue;
    if (!isFile(packageFile)) {
      errors.push(`Group ${group.id}: missing package: ${group.package}`);
      continue;
    }
    try {
      const embedded: unknown = JSON.parse(
        (
          await readArchiveEntry(packageFile, "Metadata/aps_group.json")
        ).toString("utf8"),
      );
      if (
        embedded === null ||
        typeof embedded !== "object" ||
        !("group" in embedded)
      )
        throw new Error("Missing group metadata");
      if (!isDeepStrictEqual(embedded.group, group))
        errors.push(
          `Group ${group.id}: package metadata is stale; build a new package revision`,
        );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.push(
        `Group ${group.id}: invalid group package ${group.package}: ${error.message}`,
      );
    }
  }
  return errors;
}
