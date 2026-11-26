"use client";

import { useState } from "react";
import { Braces, ListTree } from "lucide-react";
import { isRecord, type Json } from "@/lib/types";

function label(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function Value({ data, depth = 0 }: { data: Json; depth?: number }) {
  if (data === null) return <span className="muted">Not set</span>;
  if (typeof data === "boolean")
    return (
      <span className={`boolean ${data ? "yes" : ""}`}>
        {data ? "Yes" : "No"}
      </span>
    );
  if (typeof data !== "object")
    return (
      <span
        className={`data-scalar ${typeof data === "number" ? "number" : ""}`}
      >
        {String(data)}
      </span>
    );
  const entries = Array.isArray(data)
    ? data.map((value, index) => [String(index + 1), value] as const)
    : Object.entries(data);
  if (!entries.length) return <span className="muted">None recorded</span>;
  if (
    Array.isArray(data) &&
    data.every((item) => item === null || typeof item !== "object")
  ) {
    return (
      <ul className="data-list">
        {data.map((item, index) => (
          <li key={index}>
            <Value data={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="data-fields">
      {entries.map(([key, value]) => {
        const complex = value !== null && typeof value === "object";
        return complex ? (
          <details className="data-group" key={key} open={depth < 1}>
            <summary>
              {label(key)}{" "}
              <span>
                {Array.isArray(value)
                  ? `${value.length} items`
                  : `${Object.keys(value).length} fields`}
              </span>
            </summary>
            <Value data={value} depth={depth + 1} />
          </details>
        ) : (
          <div className="data-row" key={key}>
            <dt>{label(key)}</dt>
            <dd>
              <Value data={value} depth={depth + 1} />
            </dd>
          </div>
        );
      })}
    </div>
  );
}

export function DataView({ data, raw }: { data: Json; raw?: string }) {
  const [mode, setMode] = useState<"structured" | "raw">("structured");
  return (
    <div className="data-view">
      <div className="data-toolbar">
        <span>
          {isRecord(data)
            ? `${Object.keys(data).length} top-level fields`
            : "Document"}
        </span>
        <div className="segmented">
          <button
            className={mode === "structured" ? "selected" : ""}
            onClick={() => setMode("structured")}
          >
            <ListTree size={14} />
            Readable
          </button>
          <button
            className={mode === "raw" ? "selected" : ""}
            onClick={() => setMode("raw")}
          >
            <Braces size={14} />
            Source
          </button>
        </div>
      </div>
      {mode === "raw" ? (
        <pre className="code">{raw ?? JSON.stringify(data, null, 2)}</pre>
      ) : (
        <Value data={data} />
      )}
    </div>
  );
}
