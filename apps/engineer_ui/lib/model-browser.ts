import type { Asset, GroupMaterial, GroupPart, ModelGroup } from "./types";

export const UNVERSIONED = "__unversioned__";
export const UNGROUPED = "__ungrouped__";

export interface ModelEntry {
  key: string;
  asset: Asset;
  version: string;
  group?: ModelGroup;
  part?: GroupPart;
  material?: GroupMaterial;
}

export function modelEntries(
  assets: Asset[],
  groups: ModelGroup[],
): ModelEntry[] {
  const stls = assets.filter((asset) => asset.format === "stl");
  const byName = new Map(stls.map((asset) => [asset.name, asset]));
  const grouped = new Set<string>();
  const entries: ModelEntry[] = [];
  for (const group of groups) {
    for (const part of group.parts) {
      for (const mesh of part.meshes) {
        const asset = byName.get(mesh.asset);
        if (!asset) continue;
        grouped.add(asset.name);
        entries.push({
          key: `${group.id}/${part.id}/${asset.name}`,
          asset,
          version: group.revision,
          group,
          part,
          material: group.materials.find(
            (material) => material.id === mesh.material,
          ),
        });
      }
    }
  }
  for (const asset of stls
    .filter((asset) => !grouped.has(asset.name))
    .sort((a, b) =>
      b.name.localeCompare(a.name, undefined, { numeric: true }),
    )) {
    const version =
      /(?:^|[/_.-])(v\d+)(?=$|[/_.-])/i.exec(asset.name)?.[1].toLowerCase() ||
      UNVERSIONED;
    entries.push({ key: asset.name, asset, version });
  }
  return entries;
}

export interface ModelFilters {
  version: string;
  group: string;
  material: string;
  q: string;
}

export function filterModels(
  entries: ModelEntry[],
  filters: ModelFilters,
): ModelEntry[] {
  const query = filters.q.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (!filters.version || entry.version === filters.version) &&
      (!filters.group ||
        (filters.group === UNGROUPED
          ? !entry.group
          : entry.group?.id === filters.group)) &&
      (!filters.material || entry.material?.id === filters.material) &&
      (!query ||
        `${entry.asset.name} ${entry.group?.name ?? ""} ${entry.group?.id ?? ""} ${entry.group?.description ?? ""} ${entry.part?.name ?? ""} ${entry.part?.id ?? ""} ${entry.material?.name ?? ""} ${entry.material?.material ?? ""}`
          .toLowerCase()
          .includes(query)),
  );
}
