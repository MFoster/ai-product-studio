import { imageAsset, type Asset } from "./types";

export interface CatalogPhoto {
  shoot: string;
  view: "hero" | "rear" | "detail";
}

export function catalogPhoto(asset: Asset): CatalogPhoto | undefined {
  const match =
    /^preview\/catalog-(\d{8}T\d{4}(?:\d{2})?Z)-(hero|rear|detail)\.(png|jpe?g|webp)$/i.exec(
      asset.name,
    );
  const shoot = match?.[1];
  const view = match?.[2].toLowerCase();
  if (!shoot || (view !== "hero" && view !== "rear" && view !== "detail"))
    return;
  return {
    shoot: shoot.length === 14 ? `${shoot.slice(0, -1)}00Z` : shoot,
    view,
  };
}

export function productImages(assets: Asset[]) {
  const order = { hero: 0, rear: 1, detail: 2 };
  const images = assets.filter(imageAsset).sort((a, b) => {
    const photoA = catalogPhoto(a);
    const photoB = catalogPhoto(b);
    if (photoA && photoB)
      return (
        photoB.shoot.localeCompare(photoA.shoot) ||
        order[photoA.view] - order[photoB.view]
      );
    if (photoA || photoB) return photoA ? -1 : 1;
    return (
      Number(b.name.startsWith("preview/")) -
        Number(a.name.startsWith("preview/")) ||
      b.name.localeCompare(a.name, undefined, { numeric: true })
    );
  });
  const hero = images.find((asset) => catalogPhoto(asset)?.view === "hero");
  const previews = images.filter((asset) => asset.name.startsWith("preview/"));
  const cover =
    hero ??
    previews.find((asset) => /overview|hero|front|beauty/i.test(asset.name)) ??
    previews[0] ??
    images.find((asset) => /overview|hero|front|beauty/i.test(asset.name)) ??
    images[0];
  return { images, cover, hero };
}
