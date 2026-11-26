import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGroupPreviews } from "../lib/group-previews";
import type { Asset, RecordData } from "../lib/types";
import { modelGroup } from "./fixtures/model-group";

function fixture() {
  const imageHash = "a".repeat(64);
  const sourceHash = "b".repeat(64);
  const asset = (name: string, expectedHash: string): Asset => ({
    name,
    path: `product/${name}`,
    size: 12,
    modified: "",
    format: name.split(".").pop() || "",
    kind: "preview",
    tracked: true,
    inventoryValid: true,
    missing: false,
    sizeMismatch: false,
    expectedHash,
  });
  const image = asset("preview/an-explicitly-associated-image.png", imageHash);
  const source = asset("source/canonical.blend", sourceHash);
  const data: RecordData = {
    schema_version: "1.0",
    product: "widget",
    source: source.name,
    source_sha256: sourceHash,
    groups: [
      {
        group: modelGroup(),
        image: image.name,
        image_sha256: imageHash,
        width: 2000,
        height: 1500,
      },
    ],
  };
  const report = { path: "review/group-previews-20261119T000000Z.json", data };
  return {
    image,
    source,
    report,
    assets: [image, source],
    groups: [modelGroup()],
  };
}

test("assembly images use explicit group snapshots, not filename-derived membership", () => {
  const { report, groups, assets, image } = fixture();
  const result = resolveGroupPreviews([report], groups, assets, "widget");
  assert.equal(result.previews[0]?.groupId, "assembly");
  assert.equal(result.previews[0]?.image, image);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    resolveGroupPreviews(
      [report],
      [{ ...groups[0], revision: "v004" }],
      assets,
      "widget",
    ).previews,
    [],
  );
});

test("changed groups and missing, untracked or inconsistent image/source assets never become current assembly previews", () => {
  const { report, groups, assets } = fixture();
  const changed = modelGroup();
  changed.parts[0].quantity++;
  const stale = resolveGroupPreviews([report], [changed], assets, "widget");
  assert.equal(stale.previews.length, 0);
  assert.match(stale.findings[0].message, /changed since/);
  for (const [index, property, value] of [
    [0, "missing", true],
    [0, "inventoryValid", false],
    [0, "expectedHash", "c".repeat(64)],
    [1, "sizeMismatch", true],
    [1, "expectedHash", "d".repeat(64)],
  ] as const) {
    const modified = assets.map((asset, i) =>
      i === index ? { ...asset, [property]: value } : asset,
    );
    const result = resolveGroupPreviews([report], groups, modified, "widget");
    assert.equal(result.previews.length, 0, `${index} ${property}`);
    assert.equal(result.findings.length, 1);
  }
});

test("a broken latest render stays visible rather than silently falling back to an older report", () => {
  const { report, groups, assets } = fixture();
  const newer = {
    path: "review/group-previews-20261120T000000Z.json",
    data: { ...report.data, source_sha256: "c".repeat(64) },
  };
  const result = resolveGroupPreviews(
    [report, newer],
    groups,
    assets,
    "widget",
  );
  assert.equal(result.previews.length, 0);
  assert.equal(result.findings[0].path, newer.path);
  assert.match(result.findings[0].message, /render provenance/);
});
