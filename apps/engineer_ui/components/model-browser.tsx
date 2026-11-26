"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Box, Download, ImageIcon, Layers3, Search } from "lucide-react";
import {
  filterModels,
  modelEntries,
  UNGROUPED,
  UNVERSIONED,
  type ModelEntry,
} from "@/lib/model-browser";
import {
  assetUrl,
  type Asset,
  type GroupMaterial,
  type GroupPreview,
  type ModelGroup,
} from "@/lib/types";
import { Badge } from "./ui";
import { StlViewer } from "./stl-viewer";
import { GroupOverview } from "./group-overview";

function Material({ material }: { material: GroupMaterial }) {
  return (
    <span className="model-material">
      <span
        className="material-swatch"
        style={{ backgroundColor: material.color }}
      />
      {material.name}
      <small>{material.material.toUpperCase()}</small>
    </span>
  );
}

export function ModelBrowser({
  assets,
  groups,
  baseUrl,
  issues,
  previews,
}: {
  assets: Asset[];
  groups: ModelGroup[];
  baseUrl: string;
  issues: string[];
  previews: GroupPreview[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const entries = modelEntries(assets, groups);
  const filters = {
    version: params.get("version") || "",
    group: params.get("group") || "",
    material: params.get("material") || "",
    q: params.get("q") || "",
  };
  const filtered = filterModels(entries, filters);
  const selectedFile = params.get("file");
  const selected =
    filtered.find(
      (entry) =>
        entry.asset.name === selectedFile && entry.key === params.get("member"),
    ) ??
    filtered.find((entry) => entry.asset.name === selectedFile) ??
    filtered.find((entry) => !entry.asset.missing) ??
    filtered[0];
  const versions = [...new Set(entries.map((entry) => entry.version))].sort(
    (a, b) =>
      a === UNVERSIONED
        ? 1
        : b === UNVERSIONED
          ? -1
          : b.localeCompare(a, undefined, { numeric: true }),
  );
  const materials = [
    ...new Map(
      groups
        .flatMap((group) => group.materials)
        .map((material) => [material.id, material]),
    ).values(),
  ];
  const visibleGroups = groups.filter((group) =>
    filtered.some((entry) => entry.group?.id === group.id),
  );
  const ungrouped = filtered.filter((entry) => !entry.group);
  const meshCount = new Set(filtered.map((entry) => entry.asset.path)).size;
  const overviewGroup = selectedFile
    ? undefined
    : (visibleGroups.find((group) => group.id === params.get("overview")) ??
      (!filters.material && !filters.q ? selected?.group : undefined));

  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "models");
    next.delete("file");
    next.delete("member");
    next.delete("overview");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() =>
      router.replace(`${baseUrl}?${next}`, { scroll: false }),
    );
  }

  function modelUrl(entry: ModelEntry) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "models");
    next.set("file", entry.asset.name);
    next.set("member", entry.key);
    next.delete("overview");
    return `${baseUrl}?${next}`;
  }

  function overviewUrl(group: ModelGroup) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "models");
    next.set("overview", group.id);
    next.delete("file");
    next.delete("member");
    return `${baseUrl}?${next}`;
  }

  function meshLink(entry: ModelEntry) {
    return (
      <Link
        key={entry.key}
        className={`model-mesh ${!overviewGroup && entry.key === selected?.key ? "selected" : ""}`}
        href={modelUrl(entry)}
        scroll={false}
        aria-label={entry.asset.name}
        aria-current={
          !overviewGroup && entry.key === selected?.key ? "true" : undefined
        }
        title={entry.asset.name}
      >
        <Box size={14} />
        <span>
          <strong>
            {entry.material?.name || entry.asset.name.split("/").pop()}
          </strong>
          <small>{entry.asset.name.split("/").pop()}</small>
          {entry.asset.missing && <Badge tone="red">Missing file</Badge>}
        </span>
      </Link>
    );
  }

  const selectedGroup = overviewGroup ?? selected?.group;
  const groupPackage = selectedGroup
    ? assets.find(
        (asset) => asset.name === selectedGroup.package && !asset.missing,
      )
    : undefined;
  return (
    <div className="model-browser" aria-busy={pending}>
      <div className="model-filters">
        <form
          className="search model-search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({
              q: String(new FormData(event.currentTarget).get("q") || ""),
            });
          }}
        >
          <Search size={16} />
          <input
            key={filters.q}
            name="q"
            defaultValue={filters.q}
            aria-label="Search models"
            placeholder="Search parts, groups or files..."
          />
          <button type="submit" disabled={pending}>
            Search
          </button>
        </form>
        <label>
          Version
          <select
            aria-label="Filter model version"
            value={filters.version}
            disabled={pending}
            onChange={(event) => navigate({ version: event.target.value })}
          >
            <option value="">All versions</option>
            {versions.map((version) => (
              <option key={version} value={version}>
                {version === UNVERSIONED ? "Unversioned" : version}
              </option>
            ))}
          </select>
        </label>
        {!!groups.length && (
          <>
            <label>
              Group
              <select
                aria-label="Filter model group"
                value={filters.group}
                disabled={pending}
                onChange={(event) => navigate({ group: event.target.value })}
              >
                <option value="">All groups</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
                {entries.some((entry) => !entry.group) && (
                  <option value={UNGROUPED}>Ungrouped models</option>
                )}
              </select>
            </label>
            <label>
              Material
              <select
                aria-label="Filter model material"
                value={filters.material}
                disabled={pending}
                onChange={(event) => navigate({ material: event.target.value })}
              >
                <option value="">All materials</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} ({material.id})
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {Object.values(filters).some(Boolean) && (
          <button
            className="filter-reset"
            onClick={() =>
              startTransition(() =>
                router.replace(`${baseUrl}?tab=models`, { scroll: false }),
              )
            }
            disabled={pending}
          >
            Clear filters
          </button>
        )}
      </div>
      <p className="results-caption" role="status">
        {meshCount} mesh files · {visibleGroups.length} groups
        {pending && " · Updating..."}
      </p>
      {!!issues.length && (
        <details className="model-issues">
          <summary>Group metadata needs attention ({issues.length})</summary>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </details>
      )}
      {!selected ? (
        <div className="empty">
          {entries.length
            ? "No models match these filters."
            : "No STL models are available for this product yet."}
        </div>
      ) : (
        <div className="document-layout model-layout">
          <aside
            className="document-list model-list"
            aria-label="Model groups and parts"
          >
            <div className="eyebrow">GROUPS & MODEL PARTS</div>
            {visibleGroups.map((group) => {
              const members = filtered.filter(
                (entry) => entry.group?.id === group.id,
              );
              return (
                <details
                  className="model-group"
                  key={group.id}
                  open={
                    selectedGroup?.id === group.id ||
                    !!filters.group ||
                    !!filters.q
                  }
                >
                  <summary>
                    <Layers3 size={14} />
                    <Link
                      href={overviewUrl(group)}
                      scroll={false}
                      aria-label={`View complete ${group.name}`}
                      aria-current={
                        overviewGroup?.id === group.id ? "true" : undefined
                      }
                    >
                      {group.name}
                      <small>
                        {group.revision} ·{" "}
                        {group.parts.reduce(
                          (sum, part) => sum + part.quantity,
                          0,
                        )}{" "}
                        physical parts
                      </small>
                    </Link>
                  </summary>
                  {group.parts
                    .filter((part) =>
                      members.some((entry) => entry.part?.id === part.id),
                    )
                    .map((part) => (
                      <details
                        className="model-part"
                        key={part.id}
                        open={
                          (!overviewGroup &&
                            selected.group?.id === group.id &&
                            selected.part?.id === part.id) ||
                          !!filters.q ||
                          !!filters.material
                        }
                      >
                        <summary>
                          {part.name}
                          <span>×{part.quantity}</span>
                        </summary>
                        {members
                          .filter((entry) => entry.part?.id === part.id)
                          .map(meshLink)}
                      </details>
                    ))}
                </details>
              );
            })}
            {!!ungrouped.length && (
              <details className="model-group" open>
                <summary>
                  <Box size={14} />
                  <span>
                    {groups.length ? "Ungrouped models" : "STL models"}
                    <small>{ungrouped.length} files</small>
                  </span>
                </summary>
                {ungrouped.map(meshLink)}
              </details>
            )}
          </aside>
          <section className="panel document-panel">
            {selectedGroup && (
              <section
                className="model-group-info"
                aria-label="Model group metadata"
              >
                <div className="section-heading">
                  <h2>{selectedGroup.name}</h2>
                  <Badge>{selectedGroup.revision}</Badge>
                </div>
                <p>{selectedGroup.description}</p>
                <div className="model-group-stats">
                  <span>{selectedGroup.parts.length} part types</span>
                  <span>
                    {selectedGroup.parts.reduce(
                      (sum, part) => sum + part.quantity,
                      0,
                    )}{" "}
                    physical parts
                  </span>
                  <span>
                    {selectedGroup.parts.reduce(
                      (sum, part) => sum + part.meshes.length,
                      0,
                    )}{" "}
                    mesh references
                  </span>
                </div>
                <div className="model-palette">
                  {selectedGroup.materials.map((material) => (
                    <Material key={material.id} material={material} />
                  ))}
                </div>
                <div className="model-package">
                  {groupPackage ? (
                    <a
                      href={assetUrl(groupPackage.path, true)}
                      className="text-link"
                      aria-label="Download group package"
                    >
                      <Download size={14} />
                      Download complete group 3MF
                    </a>
                  ) : (
                    <Badge tone="red">Group package unavailable</Badge>
                  )}
                  <small>
                    Packaging metadata only; not a sliced or qualified assembly.
                  </small>
                  {!overviewGroup && (
                    <Link
                      className="text-link"
                      href={overviewUrl(selectedGroup)}
                      scroll={false}
                    >
                      <ImageIcon size={14} />
                      View complete model
                    </Link>
                  )}
                </div>
                <details className="model-layout-info">
                  <summary>Package layout metadata</summary>
                  <p>
                    {selectedGroup.layout.spacing_mm} mm spacing ·{" "}
                    {selectedGroup.layout.margin_mm} mm margin · Source
                    orientations preserved
                  </p>
                  <code>{selectedGroup.package}</code>
                </details>
              </section>
            )}
            {overviewGroup ? (
              <GroupOverview
                key={`${overviewGroup.id}:${previews.find((preview) => preview.groupId === overviewGroup.id)?.image.path}`}
                group={overviewGroup}
                preview={previews.find(
                  (preview) =>
                    preview.groupId === overviewGroup.id &&
                    preview.revision === overviewGroup.revision,
                )}
              />
            ) : (
              <>
                {selected.part && (
                  <div className="model-part-info">
                    <strong>{selected.part.name}</strong>
                    <Badge>Quantity in group: {selected.part.quantity}</Badge>
                    {selected.material && (
                      <Material material={selected.material} />
                    )}
                  </div>
                )}
                <div className="section-heading">
                  <h2 className="document-title">{selected.asset.name}</h2>
                  {!selected.asset.missing && (
                    <a
                      className="icon-button"
                      href={assetUrl(selected.asset.path, true)}
                      aria-label="Download STL"
                    >
                      <Download size={17} />
                    </a>
                  )}
                </div>
                {selected.asset.missing ? (
                  <div className="inline-error" role="alert">
                    This mesh is referenced by the group but is missing or
                    inaccessible. Review the group definition and inventory.
                  </div>
                ) : (
                  <StlViewer
                    key={`${selected.asset.path}:${selected.asset.modified}`}
                    asset={selected.asset}
                    color={selected.material?.color}
                  />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
