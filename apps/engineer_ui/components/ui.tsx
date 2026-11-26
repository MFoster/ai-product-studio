import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Box,
  FileJson2,
  Image as ImageIcon,
} from "lucide-react";
import { assetUrl, productUrl, type Finding, type Product } from "@/lib/types";
import { productImages } from "@/lib/catalog-images";

export function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stage({ stage }: { stage: string }) {
  return (
    <Badge
      tone={
        stage === "release" ? "green" : stage === "unknown" ? "red" : "neutral"
      }
    >
      <span className="tiny-dot" />
      {stage.replaceAll("-", " ")}
    </Badge>
  );
}

export function ProductCard({
  product,
  lineName,
}: {
  product: Product;
  lineName?: string;
}) {
  const { images: previews, cover, hero } = productImages(product.assets);
  return (
    <Link className="product-card" href={productUrl(product)}>
      <div className="product-cover">
        {cover ? (
          // Local assets are streamed, not copied into Next.js image caches.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={hero ? "catalog-cover" : undefined}
            src={assetUrl(cover.path)}
            alt={
              hero ? `${product.name} - catalog studio render` : product.name
            }
            loading="lazy"
          />
        ) : (
          <div className="no-preview">
            <Box size={46} strokeWidth={1} />
            <span>No preview yet</span>
          </div>
        )}
        <span className="cover-tag">
          {product.variant.replaceAll("-", " ")}
        </span>
        <span className="card-open">
          <ArrowUpRight size={17} />
        </span>
        {hero && <span className="photo-tag">Catalog render</span>}
      </div>
      <div className="product-card-body">
        <div className="eyebrow">
          {lineName || product.line.replaceAll("-", " ")}
        </div>
        <h3>{product.name}</h3>
        <p>{product.summary || "A new product taking shape in the studio."}</p>
        <div className="card-meta">
          <Stage stage={product.stage} />
          <span>
            <ImageIcon size={13} />
            {previews.length}
            <FileJson2 size={13} />
            {product.assets.filter((asset) => asset.format === "json").length}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function Findings({
  findings,
  products,
  limit,
}: {
  findings: Finding[];
  products: Product[];
  limit?: number;
}) {
  const shown = limit ? findings.slice(0, limit) : findings;
  return (
    <div className="finding-list">
      {shown.length ? (
        shown.map((finding, index) => {
          const product = products.find(
            (item) => item.id === finding.productId,
          );
          return (
            <div className="finding" key={`${finding.path}-${index}`}>
              <span className={`finding-icon ${finding.severity}`}>
                <AlertTriangle size={17} />
              </span>
              <div>
                <strong>{finding.message}</strong>
                <small>{finding.path}</small>
                {product && (
                  <Link href={productUrl(product)}>
                    {product.name} <ArrowUpRight size={12} />
                  </Link>
                )}
              </div>
              <Badge tone={finding.severity === "error" ? "red" : "amber"}>
                {finding.severity}
              </Badge>
            </div>
          );
        })
      ) : (
        <div className="empty compact">
          No file or registry mismatches detected.
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
