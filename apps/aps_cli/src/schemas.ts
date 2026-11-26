import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { schemaNames, schemaDirectory } from "@mfoster/aps-contracts";
import { matchesPathSuffix } from "./paths.js";

export function writeSchemas(root: string): number {
  const destination = path.join(root, "schema");
  mkdirSync(destination, { recursive: true });
  const expected = new Set(schemaNames.map((name) => `${name}.schema.json`));
  for (const file of readdirSync(destination)) {
    if (matchesPathSuffix(file, ".schema.json") && !expected.has(file)) {
      unlinkSync(path.join(destination, file));
    }
  }
  for (const file of expected)
    copyFileSync(
      path.join(schemaDirectory, file),
      path.join(destination, file),
    );
  return expected.size;
}
