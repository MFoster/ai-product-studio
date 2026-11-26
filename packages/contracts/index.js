import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const schemaNames = Object.freeze([
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
]);

export const schemaDirectory = fileURLToPath(
  new URL("./schema/", import.meta.url),
);

export function readSchema(name) {
  if (!schemaNames.includes(name))
    throw new Error(`Unknown manifest schema: ${name}`);
  return JSON.parse(
    readFileSync(path.join(schemaDirectory, `${name}.schema.json`), "utf8"),
  );
}
