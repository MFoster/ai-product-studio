"use client";

import dynamic from "next/dynamic";
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Box, LoaderCircle } from "lucide-react";
import type { Asset } from "@/lib/types";

const StlScene = dynamic(() => import("./stl-scene"), {
  ssr: false,
  loading: () => (
    <div className="stl-placeholder" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>Loading 3D viewer...</span>
    </div>
  ),
});

class ViewerBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "The 3D renderer could not be started." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("STL viewer failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="stl-placeholder" role="alert">
          <Box size={28} />
          <strong>STL preview unavailable</strong>
          <p>{this.state.error}</p>
          <p>
            Enable WebGL 2 in your browser, or download the file for local
            inspection.
          </p>
          <button className="primary-button" onClick={this.props.onRetry}>
            Retry preview
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function StlViewer({ asset, color }: { asset: Asset; color?: string }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="stl-viewer">
      <ViewerBoundary
        key={`${asset.path}:${asset.modified}:${attempt}`}
        onRetry={() => setAttempt((value) => value + 1)}
      >
        <StlScene
          asset={asset}
          color={color}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </ViewerBoundary>
      <p className="stl-evidence-note">
        Visual inspection only. STL files are unitless; displayed dimensions
        assume millimeters. This preview does not validate manifoldness,
        printability, slicing, or physical performance.
      </p>
    </div>
  );
}
