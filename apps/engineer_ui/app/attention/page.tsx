import Link from "next/link";
import { Findings, PageHeader, Badge } from "@/components/ui";
import { getCatalog } from "@/lib/server";
import { productUrl } from "@/lib/types";
import { productImages } from "@/lib/catalog-images";

export default async function AttentionPage() {
  const catalog = await getCatalog();
  const blocked = catalog.products.filter((product) => product.blockers.length);
  const missingPhotos = catalog.products.filter(
    (product) => !productImages(product.assets).hero,
  );
  return (
    <>
      <PageHeader
        eyebrow="CATALOG HEALTH"
        title="Needs attention"
        description="File mismatches and workflow blockers, without confusing either with print validation."
      />
      <section className="panel">
        <div className="section-heading">
          <h2>
            Inventory & registry findings{" "}
            <Badge tone="amber">{catalog.findings.length}</Badge>
          </h2>
        </div>
        <p className="panel-description">
          Presence and recorded size are checked against assets.yaml. Matching
          size is not a checksum pass. Hidden files are not browsable. Use the
          existing aps CLI to update inventories.
        </p>
        <Findings
          findings={[...catalog.findings].sort(
            (a, b) =>
              Number(b.severity === "error") - Number(a.severity === "error"),
          )}
          products={catalog.products}
        />
      </section>
      <section id="photography" className="panel metadata-panel">
        <div className="section-heading">
          <h2>
            Catalog photography{" "}
            <Badge tone={missingPhotos.length ? "amber" : "green"}>
              {missingPhotos.length} awaiting renders
            </Badge>
          </h2>
        </div>
        <p className="panel-description">
          Catalog hero renders appear on product cards, with rear and detail
          views first in the image gallery. Existing reference images are not
          treated as fresh product photography. Missing or unsuitable Blender
          sources must be resolved before those products can be photographed
          faithfully.
        </p>
        {missingPhotos.length ? (
          missingPhotos.map((product) => (
            <div className="photography-missing" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <small>
                  {product.line} / {product.variant}
                </small>
              </div>
              <Link
                className="text-link"
                href={`${productUrl(product)}?tab=images`}
              >
                Review product images →
              </Link>
            </div>
          ))
        ) : (
          <div className="empty compact">
            Every product has a catalog hero render. Renders are visual
            evidence, not print validation.
          </div>
        )}
      </section>
      <section className="panel metadata-panel">
        <div className="section-heading">
          <h2>
            Workflow blockers <Badge>{blocked.length} products</Badge>
          </h2>
        </div>
        {blocked.map((product) => (
          <details className="blocker-group" key={product.id}>
            <summary>
              {product.name}
              <Badge tone="amber">{product.blockers.length} blockers</Badge>
            </summary>
            <Link className="text-link" href={productUrl(product)}>
              Open product →
            </Link>
            <ul>
              {product.blockers.map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </>
  );
}
