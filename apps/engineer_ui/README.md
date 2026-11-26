# Studio inventory

A read-only Next.js / TypeScript application backed directly by the studio
filesystem. No database, copied product assets, or generated inventory is needed.

## Run locally

Requires Node.js 22.18+ and npm. From the repository root:

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The development and production servers bind to
loopback by default. To run a production build:

```bash
npm run build
npm start
```

By default the studio root is two levels above the `apps/engineer_ui` working
directory. npm workspace commands run scripts from that directory. To
review another studio, set the server-side `APS_STUDIO_ROOT` environment variable
to its absolute path. It must contain `config/studio.yaml` and `product-line/`.
The CLI also uses this variable, unless `--root` is specified. Restart the
server after changing the environment.

This is a **trusted local review tool, not an authenticated public service**.
Do not expose it directly to the internet or an untrusted network. Asset downloads
and document previews can contain private product information.

## Review features

- Overview with live product/asset counts, recent products, and inventory findings.
- Navigable product lines with variant and collection manifests.
- Search and product-line, variant, and workflow-stage filters.
- Product specifications, workflow history, approvals, and blockers.
- JSON/YAML reports as expandable readable fields or original source text.
- Image galleries with full-size previews and downloads.
- Timestamped catalog photography is prioritized on product cards and at the
  front of galleries; hero/rear/detail order is consistent across the catalog.
  The dashboard and attention page show products still missing catalog photos,
  without treating reference artwork as new photography.
- Interactive ASCII/binary STL previews using React Three Fiber, Drei, and
  Three.js, with orbit/pan/zoom, axis views, auto-framing, wireframe, and a grid.
- Models organized by named group and physical part, with quantities, revision,
  material/color metadata, package layout, and complete-group 3MF downloads.
  URL-backed version, group, material, and search filters preserve shareable views.
- Opening a group starts with its complete deployed assembly render. Individual
  part STLs remain one click away, with a link back to the complete model.
- Searchable assets with kind, size, inventory status, recorded hash, and download.
- Explicit on-demand streaming SHA-256 verification against `assets.yaml`.
- Missing files, size mismatches, untracked assets, malformed manifests, duplicate
  records, unsafe paths, and parent registry discrepancies remain visible.

Catalog metadata is read on each navigation or browser refresh; it is not watched
or polled. Recent ordering uses filesystem modification times, not release dates.
Hidden files and symlink directories are excluded. Individual asset symlinks
cannot escape the studio root. File downloads stream rather than buffer large
Blender or 3MF assets. Active content such as HTML and SVG is download-only.
Readable documents have a 4 MB limit; larger documents remain downloadable.
STL files can be opened from the Models tab or an asset's preview link. Geometry
is loaded only when selected, and dimensions assume millimeters because STL
does not encode units. Centering in the browser does not change source assets
or rescale geometry. Previews require WebGL 2 and are limited to 64 MB to bound
browser memory use. Invalid files, loading failures, and lost WebGL contexts
show explicit errors with a retry action; downloads remain available.
3MF and Blender files are downloaded for inspection in native applications.

Model groups come from authoritative `groups.yaml`, compared with the
`assets.yaml.groups` snapshot. Stale or invalid definitions, missing references,
and disagreements between recorded mesh hashes remain visible. If only a snapshot
exists, it is shown with a warning; invalid authoritative definitions never
silently fall back to it. Ungrouped STLs remain browsable, with version labels
inferred from `vNNN` filename/path segments (or shown as unversioned). Membership
is never inferred from filenames. Each preview still shows **one mesh**, tinted
with its declared material color when available, not an assembled or sliced group.

Complete-model images are explicitly associated in
`review/group-previews-YYYYMMDDTHHMMSSZ.json`. Each record includes the full group
snapshot, an image path/SHA-256 and dimensions, and report-level source path/hash.
The loader uses the newest report for the matching group/revision, compares its
snapshot and image/source inventory records, and flags stale or missing assets
rather than presenting an old image as current. A failed image can be retried;
groups without a current image retain part inspection and package downloads.
Group images are renders of the authored deployed scene, not print-bed layouts,
physical photographs, or print-in-place manufacturing instructions.

`template/blender/group_photography.py` creates these reports and renders from
validated group snapshots and a checksummed source-export mapping; it never
infers assembly placement from print-bed STL positions. Its JSON config contains
the absolute `product` directory, `groups` (each `load_groups(...)` entry
serialized with `model_dump(mode="json")`),
the product-relative `export_report`, and a unique UTC `shoot` identifier.
Run it in background Blender with `--python-exit-code 1 --python <script> --
--config <config.json>`; add `--test` to inspect the first low-resolution frame
before the full shoot. It preserves authored geometry/materials, saves a separate
shoot scene and provenance report, and refuses to overwrite existing outputs.
Inventory the affected product with `aps assets inventory` after rendering.

Presence/size checks do **not** imply a matching checksum. Hashes remain unchecked
until a user requests verification; a subsequent file change requires
a new verification. Geometry, package, slice, and physical-print evidence are
shown as recorded and are never inferred from render or file availability.
This viewer does not replace full CLI schema or release validation.

Catalog photography is discovered from inventoried images named
`preview/catalog-<UTC shoot ID>-hero.png` (and `-rear.png`, `-detail.png`).
Shoot IDs use `YYYYMMDDTHHMMZ` or `YYYYMMDDTHHMMSSZ`; the newest hero is the
cover even when legacy images have lexically later filenames. Previous shoots
and other images remain available. These are Blender studio renders, not
evidence of a physical printed product.

Use the existing CLI from the repository root to regenerate inventories or run
full validation. The web application never runs write commands:

```bash
.venv/bin/aps assets inventory --help
.venv/bin/aps validate
```

## Development checks

```bash
npm run test --workspace=engineer_ui
npm run lint --workspace=engineer_ui
npm run format:check --workspace=engineer_ui
npm run typecheck --workspace=engineer_ui
npm run build --workspace=engineer_ui
```

Browser smoke tests use an installed Google Chrome and launch a temporary
production server on port 3107 after a build:

```bash
npm run build --workspace=engineer_ui
npm run test:e2e --workspace=engineer_ui
```
