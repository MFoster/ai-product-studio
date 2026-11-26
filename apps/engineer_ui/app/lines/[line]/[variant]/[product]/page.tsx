import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileJson2 } from "lucide-react";
import { AssetBrowser, Gallery } from "@/components/asset-browser";
import { StlViewer } from "@/components/stl-viewer";
import { ModelBrowser } from "@/components/model-browser";
import { DataView } from "@/components/data-view";
import { Badge, Findings, PageHeader, Stage } from "@/components/ui";
import { readDocument } from "@/lib/catalog";
import { studioRoot } from "@/lib/files";
import { getCatalog } from "@/lib/server";
import { assetUrl, productUrl, type Json } from "@/lib/types";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ line: string; variant: string; product: string }>;
  searchParams: Promise<{ tab?: string; file?: string }>;
}) {
  const route = await params;
  const query = await searchParams;
  const catalog = await getCatalog();
  const product = catalog.products.find(
    (item) =>
      item.line === route.line &&
      item.variant === route.variant &&
      item.slug === route.product,
  );
  if (!product) notFound();
  const line = catalog.lines.find((item) => item.slug === product.line)!;
  const baseUrl = productUrl(product);
  const tabs = [
    "overview",
    "images",
    "models",
    "documents",
    "assets",
    "workflow",
    "findings",
  ];
  const tab = tabs.includes(query.tab || "") ? query.tab : "overview";
  const documents = product.assets.filter(
    (asset) =>
      !asset.missing &&
      ["json", "yaml", "yml", "md", "txt", "csv", "log", "py"].includes(
        asset.format,
      ),
  );
  const models = product.assets
    .filter((asset) => !asset.missing && asset.format === "stl")
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  const available = [
    "product.yaml",
    "workflow.yaml",
    "assets.yaml",
    ...documents.map((asset) => asset.name),
  ];
  const selected =
    query.file &&
    (available.includes(query.file) ||
      product.assets.some(
        (asset) => !asset.missing && asset.name === query.file,
      ))
      ? query.file
      : documents.find((asset) => asset.format === "json")?.name ||
        "product.yaml";
  const selectedAsset = product.assets.find((asset) => asset.name === selected);
  const selectedImage =
    selectedAsset &&
    ["png", "jpg", "jpeg", "webp", "gif"].includes(selectedAsset.format);
  const selectedStl =
    selectedAsset && !selectedAsset.missing && selectedAsset.format === "stl";
  let document: { content: string; data: Json } | undefined;
  let documentError = "";
  if (tab === "documents" && !selectedImage && !selectedStl) {
    if (!available.includes(selected)) {
      documentError =
        "This binary format cannot be previewed. Download it for inspection in its native application.";
    } else {
      try {
        document = await readDocument(
          studioRoot(),
          `${product.path}/${selected}`,
        );
      } catch (error) {
        documentError =
          error instanceof Error ? error.message : "Could not read document.";
      }
    }
  }
  return (
    <>
      <Link href={`/lines/${product.line}`} className="back-link">
        <ArrowLeft size={14} />
        {line.name}
        <span>/</span>
        {product.variant}
      </Link>
      <PageHeader
        eyebrow={`${line.name.toUpperCase()} / ${product.variant.toUpperCase()}`}
        title={product.name}
        description={
          product.summary ||
          "Review this product's design, assets, and validation evidence."
        }
      >
        <Stage stage={product.stage} />
      </PageHeader>
      <div className="product-facts">
        <span>
          <strong>{product.assets.length}</strong> assets
        </span>
        <span>
          <strong>
            {product.assets.filter((asset) => asset.format === "json").length}
          </strong>{" "}
          JSON reports
        </span>
        <span>
          <strong>{product.blockers.length}</strong> workflow blockers
        </span>
        <span>
          Physical print:{" "}
          <Badge
            tone={
              product.physical === "passed"
                ? "green"
                : product.physical === "failed"
                  ? "red"
                  : "amber"
            }
          >
            {product.physical}
          </Badge>
        </span>
      </div>
      <nav className="tabs" aria-label="Product review sections">
        {tabs.map((item) => (
          <Link
            className={tab === item ? "selected" : ""}
            href={`${baseUrl}?tab=${item}`}
            key={item}
          >
            {item}
            {item === "findings" && <span>{product.findings.length}</span>}
            {item === "models" && <span>{models.length}</span>}
          </Link>
        ))}
      </nav>
      {tab === "overview" && (
        <>
          <div className="evidence-note">
            Evidence stays separate: a geometry report or render does not prove
            package, slicer, or physical-print success.
          </div>
          <section className="panel">
            <div className="section-heading">
              <h2>Product specifications</h2>
              <span className="mono small">product.yaml</span>
            </div>
            <DataView data={product.manifest} />
          </section>
          {!!product.blockers.length && (
            <section className="panel metadata-panel">
              <div className="section-heading">
                <h2>Before this product advances</h2>
                <Badge tone="amber">{product.blockers.length} blockers</Badge>
              </div>
              <ul className="blocker-list">
                {product.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {tab === "images" && <Gallery assets={product.assets} />}
      {tab === "assets" && <AssetBrowser product={product} baseUrl={baseUrl} />}
      {tab === "workflow" && (
        <section className="panel">
          <div className="section-heading">
            <h2>Workflow & recorded evidence</h2>
            <Badge>Physical print: {product.physical}</Badge>
          </div>
          <DataView data={product.workflow} />
        </section>
      )}
      {tab === "findings" && (
        <section className="panel">
          <div className="section-heading">
            <h2>Inventory findings</h2>
            <Badge tone="amber">{product.findings.length}</Badge>
          </div>
          <Findings findings={product.findings} products={catalog.products} />
        </section>
      )}
      {tab === "models" && (
        <ModelBrowser
          assets={product.assets}
          groups={product.groups}
          previews={product.groupPreviews}
          baseUrl={baseUrl}
          issues={product.findings
            .filter(
              (finding) =>
                finding.path.endsWith("/groups.yaml") ||
                /group/i.test(finding.message),
            )
            .map((finding) => finding.message)}
        />
      )}
      {tab === "documents" && (
        <div className="document-layout">
          <aside className="document-list">
            <div className="eyebrow">PRODUCT DOCUMENTS</div>
            {available.map((name) => (
              <Link
                className={selected === name ? "selected" : ""}
                key={name}
                href={`${baseUrl}?tab=${tab}&file=${encodeURIComponent(name)}`}
              >
                <FileJson2 size={15} />
                <span>{name}</span>
              </Link>
            ))}
          </aside>
          <section className="panel document-panel">
            <div className="section-heading">
              <h2 className="document-title">{selected}</h2>
              <a
                href={assetUrl(`${product.path}/${selected}`, true)}
                className="icon-button"
                aria-label={selectedStl ? "Download STL" : "Download document"}
              >
                <Download size={17} />
              </a>
            </div>
            {documentError ? (
              <div className="inline-error" role="alert">
                {documentError}
              </div>
            ) : selectedStl ? (
              <StlViewer
                key={`${selectedAsset.path}:${selectedAsset.modified}`}
                asset={selectedAsset}
              />
            ) : selectedImage ? (
              <Gallery assets={[selectedAsset]} />
            ) : (
              document &&
              (document.data === null ? (
                <pre className="code">{document.content}</pre>
              ) : (
                <DataView data={document.data} raw={document.content} />
              ))
            )}
          </section>
        </div>
      )}
    </>
  );
}
