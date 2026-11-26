import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { stringify, parse } from "yaml";
import { ZipFile } from "yazl";
import {
  initialize,
  createLine,
  createVariant,
  createProduct,
} from "../src/scaffolding.js";
import { inventoryProduct, verifyAssetManifest } from "../src/assets.js";
import { loadAssets, loadGroupManifest } from "../src/manifests.js";
import { capture } from "../src/slicer.js";
import { validateStudio } from "../src/validation.js";
import { terminalCommand } from "./regression-helpers.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(new URL("../bin/aps-node.js", import.meta.url));

function temporary(t: TestContext): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "aps-framework-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function studio(t: TestContext) {
  const root = temporary(t);
  const options = { force: false, dryRun: false };
  initialize(root, "Test Studio", options);
  createLine(root, "line", "Line", "", options);
  createVariant(root, "line", "default", "Default", "", options);
  const product = createProduct(
    root,
    "line",
    "default",
    "model",
    "Model",
    "",
    options,
  );
  return { root, product };
}

test("framework ignores private studio data but retains generic AI and Spec Kit sources", (t) => {
  const root = temporary(t);
  const initialized = spawnSync("git", ["init", "-q", root], {
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(
    path.join(root, ".gitignore"),
    readFileSync(path.join(repo, ".gitignore")),
  );
  mkdirSync(path.join(root, ".specify"));
  writeFileSync(
    path.join(root, ".specify/.gitignore"),
    readFileSync(path.join(repo, ".specify/.gitignore")),
  );
  for (const [file, ignored] of [
    [".specify/integration.json", false],
    [".specify/feature.json", true],
    [".specify/integrations/packages.json", true],
    ["result.json", true],
    ["schema/studio.schema.json", true],
    ["packages/contracts/schema/studio.schema.json", false],
    [".toolkit/manifest.json", true],
    ["apps/aps_cli/capabilities/.github/skills/example/SKILL.md", true],
    ["config/studio.yaml", true],
    ["product-line/example/asset.blend", true],
    [".github/agents/example--designer.agent.md", true],
    [".github/skills/example-design/SKILL.md", true],
    [".github/skills/speckit-plan/SKILL.md", false],
    [".github/agents/studio-orchestrator.agent.md", false],
    [".github/agents/product-line-curator.agent.md", false],
    [".github/skills/mesh-printability-audit/SKILL.md", false],
    [".github/skills/calibration-coupon-design/SKILL.md", false],
  ] as const) {
    const result = spawnSync("git", [
      "-C",
      root,
      "check-ignore",
      "-q",
      "--no-index",
      file,
    ]);
    assert.equal(result.status, ignored ? 0 : 1, file);
  }
});

test("studio initialization preserves authored Git configuration and tracks studio ownership", (t) => {
  const root = temporary(t);
  writeFileSync(path.join(root, ".gitignore"), "private/\n");
  writeFileSync(path.join(root, ".gitattributes"), "*.blend filter=lfs\n");
  initialize(root, "Existing", { force: true, dryRun: false });
  assert.equal(
    readFileSync(path.join(root, ".gitignore"), "utf8"),
    "private/\n",
  );
  assert.equal(
    readFileSync(path.join(root, ".gitattributes"), "utf8"),
    "*.blend filter=lfs\n",
  );
  const fresh = path.join(root, "fresh");
  initialize(fresh, "Fresh", { force: false, dryRun: false });
  assert.equal(spawnSync("git", ["init", "-q", fresh]).status, 0);
  for (const [file, status] of [
    [".aps/registry.yaml", 0],
    ["config/studio.yaml", 1],
    ["product-line/model/source/model.blend", 1],
    [".toolkit/manifest.json", 1],
  ] as const)
    assert.equal(
      spawnSync("git", ["-C", fresh, "check-ignore", "-q", file]).status,
      status,
      file,
    );
});

test("core skills retain their metadata and engineering quality gates", async (t) => {
  const names = [
    "mesh-printability-audit",
    "fit-tolerance-engineering",
    "calibration-coupon-design",
    "wall-strength-engineering",
    "support-free-orientation",
    "fdm-detail-design",
    "curved-surface-relief",
    "ams-multipart-color",
    "threaded-container-mechanism",
    "organic-character-detail",
    "procedural-decoration-system",
    "model-repair-from-stl",
    "3mf-release-packaging",
    "test-print-feedback-loop",
    "catalog-render-and-review",
    "bambu-plate-planning",
  ];
  for (const name of names) {
    const content = readFileSync(
      path.join(repo, ".github/skills", name, "SKILL.md"),
      "utf8",
    );
    assert.equal(parse(content.split("---", 3)[1]).name, name);
    for (const section of [
      "Use this skill when",
      "Required inputs",
      "Workflow",
      "Quality gates",
      "Output contract",
      "Do not claim",
    ])
      assert.ok(content.includes(`## ${section}`), `${name}: ${section}`);
  }
  const { root } = studio(t);
  const skill = path.join(root, ".github/skills/expected-name");
  mkdirSync(skill, { recursive: true });
  writeFileSync(
    path.join(skill, "SKILL.md"),
    "---\nname: wrong-name\ndescription: Incorrect name.\n---\n",
  );
  const errors = await validateStudio(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /frontmatter name must match directory/);
});

test("stale Finder metadata remains a visible inventory blocker until regenerated", async (t) => {
  const { product } = studio(t);
  await inventoryProduct(product);
  const manifest = loadAssets(product);
  manifest.assets.push({
    path: "export/.DS_Store",
    kind: "export",
    format: "none",
    role: ".DS_Store",
    sha256: "0".repeat(64),
    size_bytes: 1,
    release_eligible: true,
  });
  writeFileSync(path.join(product, "assets.yaml"), stringify(manifest));
  const expected = [
    "macOS metadata is not an asset: export/.DS_Store; run aps assets inventory",
  ];
  assert.deepEqual(verifyAssetManifest(product, manifest), expected);
  writeFileSync(path.join(product, "export/.DS_Store"), "changed");
  assert.deepEqual(verifyAssetManifest(product, manifest), expected);
  await inventoryProduct(product);
  assert.deepEqual(loadAssets(product).assets, []);
});

test("group validation does not depend on an existing asset inventory", async (t) => {
  const { root, product } = studio(t);
  writeFileSync(path.join(product, "export/part.stl"), "mesh");
  const definition = {
    product: "model",
    groups: [
      {
        id: "assembly",
        name: "Assembly",
        revision: "v1",
        package: "package/assembly.3mf",
        materials: [{ id: "white", name: "White", color: "#ffffff" }],
        parts: [
          {
            id: "part",
            name: "Part",
            meshes: [
              {
                asset: "export/part.stl",
                material: "white",
                sha256: createHash("sha256").update("mesh").digest("hex"),
              },
            ],
          },
        ],
      },
    ],
  };
  const file = path.join(product, "groups.yaml");
  writeFileSync(file, stringify(definition));
  assert.equal(existsSync(path.join(product, "assets.yaml")), false);
  assert.ok(
    (await validateStudio(root)).some((error) =>
      error.includes("missing package: package/assembly.3mf"),
    ),
  );
  definition.product = "wrong-product";
  writeFileSync(file, stringify(definition));
  assert.ok(
    (await validateStudio(root)).some((error) =>
      error.includes("product must be model"),
    ),
  );
});

async function projectArchive(
  file: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(JSON.stringify(settings)),
    "Metadata/project_settings.config",
  );
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => {
      writeFileSync(file, Buffer.concat(chunks));
      resolve();
    });
  });
  zip.end();
  await completed;
}

test("slicer validation rejects missing core settings, nozzle contradictions, and tampered evidence", async (t) => {
  const { root, product } = studio(t);
  const file = path.join(root, "project.3mf");
  const settings = {
    nozzle_diameter: ["0.6"],
    layer_height: "0.2",
    wall_loops: "2",
    print_settings_id: "Wide Profile",
  };
  await projectArchive(file, { nozzle_diameter: ["0.4"], wall_loops: "2" });
  await assert.rejects(
    capture(product, file, { force: false }),
    /missing required keys/,
  );
  await projectArchive(file, settings);
  const captured = await capture(product, file, { force: false });
  assert.ok(
    (await validateStudio(root)).some((error) => error.includes("contradicts")),
  );
  assert.ok(captured.profile.settings_file);
  writeFileSync(path.join(product, captured.profile.settings_file), "{}\n");
  assert.ok(
    (await validateStudio(root)).some((error) =>
      error.includes("checksum mismatch"),
    ),
  );
});

test("group contracts reject unbounded layouts, absolute paths, zero quantities, and duplicate packages", (t) => {
  const root = temporary(t);
  const file = path.join(root, "groups.yaml");
  const group = {
    id: "assembly",
    name: "Assembly",
    revision: "v1",
    package: "package/assembly.3mf",
    materials: [{ id: "white", name: "White", color: "#ffffff" }],
    parts: [
      {
        id: "part",
        name: "Part",
        quantity: 1,
        meshes: [
          {
            asset: "export/part.stl",
            material: "white",
            sha256: "a".repeat(64),
          },
        ],
      },
    ],
    layout: { spacing_mm: 6, margin_mm: 5, orientation: "preserve-source" },
  };
  for (const groups of [
    [{ ...group, layout: { ...group.layout, margin_mm: Infinity } }],
    [{ ...group, parts: [{ ...group.parts[0], quantity: 0 }] }],
    [
      {
        ...group,
        parts: [
          {
            ...group.parts[0],
            meshes: [{ ...group.parts[0].meshes[0], asset: "/outside.stl" }],
          },
        ],
      },
    ],
    [group, { ...group, id: "another" }],
  ]) {
    writeFileSync(file, stringify({ product: "model", groups }));
    assert.throws(() => loadGroupManifest(file));
  }
});

test("terminal prompts preserve supplied arguments, allow optional defaults, and cancel without writes", async (t) => {
  const { root } = studio(t);
  const run = (args: string[], input: string, cwd = root) =>
    terminalCommand([process.execPath, cli, ...args], input, cwd);
  const partial = await run(
    ["product-line", "create", "--root", root],
    "second\nSecond\n",
  );
  assert.equal(partial.status, 0, partial.stdout);
  assert.ok(
    existsSync(path.join(root, "product-line/second/product-line.yaml")),
  );
  const repeated = await run(
    [
      "product-line",
      "create",
      "third",
      "--root",
      root,
      "--name=Earlier",
      "--name",
    ],
    "Third\n",
  );
  assert.equal(repeated.status, 0, repeated.stdout);
  assert.equal(
    parse(
      readFileSync(
        path.join(root, "product-line/third/product-line.yaml"),
        "utf8",
      ),
    ).name,
    "Third",
  );
  for (const input of [`${root}\n`, "\n"]) {
    const optional = await run(["registry", "check", "--root"], input);
    assert.equal(optional.status, 0, optional.stdout);
    assert.match(optional.stdout, /Registry is synchronized/);
  }
  const cancelled = path.join(root, "cancelled");
  const result = await run([], `init\n${cancelled}\n\u0004`);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(existsSync(cancelled), false);
});
