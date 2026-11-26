import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { stringify } from "./yaml.js";
import { comparePaths, resolvePath } from "./paths.js";

export function hash(file: string): string {
  const digest = createHash("sha256");
  const descriptor = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes: number;
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return digest.digest("hex");
}

export function legacyInventory(source: string, output: string): number {
  const resolvedSource = resolvePath(source);
  const extensions = new Set([".blend", ".blend1", ".stl", ".3mf", ".png"]);
  const assets: Record<string, unknown>[] = [];
  for (const name of readdirSync(resolvedSource).sort(comparePaths)) {
    const file = path.join(resolvedSource, name);
    const extension = path.extname(name).toLowerCase();
    if (!extensions.has(extension)) continue;
    let info;
    try {
      info = statSync(file);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    if (!info.isFile()) continue;
    assets.push({
      path: name,
      format: extension.slice(1),
      size_bytes: info.size,
      sha256: hash(file),
      candidate_product_line: name
        .split(".", 1)[0]
        .split("_", 1)[0]
        .split("-", 1)[0]
        .toLowerCase(),
      action: "unmanaged",
    });
  }
  const target = resolvePath(output);
  mkdirSync(path.dirname(target), { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replace(/(\.\d{3})Z$/, "$1000+00:00");
  writeFileSync(
    target,
    stringify({
      schema_version: "1.0",
      source: resolvedSource,
      generated_at: timestamp,
      assets,
    }),
  );
  return assets.length;
}
