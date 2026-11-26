"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Box,
  Check,
  Download,
  File,
  FileJson2,
  Image as ImageIcon,
  LoaderCircle,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  assetUrl,
  formatBytes,
  imageAsset,
  type Asset,
  type Product,
} from "@/lib/types";
import { Badge } from "./ui";
import { catalogPhoto, productImages } from "@/lib/catalog-images";

function ImagePreview({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label="Image preview"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lightbox-inner">
        <div>
          <span>{asset.name}</span>
          <a href={assetUrl(asset.path, true)} aria-label="Download image">
            <Download size={19} />
          </a>
          <button ref={closeRef} onClick={onClose} aria-label="Close image">
            <X size={21} />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(asset.path)} alt={asset.name} />
      </div>
    </dialog>
  );
}

export function Gallery({ assets }: { assets: Asset[] }) {
  const [selected, setSelected] = useState<Asset | null>(null);
  const { images } = productImages(assets);
  return (
    <>
      {images.length ? (
        <div className="gallery">
          {images.map((asset) => (
            <button
              className="gallery-item"
              key={asset.path}
              onClick={() => setSelected(asset)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(asset.path)} alt={asset.name} loading="lazy" />
              <span>
                {catalogPhoto(asset) && (
                  <strong className="gallery-photo-label">
                    Catalog {catalogPhoto(asset)?.view}
                  </strong>
                )}
                {asset.name.split("/").pop()}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <ImageIcon size={28} />
          <p>No review images yet.</p>
        </div>
      )}
      {selected && (
        <ImagePreview asset={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function VerifyButton({ asset }: { asset: Asset }) {
  const [state, setState] = useState<
    "idle" | "loading" | "match" | "mismatch" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  async function verify() {
    setState("loading");
    try {
      const response = await fetch(
        `/api/verify?path=${encodeURIComponent(asset.path)}`,
        { cache: "no-store" },
      );
      const result: { matches?: boolean; actual?: string; error?: string } =
        await response.json();
      if (!response.ok) throw new Error(result.error || "Verification failed.");
      setState(result.matches ? "match" : "mismatch");
      setMessage(
        result.matches
          ? `SHA-256 matches: ${result.actual}`
          : `SHA-256 mismatch. Actual: ${result.actual}`,
      );
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Verification failed.",
      );
    }
  }
  return (
    <div className="verify-result">
      <button
        className={`verify-button ${state}`}
        disabled={state === "loading" || asset.missing}
        onClick={verify}
        title={
          message || "Stream this file and compare its SHA-256 with assets.yaml"
        }
      >
        {state === "loading" ? (
          <LoaderCircle className="spin" size={13} />
        ) : state === "match" ? (
          <Check size={13} />
        ) : (
          <ShieldCheck size={13} />
        )}
        {state === "idle"
          ? "Verify hash"
          : state === "loading"
            ? "Hashing…"
            : state === "match"
              ? "Hash matches"
              : state === "mismatch"
                ? "Hash mismatch"
                : "Retry check"}
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}

export function AssetBrowser({
  product,
  baseUrl,
}: {
  product: Product;
  baseUrl: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const assets = product.assets.filter(
    (asset) =>
      asset.name.toLowerCase().includes(query.toLowerCase()) &&
      (!kind || asset.kind === kind),
  );
  return (
    <>
      <div className="browser-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an asset..."
            aria-label="Find an asset"
          />
        </label>
        <select
          aria-label="Filter asset kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">All asset kinds</option>
          {[...new Set(product.assets.map((asset) => asset.kind))]
            .sort()
            .map((item) => (
              <option key={item}>{item}</option>
            ))}
        </select>
      </div>
      <p className="small muted">
        File presence and size checked. Hashes are only verified when requested.
        STL files have interactive previews. 3MF and Blender files download for
        local inspection.
      </p>
      <div className="table-scroll">
        <table className="asset-table">
          <thead>
            <tr>
              <th>Asset / path</th>
              <th>Kind</th>
              <th>Size</th>
              <th>Inventory status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const Icon = imageAsset(asset)
                ? ImageIcon
                : ["json", "yaml", "yml"].includes(asset.format)
                  ? FileJson2
                  : ["blend", "stl", "3mf"].includes(asset.format)
                    ? Box
                    : File;
              const inspectable =
                [
                  "json",
                  "yaml",
                  "yml",
                  "md",
                  "txt",
                  "csv",
                  "log",
                  "py",
                  "stl",
                ].includes(asset.format) || imageAsset(asset);
              return (
                <tr key={asset.path}>
                  <td>
                    <div className="asset-name">
                      <Icon size={18} />
                      <div>
                        {!asset.missing && inspectable ? (
                          <Link
                            href={`${baseUrl}?tab=${asset.format === "stl" ? "models" : "documents"}&file=${encodeURIComponent(asset.name)}`}
                          >
                            {asset.name.split("/").pop()}
                          </Link>
                        ) : (
                          <strong>{asset.name.split("/").pop()}</strong>
                        )}
                        <small>{asset.name}</small>
                        {asset.expectedHash && (
                          <details className="hash-details">
                            <summary>Recorded SHA-256</summary>
                            <code>{asset.expectedHash}</code>
                          </details>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge>{asset.kind}</Badge>
                  </td>
                  <td className="nowrap">
                    {asset.missing ? "—" : formatBytes(asset.size)}
                  </td>
                  <td>
                    <Badge
                      tone={
                        asset.missing ||
                        asset.sizeMismatch ||
                        (asset.tracked && !asset.inventoryValid)
                          ? "red"
                          : asset.tracked
                            ? "neutral"
                            : "amber"
                      }
                    >
                      {asset.missing
                        ? "Missing"
                        : asset.sizeMismatch
                          ? "Size mismatch"
                          : asset.tracked
                            ? asset.inventoryValid
                              ? "Recorded size matches"
                              : "Invalid inventory metadata"
                            : asset.name.split("/").includes("release")
                              ? "Release file"
                              : "Not inventoried"}
                    </Badge>
                    {asset.expectedHash && <VerifyButton asset={asset} />}
                  </td>
                  <td>
                    <div className="asset-actions">
                      {!asset.missing && asset.format === "stl" && (
                        <Link
                          className="icon-button"
                          href={`${baseUrl}?tab=models&file=${encodeURIComponent(asset.name)}`}
                          aria-label={`Preview ${asset.name}`}
                          title="View STL model"
                        >
                          <Box size={17} />
                        </Link>
                      )}
                      {!asset.missing && (
                        <a
                          className="icon-button"
                          href={assetUrl(asset.path, true)}
                          aria-label={`Download ${asset.name}`}
                        >
                          <Download size={17} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!assets.length && (
          <div className="empty">No assets match these filters.</div>
        )}
      </div>
    </>
  );
}
