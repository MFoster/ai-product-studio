import { expect, test } from "@playwright/test";
import { loadCatalog } from "../lib/catalog";
import { modelEntries } from "../lib/model-browser";
import { assetUrl, productUrl } from "../lib/types";
import { createHash } from "node:crypto";

test("all complete assembly renders are inventoried and served as their original PNGs", async ({
  request,
}) => {
  const catalog = await loadCatalog();
  const products = catalog.products.filter((product) => product.groups.length);
  expect(products.length).toBeGreaterThan(0);
  for (const product of products) {
    expect(product.groupPreviews.length).toBe(product.groups.length);
    for (const preview of product.groupPreviews) {
      const response = await request.get(assetUrl(preview.image.path));
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/png");
      const image = await response.body();
      expect(createHash("sha256").update(image).digest("hex")).toBe(
        preview.image.expectedHash,
      );
      expect(image.readUInt32BE(16)).toBe(preview.width);
      expect(image.readUInt32BE(20)).toBe(preview.height);
    }
  }
});

test("opening a group starts with its assembled image and keeps individual STL inspection and back navigation", async ({
  page,
}) => {
  const catalog = await loadCatalog();
  const product = catalog.products.find(
    (product) => product.groups.length > 1 && product.groupPreviews.length > 1,
  );
  expect(product).toBeTruthy();
  if (!product) return;
  const initial = product.groups[0];
  const target = product.groups[1];
  await page.goto(`${productUrl(product)}?tab=models`);
  await expect(
    page.getByRole("img", {
      name: `Fully assembled ${initial.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".stl-viewport canvas")).toHaveCount(0);
  await page
    .getByRole("link", { name: `View complete ${target.name}`, exact: true })
    .click();
  const image = page.getByRole("img", {
    name: `Fully assembled ${target.name}`,
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth === 2000,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("link", { name: "Download group package", exact: true }),
  ).toBeVisible();
  const group = page.locator(".model-group").filter({
    has: page.getByRole("link", {
      name: `View complete ${target.name}`,
      exact: true,
    }),
  });
  await group.locator(".model-part > summary").first().click();
  const mesh = target.parts[0].meshes[0];
  await group.getByRole("link", { name: mesh.asset, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: mesh.asset, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stl-viewport canvas")).toBeVisible();
  await expect(image).toHaveCount(0);
  await page
    .getByRole("link", { name: "View complete model", exact: true })
    .click();
  await expect(image).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: mesh.asset, exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(image).toBeVisible();
  await page.reload();
  await expect(image).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(image).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("a failed assembly image shows a recoverable error without removing print downloads", async ({
  page,
}) => {
  const catalog = await loadCatalog();
  const product = catalog.products.find(
    (product) => product.groupPreviews.length,
  );
  expect(product).toBeTruthy();
  if (!product) return;
  const preview = product.groupPreviews[0];
  await page.route("**/api/assets?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("path") ===
      preview.image.path
    )
      await route.fulfill({ status: 404, body: "Missing image" });
    else await route.continue();
  });
  await page.goto(
    `${productUrl(product)}?tab=models&overview=${preview.groupId}`,
  );
  await expect(page.locator(".group-overview [role=alert]")).toContainText(
    "assembled image could not be loaded",
  );
  await expect(
    page.getByRole("link", { name: "Download group package", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/assets?**");
  await page.getByRole("button", { name: "Retry image", exact: true }).click();
  await expect(page.locator(".group-overview img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".group-overview img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
});

test("Models uses group and part metadata with shareable filters, material colors and package downloads", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const catalog = await loadCatalog();
  const product = catalog.products.find((product) => product.groups.length);
  test.skip(!product, "This catalog has no grouped models.");
  if (!product) return;
  const entries = modelEntries(product.assets, product.groups);
  const chosen = entries
    .filter(
      (entry) =>
        entry.group &&
        entry.group.parts.length > 1 &&
        entry.part === entry.group.parts[0] &&
        !entry.asset.missing,
    )
    .sort((a, b) => a.asset.size - b.asset.size)[0];
  expect(chosen?.group).toBeTruthy();
  if (!chosen?.group || !chosen.part || !chosen.material) return;
  const group = chosen.group;
  const filters = new URLSearchParams({
    tab: "models",
    file: chosen.asset.name,
    member: chosen.key,
  });
  await page.goto(`${productUrl(product)}?${filters}`);
  const metadata = page.getByRole("region", { name: "Model group metadata" });
  await expect(
    metadata.getByRole("heading", { name: group.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`Quantity in group: ${chosen.part.quantity}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(metadata).toContainText(
    `${group.parts.reduce((sum, part) => sum + part.quantity, 0)} physical parts`,
  );
  await expect(metadata.locator(".material-swatch").first()).toHaveCSS(
    "background-color",
    `rgb(${[1, 3, 5].map((offset) => parseInt(group.materials[0].color.slice(offset, offset + 2), 16)).join(", ")})`,
  );
  await expect(page.locator(".stl-viewport canvas")).toBeVisible();
  await page.getByLabel("Filter model version").selectOption(chosen.version);
  await expect(page).toHaveURL(/version=v003/);
  await page.getByLabel("Filter model group").selectOption(group.id);
  await expect(page).toHaveURL(new RegExp(`group=${group.id}`));
  await page
    .getByLabel("Filter model material")
    .selectOption(chosen.material.id);
  await expect(page).toHaveURL(new RegExp(`material=${chosen.material.id}`));
  await page
    .getByRole("textbox", { name: "Search models" })
    .fill(chosen.part.name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe(chosen.part?.name);
  await page
    .locator(".document-list")
    .getByRole("link", { name: chosen.asset.name, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: chosen.asset.name, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Filter model version")).toHaveValue(
    chosen.version,
  );
  await expect(page.getByLabel("Filter model group")).toHaveValue(group.id);
  await expect(page.getByLabel("Filter model material")).toHaveValue(
    chosen.material.id,
  );
  await expect(
    page.getByRole("textbox", { name: "Search models" }),
  ).toHaveValue(chosen.part.name);
  await expect(
    page.getByRole("heading", { name: chosen.asset.name, exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download group package", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    group.package.split("/").pop(),
  );
  const legacy = entries.find(
    (entry) => !entry.group && entry.version !== chosen.version,
  );
  expect(legacy).toBeTruthy();
  if (!legacy) return;
  await page.getByLabel("Filter model version").selectOption(legacy.version);
  await expect(
    page.getByText("No models match these filters.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByLabel("Filter model group")).toHaveValue("");
  await page.getByLabel("Filter model version").selectOption(legacy.version);
  await expect(metadata).toHaveCount(0);
  await expect(
    page.locator(".document-list").getByRole("link").first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
