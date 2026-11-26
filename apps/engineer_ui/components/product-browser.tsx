"use client";

import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { ProductCard } from "./ui";
import type { Product } from "@/lib/types";

export function ProductBrowser({
  products,
  lines,
}: {
  products: Product[];
  lines: { slug: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [line, setLine] = useState("");
  const [stage, setStage] = useState("");
  const [variant, setVariant] = useState("");
  const filtered = products.filter(
    (product) =>
      (!line || product.line === line) &&
      (!stage || product.stage === stage) &&
      (!variant || product.variant === variant) &&
      `${product.name} ${product.summary} ${product.line} ${product.variant}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="browser-toolbar">
        <label className="search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products..."
            aria-label="Search products"
          />
          <kbd>⌕</kbd>
        </label>
        <div className="filters">
          <SlidersHorizontal size={16} />
          {lines.length > 1 && (
            <select
              aria-label="Filter by product line"
              value={line}
              onChange={(event) => setLine(event.target.value)}
            >
              <option value="">All product lines</option>
              {lines.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Filter by variant"
            value={variant}
            onChange={(event) => setVariant(event.target.value)}
          >
            <option value="">All variants</option>
            {[...new Set(products.map((product) => product.variant))].map(
              (item) => (
                <option key={item}>{item}</option>
              ),
            )}
          </select>
          <select
            aria-label="Filter by stage"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            <option value="">All stages</option>
            {[...new Set(products.map((product) => product.stage))].map(
              (item) => (
                <option key={item}>{item}</option>
              ),
            )}
          </select>
        </div>
      </div>
      <div className="results-caption">
        {filtered.length} {filtered.length === 1 ? "product" : "products"}
        <span>Most recently updated first</span>
      </div>
      {filtered.length ? (
        <div className="product-grid">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              lineName={lines.find((item) => item.slug === product.line)?.name}
            />
          ))}
        </div>
      ) : (
        <div className="empty">No products match these filters.</div>
      )}
    </>
  );
}
