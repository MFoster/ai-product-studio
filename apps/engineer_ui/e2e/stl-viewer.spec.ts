import { expect, test } from "@playwright/test";
import { loadCatalog } from "../lib/catalog";
import { productUrl } from "../lib/types";

async function sample() {
  const catalog = await loadCatalog();
  return catalog.products
    .flatMap((product) =>
      product.assets
        .filter(
          (asset) =>
            asset.format === "stl" &&
            !asset.missing &&
            asset.size > 0 &&
            asset.size < 2 * 1024 * 1024,
        )
        .map((asset) => ({ product, asset })),
    )
    .sort((a, b) => a.asset.size - b.asset.size)[0];
}

test("STL assets open a rendered, interactive model with dimensions and downloads", async ({
  page,
}) => {
  const chosen = await sample();
  test.skip(!chosen, "This catalog has no small STL assets.");
  if (!chosen) return;
  const { product, asset } = chosen;
  await page.goto(`${productUrl(product)}?tab=assets`);
  await page.getByRole("textbox", { name: "Find an asset" }).fill(asset.name);
  await page
    .getByRole("link", { name: `Preview ${asset.name}`, exact: true })
    .click();
  const canvas = page.locator(".stl-viewport canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".stl-viewport")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByLabel("STL mesh statistics")).toContainText(
    "triangles",
  );
  await expect(page.getByLabel("STL mesh statistics")).toContainText(
    "mm (assumed)",
  );
  await expect(page.locator(".stl-viewer [role=alert]")).toHaveCount(0);
  const solid = await canvas.screenshot();
  const wireframe = page.getByRole("button", {
    name: "Wireframe",
    exact: true,
  });
  await expect(wireframe).toHaveAttribute("aria-pressed", "false");
  await wireframe.click();
  await expect(wireframe).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await canvas.screenshot()).equals(solid))
    .toBe(false);
  const grid = page.getByRole("button", { name: "Grid", exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  const viewport = await canvas.boundingBox();
  expect(viewport).not.toBeNull();
  if (viewport) {
    await page.mouse.move(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      viewport.x + viewport.width / 2 + 80,
      viewport.y + viewport.height / 2 + 40,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.mouse.wheel(0, -150);
  }
  await page.getByRole("button", { name: "Fit model", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download STL", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    asset.name.split("/").pop(),
  );
  const another = product.assets.find(
    (item) =>
      item.format === "stl" &&
      !item.missing &&
      item.path !== asset.path &&
      item.size < 2 * 1024 * 1024,
  );
  if (another) {
    await page
      .locator(".document-list")
      .getByRole("link", { name: another.name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: another.name, exact: true }),
    ).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect(wireframe).toHaveAttribute("aria-pressed", "false");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("invalid STL and lost WebGL contexts show explicit, recoverable errors", async ({
  page,
}) => {
  const chosen = await sample();
  test.skip(!chosen, "This catalog has no small STL assets.");
  if (!chosen) return;
  const { product, asset } = chosen;
  await page.route("**/api/assets?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("path") === asset.path
    ) {
      await route.fulfill({
        contentType: "application/octet-stream",
        body: "not an STL",
      });
    } else await route.continue();
  });
  await page.goto(
    `${productUrl(product)}?tab=models&file=${encodeURIComponent(asset.name)}`,
  );
  await expect(page.locator(".stl-viewer [role=alert]")).toContainText(
    "not a valid",
  );
  await expect(
    page.getByRole("link", { name: "Download STL", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/assets?**");
  await page
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  const canvas = page.locator(".stl-viewport canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".stl-viewport")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const lost = await canvas.evaluate((element: HTMLCanvasElement) => {
    const extension = element
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);
  await expect(page.locator(".stl-viewer [role=alert]")).toContainText(
    "lost its WebGL context",
  );
  await page
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  await expect(canvas).toBeVisible();
});

test("browsers without WebGL retain an actionable fallback and the STL download", async ({
  page,
}) => {
  const chosen = await sample();
  test.skip(!chosen, "This catalog has no small STL assets.");
  if (!chosen) return;
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type.includes("webgl")) return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.goto(
    `${productUrl(chosen.product)}?tab=models&file=${encodeURIComponent(chosen.asset.name)}`,
  );
  await expect(page.locator(".stl-viewer [role=alert]")).toContainText(
    "STL preview unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Retry preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download STL", exact: true }),
  ).toBeVisible();
});
