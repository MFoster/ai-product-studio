import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readSchema, schemaDirectory, schemaNames } from "../index.js";

test("canonical schemas preserve the established manifest contracts", () => {
  const checksums = JSON.parse(
    readFileSync(new URL("./schema-checksums.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    readdirSync(schemaDirectory).sort(),
    Object.keys(checksums).sort(),
  );
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  for (const name of schemaNames) {
    const file = `${name}.schema.json`;
    assert.equal(
      createHash("sha256")
        .update(readFileSync(path.join(schemaDirectory, file)))
        .digest("hex"),
      checksums[file],
    );
    ajv.compile(readSchema(name));
  }
});

test("schema consumers cannot mutate other consumers or traverse the package", () => {
  const original = readSchema("studio");
  const edited = readSchema("studio");
  edited.properties.name.type = "number";
  assert.deepEqual(readSchema("studio"), original);
  assert.throws(() => readSchema("../package"), /Unknown manifest schema/);
});
