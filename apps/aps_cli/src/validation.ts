import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "./yaml.js";
import { verifyAssetManifest } from "./assets.js";
import { loadGroups, verifyGroups } from "./groups.js";
import {
  loadAssets,
  loadLine,
  loadMaterial,
  loadPrinter,
  loadProduct,
  loadSlice,
  loadStudio,
  loadVariant,
  loadWorkflow,
} from "./manifests.js";
import { check as checkRegistry } from "./registry.js";
import { comparePaths, matchesPathSuffix } from "./paths.js";
import { verifySlice } from "./slicer.js";

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

function children(directory: string): string[] {
  try {
    return readdirSync(directory)
      .sort(comparePaths)
      .map((entry) => path.join(directory, entry));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    )
      return [];
    throw error;
  }
}

function directory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
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

function validateFile(file: string, operation: () => unknown): string[] {
  try {
    operation();
    return [];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return [`${file}: ${error.message}`];
  }
}

function skillErrors(root: string): string[] {
  const errors: string[] = [];
  for (const dir of children(path.join(root, ".github/skills")).filter(
    directory,
  )) {
    const file = path.join(dir, "SKILL.md");
    if (!isFile(file)) {
      errors.push(`${dir}: missing SKILL.md`);
      continue;
    }
    try {
      const text = readFileSync(file, "utf8");
      if (!text.startsWith("---\n"))
        throw new Error("missing YAML frontmatter");
      const parts = text.split("---", 3);
      if (parts.length !== 3) throw new Error("invalid YAML frontmatter");
      const metadata: unknown = parse(parts[1]);
      if (
        metadata === null ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      )
        throw new Error("frontmatter must be a mapping");
      if (!("name" in metadata) || metadata.name !== path.basename(dir))
        errors.push(
          `${file}: frontmatter name must match directory '${path.basename(dir)}'`,
        );
      if (
        !("description" in metadata) ||
        typeof metadata.description !== "string" ||
        !metadata.description.trim()
      )
        errors.push(`${file}: description must be a non-empty string`);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.push(`${file}: ${error.message}`);
    }
  }
  return errors;
}

export async function validateStudio(root: string): Promise<string[]> {
  const errors: string[] = [];
  const studio = path.join(root, "config/studio.yaml");
  errors.push(...validateFile(studio, () => loadStudio(studio)));
  let materialFile = path.join(root, "config/material/material.yaml");
  if (isFile(studio)) {
    try {
      const data: unknown = parse(readFileSync(studio, "utf8"));
      if (
        data &&
        typeof data === "object" &&
        "material_config" in data &&
        typeof data.material_config === "string"
      )
        materialFile = path.resolve(root, data.material_config);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // The studio manifest error has already been reported above.
    }
  }
  errors.push(...validateFile(materialFile, () => loadMaterial(materialFile)));
  let materialSlugs = new Set<string>();
  if (isFile(materialFile)) {
    try {
      materialSlugs = new Set(
        loadMaterial(materialFile).materials.map((material) => material.slug),
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  for (const file of children(path.join(root, "config/printer")).filter(
    (file) => matchesPathSuffix(file, ".yaml"),
  )) {
    errors.push(...validateFile(file, () => loadPrinter(file)));
    try {
      const missing = loadPrinter(file)
        .supported_materials.filter((material) => !materialSlugs.has(material))
        .sort();
      if (missing.length)
        errors.push(
          `${file}: supported materials missing from material config: ${missing.join(", ")}`,
        );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  for (const line of children(path.join(root, "product-line")).filter(
    directory,
  )) {
    const manifest = path.join(line, "product-line.yaml");
    errors.push(...validateFile(manifest, () => loadLine(manifest)));
    if (!isFile(path.join(line, "AGENTS.md")))
      errors.push(`${line}: missing AGENTS.md`);
    for (const variant of children(path.join(line, "variant")).filter(
      directory,
    )) {
      const manifest = path.join(variant, "variant.yaml");
      errors.push(...validateFile(manifest, () => loadVariant(manifest)));
      if (!isFile(path.join(variant, "AGENTS.md")))
        errors.push(`${variant}: missing AGENTS.md`);
      for (const product of children(variant).filter(directory)) {
        const productFile = path.join(product, "product.yaml");
        if (!isFile(productFile)) continue;
        errors.push(...validateFile(productFile, () => loadProduct(product)));
        const workflowFile = path.join(product, "workflow.yaml");
        errors.push(...validateFile(workflowFile, () => loadWorkflow(product)));
        if (!isFile(path.join(product, "AGENTS.md")))
          errors.push(`${product}: missing AGENTS.md`);
        try {
          errors.push(
            ...(await verifyGroups(product, loadGroups(product))).map(
              (error) => `${product}: ${error}`,
            ),
          );
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          errors.push(`${product}: ${error.message}`);
        }
        for (const file of children(path.join(product, "slice")).filter(
          (item) => matchesPathSuffix(item, ".yaml"),
        )) {
          const validation = validateFile(file, () => loadSlice(file));
          errors.push(...validation);
          if (!validation.length)
            errors.push(
              ...verifySlice(product, loadSlice(file), root).map(
                (error) => `${product}: ${error}`,
              ),
            );
        }
        const assetsFile = path.join(product, "assets.yaml");
        if (isFile(assetsFile)) {
          try {
            errors.push(
              ...verifyAssetManifest(product, loadAssets(product)).map(
                (error) => `${product}: ${error}`,
              ),
            );
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            errors.push(`${assetsFile}: ${error.message}`);
          }
        }
      }
    }
  }
  errors.push(...checkRegistry(root));
  errors.push(...skillErrors(root));
  return errors;
}
