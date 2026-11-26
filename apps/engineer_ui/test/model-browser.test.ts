import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterModels,
  modelEntries,
  UNGROUPED,
  UNVERSIONED,
} from "../lib/model-browser";
import { parseModelGroups } from "../lib/model-groups";
import type { Asset, Json } from "../lib/types";
import { modelGroup } from "./fixtures/model-group";

function asset(name: string): Asset {
  return {
    name,
    path: `product/${name}`,
    format: "stl",
    size: 12,
    modified: "",
    kind: "export",
    tracked: false,
    inventoryValid: false,
    missing: false,
    sizeMismatch: false,
  };
}

function entries() {
  return modelEntries(
    [
      asset("export/v999/shared.stl"),
      asset("export/v999/metal.stl"),
      asset("export/widget-v010-structure.stl"),
      asset("export/v002/widget.stl"),
      asset("export/widget.stl"),
    ],
    [modelGroup()],
  );
}

test("group membership supplies authoritative revisions, physical quantities and shared-mesh contexts", () => {
  const grouped = entries().filter((entry) => entry.group);
  assert.equal(grouped.length, 3);
  assert.ok(grouped.every((entry) => entry.version === "v003"));
  const shared = grouped.filter((entry) =>
    entry.asset.name.endsWith("shared.stl"),
  );
  assert.equal(new Set(shared.map((entry) => entry.key)).size, 2);
  assert.deepEqual(
    shared.map((entry) => entry.part?.quantity),
    [2, 4],
  );
  assert.equal(
    grouped.find((entry) => entry.material?.id === "metal")?.material?.color,
    "#86A493",
  );
  assert.deepEqual(
    entries()
      .filter((entry) => !entry.group)
      .map((entry) => entry.version)
      .sort(),
    ["v010", "v002", UNVERSIONED].sort(),
  );
});

test("version, group, material and metadata search filters intersect without hiding legacy models by default", () => {
  const all = entries();
  const defaults = { version: "", group: "", material: "", q: "" };
  assert.equal(filterModels(all, defaults).length, 6);
  assert.equal(
    filterModels(all, {
      ...defaults,
      version: "v003",
      group: "assembly",
      material: "stone",
      q: "LOCATING pin",
    })[0]?.part?.quantity,
    4,
  );
  assert.equal(
    filterModels(all, { ...defaults, version: "v010", group: "assembly" })
      .length,
    0,
  );
  assert.equal(filterModels(all, { ...defaults, group: UNGROUPED }).length, 3);
  assert.equal(
    filterModels(all, { ...defaults, version: UNVERSIONED })[0]?.asset.name,
    "export/widget.stl",
  );
  assert.equal(filterModels(all, { ...defaults, q: "metal.stl" }).length, 1);
});

test("malformed group metadata is reported, not used as unsafe or misleading browser data", () => {
  const group = modelGroup();
  const invalid: [Json, string][] = [
    [{ ...group, package: "package/../../outside.3mf" }, "reference"],
    [{ ...group, parts: [{ ...group.parts[0], quantity: 1.5 }] }, "quantities"],
    [
      { ...group, materials: [{ ...group.materials[0], color: "red" }] },
      "color",
    ],
    [
      {
        ...group,
        parts: [
          {
            ...group.parts[0],
            meshes: [{ ...group.parts[0].meshes[0], material: "unknown" }],
          },
        ],
      },
      "Unknown material",
    ],
    [
      {
        ...group,
        parts: [
          {
            ...group.parts[0],
            meshes: [{ ...group.parts[0].meshes[0], sha256: "invalid" }],
          },
        ],
      },
      "SHA-256",
    ],
    [{ ...group, layout: { ...group.layout, spacing_mm: 0 } }, "distance"],
  ];
  for (const [value, message] of invalid) {
    const result = parseModelGroups([value, group]);
    assert.equal(result.groups.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], new RegExp(message));
  }
});
