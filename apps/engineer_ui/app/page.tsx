import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  CircleAlert,
  Camera,
  Layers3,
  ScanLine,
} from "lucide-react";
import { PageHeader, Findings, Badge } from "@/components/ui";
import { ProductBrowser } from "@/components/product-browser";
import { getCatalog } from "@/lib/server";
import { formatBytes } from "@/lib/types";
import { productImages } from "@/lib/catalog-images";

export default async function HomePage() {
  const catalog = await getCatalog();
  const assets = catalog.products
    .flatMap((product) => product.assets)
    .filter((asset) => !asset.missing);
  const blocked = catalog.products.filter(
    (product) => product.blockers.length,
  ).length;
  const photographed = catalog.products.filter(
    (product) => productImages(product.assets).hero,
  ).length;
  const metrics = [
    {
      label: "Total products",
      value: catalog.products.length,
      note: `${catalog.lines.length} collections in your studio`,
      icon: Box,
    },
    {
      label: "Product lines",
      value: catalog.lines.length,
      note: "Distinct ideas, one workspace",
      icon: Layers3,
    },
    {
      label: "Catalog assets",
      value: assets.length.toLocaleString(),
      note: `${formatBytes(assets.reduce((sum, asset) => sum + asset.size, 0))} of sources, renders & evidence`,
      icon: ArrowDownToLine,
    },
    {
      label: "Needs attention",
      value: catalog.findings.length,
      note: `${blocked} products also have workflow blockers`,
      icon: CircleAlert,
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="YOUR STUDIO, AT A GLANCE"
        title="Studio overview"
        description="Every idea, iteration, and detail. All in one place."
      >
        <span className="scan-stamp">
          <ScanLine size={15} /> Live filesystem snapshot
        </span>
      </PageHeader>
      <section className="metrics" aria-label="Studio statistics">
        {metrics.map(({ label, value, note, icon: Icon }, index) => (
          <div
            className={`metric ${index === 3 ? "attention-metric" : ""}`}
            key={label}
          >
            <div>
              {label}
              <Icon size={18} />
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </section>
      <section className="studio-note">
        <span className="note-symbol">✦</span>
        <div>
          <strong>From a first idea to a physical product.</strong>
          <p>
            Explore your catalog, review the evidence, and see what needs a
            closer look.
          </p>
        </div>
        <Badge tone="green">
          <span className="tiny-dot" />
          {catalog.lines.length} product lines connected
        </Badge>
      </section>
      <section className="photography-status" aria-label="Catalog photography">
        <Camera size={17} />
        <span>
          <strong>
            {photographed} of {catalog.products.length}
          </strong>{" "}
          products have catalog studio renders
        </span>
        <Link href="/attention#photography">
          {photographed < catalog.products.length
            ? `${catalog.products.length - photographed} awaiting photography`
            : "View coverage"}{" "}
          <ArrowRight size={13} />
        </Link>
      </section>
      {!!catalog.findings.length && (
        <section className="panel attention-panel">
          <div className="section-heading">
            <h2>
              <CircleAlert size={18} /> A closer look{" "}
              <Badge tone="amber">{catalog.findings.length}</Badge>
            </h2>
            <Link href="/attention">
              Review all <ArrowRight size={15} />
            </Link>
          </div>
          <Findings
            findings={[...catalog.findings].sort(
              (a, b) =>
                Number(b.severity === "error") - Number(a.severity === "error"),
            )}
            products={catalog.products}
            limit={3}
          />
          <div className="panel-footnote">
            File presence and size checked. SHA-256 verification is available
            per asset.
          </div>
        </section>
      )}
      <section className="catalog-section">
        <div className="section-heading">
          <div>
            <h2>
              Recent products{" "}
              <span className="subtle-count">{catalog.products.length}</span>
            </h2>
            <p>The latest work across your product lines.</p>
          </div>
          <span className="muted small">
            Live catalog · not a release approval
          </span>
        </div>
        <ProductBrowser
          products={catalog.products}
          lines={catalog.lines.map(({ slug, name }) => ({ slug, name }))}
        />
      </section>
    </>
  );
}
