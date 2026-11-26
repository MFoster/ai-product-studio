import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("contract bundling includes only declared sources and cleans only owned output", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aps-contract-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  const source = path.join(root, "packages/contracts");
  mkdirSync(path.join(source, "schema"), { recursive: true });
  writeFileSync(
    path.join(source, "package.json"),
    JSON.stringify({
      name: "@mfoster/aps-contracts",
      version: "0.1.0",
      files: ["index.js", "schema"],
    }),
  );
  writeFileSync(
    path.join(source, "index.js"),
    "export const schemaNames = [];\n",
  );
  writeFileSync(path.join(source, "schema/studio.schema.json"), "{}\n");
  writeFileSync(path.join(source, "private-notes.txt"), "not distributed");
  const script = path.join(root, "scripts/bundle-contracts.mjs");
  copyFileSync(new URL("./bundle-contracts.mjs", import.meta.url), script);
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const destination = path.join(
    root,
    "apps/aps_cli/node_modules/@mfoster/aps-contracts",
  );
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"))
      .apsContractBundle,
    true,
  );
  assert.ok(existsSync(path.join(destination, "schema/studio.schema.json")));
  assert.equal(existsSync(path.join(destination, "private-notes.txt")), false);
  result = run("--clean");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(destination), false);
  symlinkSync(source, destination, "dir");
  result = run("--clean");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to replace an unmanaged dependency/);
  assert.ok(existsSync(path.join(source, "private-notes.txt")));
});
