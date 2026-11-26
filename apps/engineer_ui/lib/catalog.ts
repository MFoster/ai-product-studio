import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { isMissing, safePath, studioRoot, within } from "./files";
import { parseModelGroups } from "./model-groups";
import { resolveGroupPreviews } from "./group-previews";
import {
  isRecord,
  strings,
  text,
  type Asset,
  type Catalog,
  type Finding,
  type Product,
  type RecordData,
} from "./types";

function validAssetRecord(record: RecordData): boolean {
  return (
    typeof record.size_bytes === "number" &&
    Number.isSafeInteger(record.size_bytes) &&
    record.size_bytes >= 0 &&
    /^[a-f0-9]{64}$/i.test(text(record.sha256))
  );
}

async function directories(root: string, relative: string): Promise<string[]> {
  try {
    const location = await safePath(root, relative);
    return (await readdir(location, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404)
      return [];
    throw error;
  }
}

async function files(root: string, relative: string): Promise<string[]> {
  const location = await safePath(root, relative);
  const entries = await readdir(location, { withFileTypes: true });
  const groups = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) return files(root, child);
        return entry.isFile() ? [child] : [];
      }),
  );
  return groups.flat().sort();
}

export async function loadCatalog(root = studioRoot()): Promise<Catalog> {
  const findings: Finding[] = [];
  async function manifest(relative: string): Promise<RecordData> {
    try {
      const location = await safePath(root, relative);
      const data: unknown = parse(await readFile(location, "utf8"));
      if (!isRecord(data)) throw new Error("Expected an object.");
      return data;
    } catch (error) {
      findings.push({
        severity: "error",
        path: relative,
        message: `Cannot read manifest: ${error instanceof Error ? error.message : String(error)}`,
      });
      return {};
    }
  }
  function reconcile(
    expected: string[],
    actual: string[],
    relative: string,
    line?: string,
  ) {
    for (const slug of expected.filter((item) => !actual.includes(item))) {
      findings.push({
        severity: "error",
        path: relative,
        line,
        message: `Registered entry has no directory: ${slug}`,
      });
    }
    for (const slug of actual.filter((item) => !expected.includes(item))) {
      findings.push({
        severity: "warning",
        path: relative,
        line,
        message: `Directory is not registered: ${slug}`,
      });
    }
  }
  const studio = await manifest("config/studio.yaml");
  const lineDirs = await directories(root, "product-line");
  reconcile(strings(studio.product_lines), lineDirs, "config/studio.yaml");
  const catalog: Catalog = {
    name: text(studio.name, "AI Product Studio"),
    scanned: new Date().toISOString(),
    lines: [],
    products: [],
    findings,
  };
  for (const line of lineDirs) {
    const base = `product-line/${line}`;
    const lineManifest = await manifest(`${base}/product-line.yaml`);
    if (text(lineManifest.slug) !== line)
      findings.push({
        severity: "error",
        line,
        path: `${base}/product-line.yaml`,
        message: "Product-line slug does not match its directory.",
      });
    const variantDirs = await directories(root, `${base}/variant`);
    reconcile(
      strings(lineManifest.variants),
      variantDirs,
      `${base}/product-line.yaml`,
      line,
    );
    const lineData = {
      slug: line,
      name: text(lineManifest.name, line),
      description: text(lineManifest.description),
      manifest: lineManifest,
      variants: [] as Catalog["lines"][number]["variants"],
    };
    catalog.lines.push(lineData);
    for (const variant of variantDirs) {
      const variantBase = `${base}/variant/${variant}`;
      const variantManifest = await manifest(`${variantBase}/variant.yaml`);
      if (text(variantManifest.slug) !== variant)
        findings.push({
          severity: "error",
          line,
          path: `${variantBase}/variant.yaml`,
          message: "Variant slug does not match its directory.",
        });
      lineData.variants.push({
        slug: variant,
        name: text(variantManifest.name, variant),
        manifest: variantManifest,
      });
      const productDirs = await directories(root, variantBase);
      reconcile(
        strings(variantManifest.products),
        productDirs,
        `${variantBase}/variant.yaml`,
        line,
      );
      for (const slug of productDirs) {
        const productBase = `${variantBase}/${slug}`;
        const start = findings.length;
        const productManifest = await manifest(`${productBase}/product.yaml`);
        const workflow = await manifest(`${productBase}/workflow.yaml`);
        const diskFiles = await files(root, productBase);
        const inventoryPath = `${productBase}/assets.yaml`;
        const inventory = diskFiles.includes(inventoryPath)
          ? await manifest(inventoryPath)
          : {};
        const groupsPath = `${productBase}/groups.yaml`;
        const hasGroups = diskFiles.includes(groupsPath);
        const groupManifest = hasGroups
          ? await manifest(groupsPath)
          : undefined;
        const id = `${line}/${variant}/${slug}`;
        const productFindings: Finding[] = [];
        const report = (
          severity: Finding["severity"],
          message: string,
          relative: string,
        ) =>
          productFindings.push({
            severity,
            message,
            path: relative,
            productId: id,
            line,
          });
        const snapshot = parseModelGroups(inventory.groups);
        const definitions = hasGroups
          ? parseModelGroups(groupManifest?.groups)
          : snapshot;
        for (const message of definitions.errors)
          report(
            "error",
            `Invalid group metadata: ${message}`,
            hasGroups ? groupsPath : inventoryPath,
          );
        if (hasGroups) {
          if (text(groupManifest?.product) !== slug)
            report(
              "error",
              "Group manifest product does not match its directory.",
              groupsPath,
            );
          for (const message of snapshot.errors)
            report(
              "error",
              `Invalid inventory group metadata: ${message}`,
              inventoryPath,
            );
          if (
            JSON.stringify(definitions.groups) !==
            JSON.stringify(snapshot.groups)
          )
            report(
              "warning",
              "Asset group metadata is stale; run aps assets inventory.",
              inventoryPath,
            );
        } else if (snapshot.groups.length) {
          report(
            "warning",
            "groups.yaml is missing; showing inventory group metadata only.",
            groupsPath,
          );
        }
        const groups = definitions.groups;
        if (!diskFiles.includes(inventoryPath))
          report(
            "warning",
            "Asset inventory is missing. Generate it with aps assets inventory.",
            inventoryPath,
          );
        if (text(productManifest.slug) !== slug)
          report(
            "error",
            "Product slug does not match its directory.",
            `${productBase}/product.yaml`,
          );
        for (const [data, file] of [
          [workflow, "workflow.yaml"],
          [inventory, "assets.yaml"],
        ] as const) {
          if (Object.keys(data).length && text(data.product) !== slug)
            report(
              "error",
              "Manifest product does not match its directory.",
              `${productBase}/${file}`,
            );
        }
        const records = new Map<string, RecordData>();
        if (inventory.assets !== undefined && !Array.isArray(inventory.assets))
          report("error", "Inventory assets must be a list.", inventoryPath);
        for (const item of Array.isArray(inventory.assets)
          ? inventory.assets
          : []) {
          if (!isRecord(item) || !text(item.path)) {
            report("error", "Invalid asset inventory record.", inventoryPath);
            continue;
          }
          const assetPath = text(item.path);
          if (
            path.isAbsolute(assetPath) ||
            assetPath.includes("\\") ||
            assetPath.split("/").includes("..")
          ) {
            report("error", `Unsafe asset path: ${assetPath}`, inventoryPath);
            continue;
          }
          if (assetPath.split("/").some((part) => part.startsWith(".")))
            continue;
          if (!validAssetRecord(item)) {
            report(
              "error",
              `Invalid recorded size or SHA-256: ${assetPath}`,
              inventoryPath,
            );
          }
          if (records.has(assetPath))
            report(
              "error",
              `Duplicate asset record: ${assetPath}`,
              inventoryPath,
            );
          records.set(assetPath, item);
        }
        const assets: Asset[] = [];
        const ignored = new Set([
          "product.yaml",
          "workflow.yaml",
          "assets.yaml",
          "AGENTS.md",
        ]);
        const groupReferences = new Set(
          groups.flatMap((group) => [
            group.package,
            ...group.parts.flatMap((part) =>
              part.meshes.map((mesh) => mesh.asset),
            ),
          ]),
        );
        const candidates = new Set([
          ...diskFiles
            .map((file) => file.slice(productBase.length + 1))
            .filter((file) => !ignored.has(path.basename(file))),
          ...records.keys(),
          ...groupReferences,
        ]);
        for (const group of groups) {
          for (const part of group.parts) {
            for (const mesh of part.meshes) {
              const record = records.get(mesh.asset);
              if (record && text(record.sha256) !== mesh.sha256)
                report(
                  "error",
                  `Group ${group.name} / ${part.name}: mesh checksum differs from inventory: ${mesh.asset}`,
                  groupsPath,
                );
            }
          }
        }
        const productLocation = await safePath(root, productBase);
        let updated = (await stat(productLocation)).mtime.toISOString();
        for (const name of ["product.yaml", "workflow.yaml", "assets.yaml"]) {
          if (diskFiles.includes(`${productBase}/${name}`)) {
            const modified = (
              await stat(await safePath(root, `${productBase}/${name}`))
            ).mtime.toISOString();
            if (modified > updated) updated = modified;
          }
        }
        for (const relative of candidates) {
          const record = records.get(relative);
          const full = `${productBase}/${relative}`;
          let info;
          try {
            const location = await safePath(root, full);
            if (
              groupReferences.has(relative) &&
              !within(productLocation, location)
            )
              throw new Error(
                "Group references must stay inside their product.",
              );
            const candidate = await stat(location);
            if (!candidate.isFile())
              throw new Error("Asset is not a regular file.");
            info = candidate;
          } catch (error) {
            report(
              "error",
              `Missing or inaccessible asset: ${relative} (${error instanceof Error ? error.message : String(error)})`,
              full,
            );
          }
          const size = info?.size ?? 0;
          const expectedSize =
            typeof record?.size_bytes === "number"
              ? record.size_bytes
              : undefined;
          const sizeMismatch =
            !!info && expectedSize !== undefined && size !== expectedSize;
          if (sizeMismatch)
            report(
              "error",
              `Size mismatch: ${relative} (${expectedSize} recorded, ${size} on disk)`,
              full,
            );
          const isRelease = relative.split("/").includes("release");
          if (!record && !isRelease)
            report("warning", `Not inventoried: ${relative}`, full);
          const modified = info?.mtime.toISOString() ?? "";
          if (modified > updated) updated = modified;
          assets.push({
            path: full,
            name: relative,
            format: path.extname(relative).slice(1).toLowerCase(),
            size,
            modified,
            kind: text(record?.kind, relative.split("/")[0]),
            tracked: !!record,
            inventoryValid: !!record && validAssetRecord(record),
            expectedHash: text(record?.sha256) || undefined,
            expectedSize,
            missing: !info,
            sizeMismatch,
          });
        }
        const previewReports = await Promise.all(
          diskFiles
            .filter((file) =>
              /\/review\/group-previews-\d{8}T\d{6}Z\.json$/.test(file),
            )
            .map(async (file) => ({ path: file, data: await manifest(file) })),
        );
        const groupPreviews = resolveGroupPreviews(
          previewReports,
          groups,
          assets,
          slug,
        );
        for (const finding of groupPreviews.findings)
          report(finding.severity, finding.message, finding.path);
        const inherited: Finding[] = findings
          .slice(start)
          .map((finding) => ({ ...finding, productId: id, line }));
        findings.splice(start, inherited.length, ...inherited);
        productFindings.push(...inherited);
        const product: Product = {
          id,
          line,
          variant,
          slug,
          path: productBase,
          name: text(productManifest.name, slug),
          summary: text(productManifest.summary),
          stage: text(workflow.current_stage, "unknown"),
          physical: text(workflow.physical_print_status, "unknown"),
          updated,
          manifest: productManifest,
          workflow,
          blockers: strings(workflow.blockers),
          assets,
          groups,
          groupPreviews: groupPreviews.previews,
          findings: productFindings,
        };
        catalog.products.push(product);
        findings.push(
          ...productFindings.filter((finding) => !inherited.includes(finding)),
        );
      }
    }
  }
  catalog.products.sort((a, b) => b.updated.localeCompare(a.updated));
  return catalog;
}

export async function readDocument(root: string, relative: string) {
  const location = await safePath(root, relative);
  const info = await stat(location);
  if (info.size > 4 * 1024 * 1024)
    throw new Error(
      "This document is larger than 4 MB. Download it to inspect locally.",
    );
  try {
    const content = await readFile(location, "utf8");
    const extension = path.extname(relative).toLowerCase();
    const data: unknown =
      extension === ".json"
        ? JSON.parse(content)
        : [".yaml", ".yml"].includes(extension)
          ? parse(content)
          : null;
    return { content, data: data as import("./types").Json };
  } catch (error) {
    if (isMissing(error)) throw new Error("Document no longer exists.");
    throw error;
  }
}
