import { notFound } from "next/navigation";
import { ProductBrowser } from "@/components/product-browser";
import { DataView } from "@/components/data-view";
import { PageHeader, Badge } from "@/components/ui";
import { getCatalog } from "@/lib/server";

export default async function LinePage({
  params,
}: {
  params: Promise<{ line: string }>;
}) {
  const { line: slug } = await params;
  const catalog = await getCatalog();
  const line = catalog.lines.find((item) => item.slug === slug);
  if (!line) notFound();
  const products = catalog.products.filter((product) => product.line === slug);
  return (
    <>
      <PageHeader
        eyebrow="PRODUCT LINE"
        title={line.name}
        description={
          line.description ||
          "Explore products, variants, and the details behind the collection."
        }
      >
        <Badge>
          {products.length} products · {line.variants.length} variants
        </Badge>
      </PageHeader>
      <ProductBrowser
        products={products}
        lines={[{ slug: line.slug, name: line.name }]}
      />
      <section className="panel metadata-panel">
        <div className="section-heading">
          <h2>Collection details</h2>
          <span className="mono small">product-line.yaml</span>
        </div>
        <DataView data={line.manifest} />
      </section>
      <section className="variant-grid">
        {line.variants.map((variant) => (
          <details className="panel" key={variant.slug}>
            <summary className="variant-summary">
              {variant.name}
              <span className="muted small">Variant manifest</span>
            </summary>
            <DataView data={variant.manifest} />
          </details>
        ))}
      </section>
    </>
  );
}
