import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadCatalog } from "../lib/catalog";
import { catalogPhoto, productImages } from "../lib/catalog-images";
import { assetUrl, productUrl } from "../lib/types";

test("catalog photographs are inventoried and served as the exact rendered PNGs", async ({
  request,
}) => {
  const catalog = await loadCatalog();
  const photos = catalog.products.flatMap((product) =>
    product.assets.filter((asset) => catalogPhoto(asset)),
  );
  test.skip(
    !photos.length,
    "This catalog has no published catalog photography.",
  );
  for (const asset of photos) {
    expect(asset.missing, asset.path).toBe(false);
    expect(asset.tracked, asset.path).toBe(true);
    expect(asset.inventoryValid, asset.path).toBe(true);
    expect(asset.sizeMismatch, asset.path).toBe(false);
    const response = await request.get(assetUrl(asset.path));
    expect(response.status(), asset.path).toBe(200);
    expect(response.headers()["content-type"], asset.path).toBe("image/png");
    const bytes = await response.body();
    expect(bytes.subarray(0, 8).toString("hex"), asset.path).toBe(
      "89504e470d0a1a0a",
    );
    expect(createHash("sha256").update(bytes).digest("hex"), asset.path).toBe(
      asset.expectedHash,
    );
  }
});

test("fresh hero shots lead product cards and galleries, with missing photography visible", async ({
  page,
}) => {
  const catalog = await loadCatalog();
  const photographed = catalog.products.filter(
    (product) => productImages(product.assets).hero,
  );
  test.skip(
    !photographed.length,
    "This catalog has no published catalog photography.",
  );
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Catalog photography" }),
  ).toContainText(`${photographed.length} of ${catalog.products.length}`);
  for (const product of photographed) {
    const hero = productImages(product.assets).hero!;
    const card = page.locator(`.product-card[href="${productUrl(product)}"]`);
    const image = card.locator("img");
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute("src", assetUrl(hero.path));
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(card.locator(".photo-tag")).toHaveText("Catalog render");
  }
  for (const product of photographed) {
    await page.goto(`${productUrl(product)}?tab=images`);
    const latest = productImages(product.assets)
      .images.filter((asset) => catalogPhoto(asset))
      .slice(0, 3);
    for (const [index, asset] of latest.entries()) {
      await expect(
        page.locator(".gallery-item img").nth(index),
      ).toHaveAttribute("src", assetUrl(asset.path));
    }
  }
  await page.goto("/attention#photography");
  for (const product of catalog.products.filter(
    (product) => !productImages(product.assets).hero,
  )) {
    await expect(
      page.locator("#photography").getByText(product.name, { exact: true }),
    ).toBeVisible();
  }
});
