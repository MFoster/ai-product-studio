"use client";

import { useCallback, useState } from "react";
import { ImageIcon, RefreshCw } from "lucide-react";
import { assetUrl, type GroupPreview, type ModelGroup } from "@/lib/types";

export function GroupOverview({
  group,
  preview,
}: {
  group: ModelGroup;
  preview?: GroupPreview;
}) {
  const [failed, setFailed] = useState(false);
  const checkImage = useCallback((image: HTMLImageElement | null) => {
    // An SSR image can fail before React attaches its error listener.
    if (image?.complete && !image.naturalWidth) setFailed(true);
  }, []);
  return (
    <section
      className="group-overview"
      aria-label="Complete model preview"
      data-group={group.id}
    >
      <div className="section-heading">
        <h2>
          <ImageIcon size={17} />
          Complete model
        </h2>
        {preview && (
          <a
            className="text-link"
            href={assetUrl(preview.image.path)}
            target="_blank"
            rel="noreferrer"
          >
            Open full-size image
          </a>
        )}
      </div>
      {!preview ? (
        <div className="stl-placeholder" role="status">
          <ImageIcon size={28} />
          <p>
            No current assembled image is available for this group. Expand a
            physical part on the left to inspect its individual meshes.
          </p>
        </div>
      ) : failed ? (
        <div className="stl-placeholder" role="alert">
          <p>
            The assembled image could not be loaded. Individual parts and the
            group package remain available.
          </p>
          <button className="primary-button" onClick={() => setFailed(false)}>
            <RefreshCw size={14} />
            Retry image
          </button>
        </div>
      ) : (
        <a
          className="group-overview-image"
          href={assetUrl(preview.image.path)}
          target="_blank"
          rel="noreferrer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={checkImage}
            src={assetUrl(preview.image.path)}
            alt={`Fully assembled ${group.name}`}
            width={preview.width}
            height={preview.height}
            onError={() => setFailed(true)}
          />
        </a>
      )}
      {preview && (
        <p className="stl-evidence-note">
          Saved deployed assembly rendered from the authored Blender scene.
          Select a part to inspect its STL. This is not a photograph of a print
          or evidence of slicing or physical qualification.
        </p>
      )}
    </section>
  );
}
