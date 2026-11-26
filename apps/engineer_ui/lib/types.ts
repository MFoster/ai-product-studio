export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordData = { [key: string]: Json };

export interface Finding {
  severity: "error" | "warning";
  message: string;
  path: string;
  productId?: string;
  line?: string;
}

export interface Asset {
  path: string;
  name: string;
  size: number;
  modified: string;
  format: string;
  kind: string;
  tracked: boolean;
  inventoryValid: boolean;
  expectedHash?: string;
  expectedSize?: number;
  missing: boolean;
  sizeMismatch: boolean;
}

export interface Product {
  id: string;
  slug: string;
  line: string;
  variant: string;
  name: string;
  summary: string;
  path: string;
  stage: string;
  physical: string;
  updated: string;
  manifest: RecordData;
  workflow: RecordData;
  assets: Asset[];
  groups: ModelGroup[];
  groupPreviews: GroupPreview[];
  findings: Finding[];
  blockers: string[];
}

export interface GroupPreview {
  groupId: string;
  revision: string;
  image: Asset;
  width: number;
  height: number;
}

export interface GroupMaterial {
  id: string;
  name: string;
  color: string;
  material: string;
}

export interface GroupMesh {
  asset: string;
  material: string;
  sha256: string;
}

export interface GroupPart {
  id: string;
  name: string;
  quantity: number;
  meshes: GroupMesh[];
}

export interface ModelGroup {
  id: string;
  name: string;
  revision: string;
  description: string;
  package: string;
  materials: GroupMaterial[];
  parts: GroupPart[];
  layout: {
    spacing_mm: number;
    margin_mm: number;
    orientation: "preserve-source";
  };
}

export interface Variant {
  slug: string;
  name: string;
  manifest: RecordData;
}

export interface ProductLine {
  slug: string;
  name: string;
  description: string;
  manifest: RecordData;
  variants: Variant[];
}

export interface Catalog {
  name: string;
  scanned: string;
  lines: ProductLine[];
  products: Product[];
  findings: Finding[];
}

export const isRecord = (value: unknown): value is RecordData =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const text = (value: Json | undefined, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
export const strings = (value: Json | undefined): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export const productUrl = (
  product: Pick<Product, "line" | "variant" | "slug">,
) =>
  `/lines/${encodeURIComponent(product.line)}/${encodeURIComponent(product.variant)}/${encodeURIComponent(product.slug)}`;
export const assetUrl = (path: string, download = false) =>
  `/api/assets?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
export const imageAsset = (asset: Asset) =>
  !asset.missing &&
  ["png", "jpg", "jpeg", "webp", "gif"].includes(asset.format);
export const formatBytes = (size: number) => {
  if (size === 0) return "0 B";
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 3);
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${["B", "KB", "MB", "GB"][index]}`;
};
