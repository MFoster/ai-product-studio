import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

const archive = path.resolve(process.argv[2] ?? "");
assert.ok(
  archive.endsWith(".tgz") && existsSync(archive),
  "Pass the packed toolchain .tgz.",
);
const temp = mkdtempSync(path.join(os.tmpdir(), "aps-package-consumer-"));
let server;
let exited;
let output = "";
function run(program, args, cwd = temp) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, APS_STUDIO_ROOT: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${program} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
try {
  const paths = run("tar", ["-tzf", archive]).trim().split("\n");
  assert.ok(
    paths.every((file) =>
      /^package\/(?:package\.json|README\.md|LICENSE|bin\/|src\/|capabilities\/|dist\/ui\/|node_modules\/@mfoster\/aps-contracts\/(?:package\.json$|index\.(?:js|d\.ts)$|schema\/[^/]+\.schema\.json$))/.test(
        file,
      ),
    ),
    "Unexpected package content",
  );
  assert.ok(
    !paths.some(
      (file) =>
        /(?:product-line\/|\.env(?:\.|$))/i.test(file) ||
        (file.includes("node_modules/") &&
          !file.startsWith("package/node_modules/@mfoster/aps-contracts/")),
    ),
    "Package contains studio data or unexpected vendored dependencies.",
  );
  const contracts = paths.filter((file) =>
    file.startsWith("package/node_modules/@mfoster/aps-contracts/"),
  );
  assert.equal(
    contracts.filter((file) => file.endsWith(".schema.json")).length,
    11,
  );
  assert.ok(
    contracts.some((file) => file.endsWith("/index.js")),
    "Shared schema runtime must be bundled.",
  );
  const contents = run("tar", ["-xOf", archive]);
  assert.ok(
    !contents.includes(`${os.homedir()}/`),
    "Package contains a build-machine home path.",
  );
  writeFileSync(
    path.join(temp, "package.json"),
    '{"name":"independent-studio","private":true,"version":"1.0.0"}\n',
  );
  run("npm", [
    "install",
    "--save-exact",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    archive,
  ]);
  const cli = path.join(
    temp,
    "node_modules/@mfoster/ai-product-studio/bin/aps-node.js",
  );
  const aps = (...args) => run(process.execPath, [cli, ...args]);
  const studio = path.join(temp, "studio");
  aps("init", studio);
  aps("toolkit", "sync", "--root", studio, "--dry-run");
  assert.equal(existsSync(path.join(studio, ".toolkit")), false);
  aps("toolkit", "sync", "--root", studio);
  aps("toolkit", "check", "--root", studio);
  aps("registry", "check", "--root", studio);
  aps("validate", "--root", studio);
  const source = readFileSync(path.join(studio, "AGENTS.md"), "utf8");
  aps("toolkit", "sync", "--root", studio);
  assert.equal(readFileSync(path.join(studio, "AGENTS.md"), "utf8"), source);
  aps(
    "product-line",
    "create",
    "example",
    "--name",
    "Consumer Example",
    "--root",
    studio,
  );
  aps(
    "variant",
    "create",
    "example",
    "default",
    "--name",
    "Default",
    "--root",
    studio,
  );
  aps(
    "product",
    "create",
    "example",
    "default",
    "sample",
    "--name",
    "Sample Product",
    "--root",
    studio,
  );
  const asset = "product-line/example/variant/default/sample/source/sample.txt";
  writeFileSync(
    path.join(studio, asset),
    "Consumer asset, not toolkit source.\n",
  );
  aps(
    "assets",
    "inventory",
    "product-line/example/variant/default/sample",
    "--root",
    studio,
  );
  aps("validate", "--root", studio);
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  server = spawn(
    process.execPath,
    [
      path.join(temp, "node_modules/@mfoster/ai-product-studio/bin/aps-ui.js"),
      "--root",
      studio,
      "--port",
      String(port),
    ],
    {
      cwd: temp,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  server.on("error", (error) => {
    output += error.message;
  });
  exited = new Promise((resolve) => server.once("exit", resolve));
  let html;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`UI exited:\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        html = await response.text();
        break;
      }
      output += `\nHTTP ${response.status}`;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["TypeError", "TimeoutError"].includes(error.name)
      )
        throw error;
    }
    await setTimeout(500);
  }
  assert.ok(
    html?.includes("Consumer Example"),
    `Packaged UI did not read the consumer studio:\n${output}`,
  );
  const download = await fetch(
    `http://127.0.0.1:${port}/api/assets?path=${encodeURIComponent(asset)}`,
  );
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "Consumer asset, not toolkit source.\n");
  const verification = await fetch(
    `http://127.0.0.1:${port}/api/verify?path=${encodeURIComponent(asset)}`,
  );
  assert.equal(verification.status, 200);
  console.log(
    "Packed consumer verified: install, CLI, capability sync, validation, and UI.",
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    const timer = globalThis.setTimeout(() => server.kill("SIGKILL"), 10000);
    await exited;
    globalThis.clearTimeout(timer);
  }
  rmSync(temp, { recursive: true, force: true });
}
