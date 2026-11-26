import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { stringify } from "yaml";
import { loadCatalog, readDocument } from "../lib/catalog";
import { FileAccessError, openAsset, safePath } from "../lib/files";
import { GET as getAsset } from "../app/api/assets/route";
import { GET as verifyAsset } from "../app/api/verify/route";
import { meshContent, meshHash, modelGroup } from "./fixtures/model-group";

const productBase = "product-line/demo/variant/default/widget";
const hash = (content: string) =>
  createHash("sha256").update(content).digest("hex");

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aps-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function put(relative: string, value: unknown, raw = false) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, raw ? String(value) : stringify(value));
  }
  await put("config/studio.yaml", {
    name: "Test studio",
    product_lines: ["demo"],
  });
  await put("product-line/demo/product-line.yaml", {
    slug: "demo",
    name: "Demo",
    variants: ["default"],
  });
  await put("product-line/demo/variant/default/variant.yaml", {
    slug: "default",
    products: ["widget"],
  });
  await put(`${productBase}/product.yaml`, {
    slug: "widget",
    name: "Widget",
    dimensions_mm: { width: 20 },
  });
  await put(`${productBase}/workflow.yaml`, {
    product: "widget",
    current_stage: "design",
    physical_print_status: "pending",
    blockers: ["Needs a test print."],
  });
  await put(
    `${productBase}/review/report.json`,
    '{"passed":true,"dimensions":[1,2,3]}',
    true,
  );
  const report = '{"passed":true,"dimensions":[1,2,3]}';
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    assets: [
      {
        path: "review/report.json",
        kind: "document",
        size_bytes: Buffer.byteLength(report),
        sha256: hash(report),
      },
    ],
  });
  return { root, put, report };
}

test("reads live manifests and reports without inferring physical success", async (t) => {
  const { root, report } = await fixture(t);
  const catalog = await loadCatalog(root);
  assert.equal(catalog.name, "Test studio");
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.products[0].physical, "pending");
  assert.deepEqual(catalog.products[0].groups, []);
  assert.deepEqual(catalog.products[0].blockers, ["Needs a test print."]);
  assert.equal(catalog.products[0].assets[0].expectedHash, hash(report));
  assert.deepEqual(catalog.findings, []);
  const document = await readDocument(
    root,
    `${productBase}/review/report.json`,
  );
  assert.deepEqual(document.data, { passed: true, dimensions: [1, 2, 3] });
  assert.equal(document.content, report);
});

test("authoritative groups override stale inventory metadata and retain named parts and quantities", async (t) => {
  const { root, put } = await fixture(t);
  const group = modelGroup();
  await put(`${productBase}/groups.yaml`, {
    product: "widget",
    groups: [group],
  });
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    groups: [{ ...group, name: "Old assembly name" }],
    assets: [],
  });
  for (const mesh of group.parts[0].meshes)
    await put(`${productBase}/${mesh.asset}`, meshContent, true);
  const product = (await loadCatalog(root)).products[0];
  assert.equal(product.groups[0].name, "Foundry assembly");
  assert.equal(product.groups[0].parts[1].quantity, 4);
  assert.ok(
    product.findings.some((finding) =>
      finding.message.includes("group metadata is stale"),
    ),
  );
  assert.ok(
    product.assets.find((asset) => asset.name === group.package)?.missing,
  );
  assert.equal(
    product.assets.find(
      (asset) => asset.name === group.parts[0].meshes[0].asset,
    )?.missing,
    false,
  );
});

test("discovers an explicitly associated assembly preview with matching source and image inventory records", async (t) => {
  const { root, put } = await fixture(t);
  const group = modelGroup();
  const image = "preview/assembly.png";
  const source = "source/canonical.blend";
  const imageContent = "image fixture";
  const sourceContent = "source fixture";
  await put(`${productBase}/groups.yaml`, {
    product: "widget",
    groups: [group],
  });
  await put(`${productBase}/${image}`, imageContent, true);
  await put(`${productBase}/${source}`, sourceContent, true);
  await put(
    `${productBase}/review/group-previews-20261119T000000Z.json`,
    JSON.stringify({
      schema_version: "1.0",
      product: "widget",
      source,
      source_sha256: hash(sourceContent),
      groups: [
        {
          group,
          image,
          image_sha256: hash(imageContent),
          width: 2000,
          height: 1500,
        },
      ],
    }),
    true,
  );
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    groups: [group],
    assets: [
      {
        path: image,
        sha256: hash(imageContent),
        size_bytes: imageContent.length,
      },
      {
        path: source,
        sha256: hash(sourceContent),
        size_bytes: sourceContent.length,
      },
    ],
  });
  const product = (await loadCatalog(root)).products[0];
  assert.equal(product.groupPreviews[0]?.groupId, group.id);
  assert.equal(product.groupPreviews[0]?.image.name, image);
  assert.equal(
    product.findings.filter((finding) =>
      finding.message.startsWith("Group preview:"),
    ).length,
    0,
  );
});

test("group references remain visible when missing, untracked, or inconsistent with recorded checksums", async (t) => {
  const { root, put } = await fixture(t);
  const group = modelGroup();
  await put(`${productBase}/groups.yaml`, {
    product: "widget",
    groups: [group],
  });
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    groups: [group],
    assets: [
      {
        path: group.parts[0].meshes[0].asset,
        sha256: "b".repeat(64),
        size_bytes: meshContent.length,
      },
    ],
  });
  await put(
    `${productBase}/${group.parts[0].meshes[0].asset}`,
    meshContent,
    true,
  );
  const product = (await loadCatalog(root)).products[0];
  const messages = product.findings
    .map((finding) => finding.message)
    .join("\n");
  assert.match(messages, /mesh checksum differs from inventory/);
  assert.match(
    messages,
    /Missing or inaccessible asset: export\/v999\/metal.stl/,
  );
  assert.match(messages, /Not inventoried: package\/assembly.3mf/);
  assert.doesNotMatch(messages, /group metadata is stale/);
  assert.equal(product.groups[0].parts.length, 2);
});

test("invalid definitions do not silently fall back to a valid inventory snapshot", async (t) => {
  const { root, put } = await fixture(t);
  await put(`${productBase}/groups.yaml`, {
    product: "widget",
    groups: "broken",
  });
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    groups: [modelGroup()],
    assets: [],
  });
  const product = (await loadCatalog(root)).products[0];
  assert.deepEqual(product.groups, []);
  assert.ok(
    product.findings.some(
      (finding) =>
        finding.severity === "error" &&
        finding.message.includes("Invalid group metadata"),
    ),
  );
});

test("inventory-only groups are explicitly marked as snapshots, and referenced symlinks must stay inside the product", async (t) => {
  const { root, put } = await fixture(t);
  const group = modelGroup();
  const reference = group.parts[0].meshes[0].asset;
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    groups: [group],
    assets: [
      { path: reference, sha256: meshHash, size_bytes: meshContent.length },
    ],
  });
  await put("other/mesh.stl", meshContent, true);
  await mkdir(path.dirname(path.join(root, productBase, reference)), {
    recursive: true,
  });
  await symlink(
    path.join(root, "other/mesh.stl"),
    path.join(root, productBase, reference),
  );
  const product = (await loadCatalog(root)).products[0];
  assert.equal(product.groups.length, 1);
  assert.ok(
    product.findings.some((finding) =>
      finding.message.includes("showing inventory group metadata only"),
    ),
  );
  assert.ok(
    product.findings.some((finding) =>
      finding.message.includes(
        "Group references must stay inside their product",
      ),
    ),
  );
  assert.ok(product.assets.find((asset) => asset.name === reference)?.missing);
});

test("reports missing, changed, untracked, duplicate and unsafe assets plus registry mismatches", async (t) => {
  const { root, put } = await fixture(t);
  await put(`${productBase}/assets.yaml`, {
    product: "other",
    assets: [
      { path: "review/report.json", size_bytes: 1, sha256: "a".repeat(64) },
      { path: "review/report.json", size_bytes: 2, sha256: "b".repeat(64) },
      { path: "source/missing.blend", size_bytes: 2, sha256: "c".repeat(64) },
      { path: "../../outside.txt", size_bytes: 1, sha256: "d".repeat(64) },
    ],
  });
  await put(`${productBase}/preview/new.png`, "preview", true);
  await put("product-line/demo/variant/default/variant.yaml", {
    slug: "default",
    products: ["missing-widget"],
  });
  const catalog = await loadCatalog(root);
  const messages = catalog.findings
    .map((finding) => finding.message)
    .join("\n");
  for (const fragment of [
    "Size mismatch",
    "Missing or inaccessible asset",
    "Not inventoried",
    "Duplicate asset",
    "Unsafe asset",
    "Registered entry",
    "Directory is not registered",
    "Manifest product",
  ]) {
    assert.ok(messages.includes(fragment), fragment);
  }
  assert.ok(catalog.products[0].assets.some((asset) => asset.missing));
});

test("invalid or missing manifests stay visible without hiding other products", async (t) => {
  const { root, put } = await fixture(t);
  await put(`${productBase}/workflow.yaml`, "invalid: [yaml", true);
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    assets: "not a list",
  });
  await mkdir(path.join(root, "product-line/demo/variant/default/incomplete"));
  const catalog = await loadCatalog(root);
  assert.equal(catalog.products.length, 2);
  assert.ok(
    catalog.findings.some((finding) =>
      finding.message.includes("Cannot read manifest"),
    ),
  );
  assert.ok(
    catalog.findings.some((finding) =>
      finding.message.includes("assets must be a list"),
    ),
  );
  assert.equal(
    catalog.products.find((product) => product.slug === "widget")?.stage,
    "unknown",
  );
});

test("paths and symlinks cannot escape the studio or expose non-product files", async (t) => {
  const { root } = await fixture(t);
  for (const relative of [
    "../secret",
    "/etc/passwd",
    "product-line/../../secret",
    "product-line\\demo",
    ".git/config",
  ]) {
    await assert.rejects(() => safePath(root, relative), FileAccessError);
  }
  await symlink(os.tmpdir(), path.join(root, productBase, "outside"));
  await assert.rejects(
    () => safePath(root, `${productBase}/outside`),
    /outside the catalog/,
  );
  await assert.rejects(
    () => openAsset(root, "config/studio.yaml"),
    /Only product assets/,
  );
  await assert.rejects(
    () => openAsset(root, `${productBase}/review`),
    /Not a file/,
  );
});

test("invalid JSON and oversized documents fail explicitly", async (t) => {
  const { root, put } = await fixture(t);
  await put(`${productBase}/review/bad.json`, "{broken", true);
  await put(
    `${productBase}/review/huge.json`,
    " ".repeat(4 * 1024 * 1024 + 1),
    true,
  );
  await assert.rejects(
    () => readDocument(root, `${productBase}/review/bad.json`),
    SyntaxError,
  );
  await assert.rejects(
    () => readDocument(root, `${productBase}/review/huge.json`),
    /larger than 4 MB/,
  );
});

test("directory records and incomplete inventory metadata are not presented as matching files", async (t) => {
  const { root, put } = await fixture(t);
  await put(`${productBase}/assets.yaml`, {
    product: "widget",
    assets: [
      { path: "review", size_bytes: 0, sha256: "a".repeat(64) },
      { path: "review/report.json", sha256: "invalid" },
    ],
  });
  const catalog = await loadCatalog(root);
  const assets = catalog.products[0].assets;
  assert.equal(assets.find((asset) => asset.name === "review")?.missing, true);
  assert.equal(
    assets.find((asset) => asset.name === "review/report.json")?.inventoryValid,
    false,
  );
  assert.ok(
    catalog.findings.some((finding) =>
      finding.message.includes("Invalid recorded size"),
    ),
  );
  assert.ok(
    catalog.findings.some((finding) =>
      finding.message.includes("not a regular file"),
    ),
  );
});

test("asset endpoints stream downloads, reject traversal, and detect same-size checksum changes", async (t) => {
  const { root, report, put } = await fixture(t);
  const previous = process.env.APS_STUDIO_ROOT;
  process.env.APS_STUDIO_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.APS_STUDIO_ROOT;
    else process.env.APS_STUDIO_ROOT = previous;
  });
  const url = `http://localhost/api/assets?path=${encodeURIComponent(`${productBase}/review/report.json`)}`;
  const response = await getAsset(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.match(response.headers.get("content-disposition")!, /^attachment/);
  assert.equal(await response.text(), report);
  const verifyUrl = url.replace("/assets?", "/verify?");
  const verified = await verifyAsset(new Request(verifyUrl));
  assert.equal((await verified.json()).matches, true);
  await put(
    `${productBase}/review/report.json`,
    report.replace("true", "null"),
    true,
  );
  const catalog = await loadCatalog(root);
  assert.equal(catalog.products[0].assets[0].sizeMismatch, false);
  const changed = await verifyAsset(new Request(verifyUrl));
  assert.equal((await changed.json()).matches, false);
  const forbidden = await getAsset(
    new Request("http://localhost/api/assets?path=../../.git/config"),
  );
  assert.equal(forbidden.status, 403);
  const missing = await getAsset(
    new Request(`http://localhost/api/assets?path=${productBase}/missing.png`),
  );
  assert.equal(missing.status, 404);
  await put(`${productBase}/preview/active.svg`, "<svg/>", true);
  const svg = await getAsset(
    new Request(
      `http://localhost/api/assets?path=${productBase}/preview/active.svg`,
    ),
  );
  assert.match(svg.headers.get("content-disposition")!, /^attachment/);
  await svg.text();
});
