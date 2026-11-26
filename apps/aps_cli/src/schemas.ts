import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesPathSuffix } from "./paths.js";

const names = [
  "studio",
  "product-line",
  "variant",
  "product",
  "asset",
  "group",
  "material",
  "workflow",
  "printer",
  "slice",
  "release",
];
const source = fileURLToPath(new URL("../schema/", import.meta.url));

export function writeSchemas(root: string): number {
  const destination = path.join(root, "schema");
  mkdirSync(destination, { recursive: true });
  const expected = new Set(names.map((name) => `${name}.schema.json`));
  for (const file of readdirSync(destination)) {
    if (matchesPathSuffix(file, ".schema.json") && !expected.has(file)) {
      unlinkSync(path.join(destination, file));
    }
  }
  for (const file of expected)
    copyFileSync(path.join(source, file), path.join(destination, file));
  return expected.size;
}
