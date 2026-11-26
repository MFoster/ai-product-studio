import { expect, test } from "@playwright/test";
import { loadCatalog } from "../lib/catalog";
import { imageAsset, productUrl } from "../lib/types";

test("dashboard, product-line navigation, and product filters work", async ({
  page,
}) => {
  const catalog = await loadCatalog();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Studio overview" }),
  ).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(
    catalog.products.length,
  );
  const sample = catalog.products[0];
  if (!sample) return;
  await page
    .getByRole("textbox", { name: "Search products" })
    .fill(sample.name);
  await expect(page.locator(".product-card").first()).toContainText(
    sample.name,
  );
  await page
    .getByRole("textbox", { name: "Search products" })
    .fill("no-such-product-938471");
  await expect(
    page.getByText("No products match these filters."),
  ).toBeVisible();
  const line = catalog.lines.find((item) => item.slug === sample.line)!;
  await page
    .getByRole("navigation", { name: "Product lines" })
    .getByRole("link", { name: new RegExp(line.name) })
    .click();
  await expect(
    page.getByRole("heading", { name: line.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(
    catalog.products.filter((product) => product.line === sample.line).length,
  );
  await page
    .getByRole("combobox", { name: "Filter by stage" })
    .selectOption(sample.stage);
  await expect(page.locator(".product-card")).toHaveCount(
    catalog.products.filter(
      (product) =>
        product.line === sample.line && product.stage === sample.stage,
    ).length,
  );
});

test("JSON evidence, image previews, downloads, and checksums are usable", async ({
  page,
}) => {
  const catalog = await loadCatalog();
  const product = catalog.products.find(
    (item) =>
      item.assets.some((asset) => asset.format === "json" && !asset.missing) &&
      item.assets.some(imageAsset),
  );
  test.skip(
    !product,
    "This catalog has no product with both JSON and image evidence.",
  );
  if (!product) return;
  const document = product.assets.find(
    (asset) => asset.format === "json" && !asset.missing,
  )!;
  await page.goto(
    `${productUrl(product)}?tab=documents&file=${encodeURIComponent(document.name)}`,
  );
  await expect(
    page.getByRole("heading", { name: product.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Readable", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator("pre.code")).toContainText("{");
  await page
    .getByRole("navigation", { name: "Product review sections" })
    .getByRole("link", { name: "images", exact: true })
    .click();
  await page.locator(".gallery-item").first().click();
  await expect(
    page.getByRole("dialog", { name: "Image preview" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("dialog")
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Close image" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".gallery-item").first().click();
  await page.getByRole("button", { name: "Close image" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Product review sections" })
    .getByRole("link", { name: "assets", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Find an asset" })
    .fill(document.name);
  const row = page
    .locator(".asset-table tbody tr")
    .filter({ hasText: document.name })
    .first();
  const downloadPromise = page.waitForEvent("download");
  await row
    .getByRole("link", { name: `Download ${document.name}`, exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(document.name.split("/").pop());
  if (document.expectedHash) {
    await row.getByRole("button", { name: "Verify hash", exact: true }).click();
    await expect(
      row.getByRole("button", { name: /Hash matches|Hash mismatch/ }),
    ).toBeVisible();
  }
});

test("mobile navigation and empty routes remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Studio overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto("/lines/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "This catalog entry does not exist." }),
  ).toBeVisible();
});
