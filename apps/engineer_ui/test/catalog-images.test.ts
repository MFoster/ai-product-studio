import assert from "node:assert/strict";
import { test } from "node:test";
import { productImages } from "../lib/catalog-images";
import type { Asset } from "../lib/types";

function image(name: string, overrides: Partial<Asset> = {}): Asset {
  return {
    name,
    path: `product-line/demo/variant/default/widget/${name}`,
    format: "png",
    size: 100,
    modified: "2026-01-01T00:00:00Z",
    kind: "preview",
    tracked: true,
    inventoryValid: true,
    missing: false,
    sizeMismatch: false,
    ...overrides,
  };
}

test("latest catalog hero is the cover and a shoot appears hero, rear, detail before old references", () => {
  const assets = [
    image("source/zzz-front-reference.png"),
    image("preview/widget-v999-hero.png"),
    image("preview/catalog-20261118T0430Z-detail.png"),
    image("preview/catalog-20261118T0430Z-rear.png"),
    image("preview/catalog-20261118T0430Z-hero.png"),
    image("preview/catalog-20261117T235900Z-hero.png", {
      modified: "2027-01-01T00:00:00Z",
    }),
  ];
  const result = productImages(assets);
  assert.equal(result.cover?.name, "preview/catalog-20261118T0430Z-hero.png");
  assert.equal(result.hero, result.cover);
  assert.deepEqual(
    result.images.slice(0, 3).map((asset) => asset.name),
    [
      "preview/catalog-20261118T0430Z-hero.png",
      "preview/catalog-20261118T0430Z-rear.png",
      "preview/catalog-20261118T0430Z-detail.png",
    ],
  );
  assert.equal(result.images.length, assets.length);
});

test("missing heroes are never selected and incomplete shoots do not claim new hero coverage", () => {
  const result = productImages([
    image("preview/catalog-20261118T0430Z-hero.png", { missing: true }),
    image("preview/catalog-20261118T0430Z-rear.png"),
    image("preview/widget-v001-hero.png"),
    image("source/catalog-20261118T0430Z-hero.png"),
  ]);
  assert.equal(result.hero, undefined);
  assert.equal(result.cover?.name, "preview/widget-v001-hero.png");
  assert.equal(result.images.length, 3);
  assert.equal(productImages([]).cover, undefined);
});

test("mixed minute and second shoot identifiers sort chronologically", () => {
  const result = productImages([
    image("preview/catalog-20261118T0430Z-hero.png"),
    image("preview/catalog-20261118T043001Z-hero.png"),
  ]);
  assert.equal(result.cover?.name, "preview/catalog-20261118T043001Z-hero.png");
});
