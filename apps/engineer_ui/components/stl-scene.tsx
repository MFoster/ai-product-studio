"use client";

import { Canvas, useThree } from "@react-three/fiber";
import {
  Bounds,
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  useBounds,
} from "@react-three/drei";
import { useCallback, useEffect, useState } from "react";
import { Box, Grid2X2, LoaderCircle, RotateCcw, ScanLine } from "lucide-react";
import { DoubleSide } from "three";
import { MAX_STL_BYTES, parseStl, type StlModel } from "@/lib/stl-geometry";
import { assetUrl, formatBytes, type Asset } from "@/lib/types";

function FitModel({ revision }: { revision: number }) {
  const bounds = useBounds();
  useEffect(() => {
    bounds.refresh().clip().fit();
  }, [bounds, revision]);
  return null;
}

function ContextMonitor({
  onLost,
  onReady,
}: {
  onLost: () => void;
  onReady: (ready: boolean) => void;
}) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    function lost(event: Event) {
      event.preventDefault();
      onLost();
    }
    canvas.addEventListener("webglcontextlost", lost);
    onReady(true);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [canvas, onLost, onReady]);
  return null;
}

function ViewerProblem({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="stl-placeholder" role="alert">
      <Box size={28} />
      <strong>STL preview unavailable</strong>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>
        Retry preview
      </button>
    </div>
  );
}

export default function StlScene({
  asset,
  onRetry,
  color,
}: {
  asset: Asset;
  onRetry: () => void;
  color?: string;
}) {
  const [model, setModel] = useState<StlModel | null>(null);
  const [error, setError] = useState("");
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(true);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const handleContextLost = useCallback(
    () =>
      setError(
        "The browser lost its WebGL context. Close other 3D tabs and retry, or download the file to inspect locally.",
      ),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    let loaded: StlModel | undefined;
    async function load() {
      try {
        if (asset.size > MAX_STL_BYTES)
          throw new Error(
            "STL previews are limited to 64 MB. Download this file to inspect it locally.",
          );
        const response = await fetch(assetUrl(asset.path), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            `Could not load this STL (HTTP ${response.status}). The file may have moved or become inaccessible.`,
          );
        if (Number(response.headers.get("content-length")) > MAX_STL_BYTES) {
          await response.body?.cancel();
          throw new Error(
            "This STL exceeds the 64 MB browser preview limit. Download it to inspect locally.",
          );
        }
        const buffer = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        loaded = parseStl(buffer);
        setModel(loaded);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "The STL could not be loaded.",
          );
      }
    }
    void load();
    return () => {
      controller.abort();
      loaded?.geometry.dispose();
    };
  }, [asset.path, asset.size]);

  if (error) return <ViewerProblem message={error} onRetry={onRetry} />;
  if (!model)
    return (
      <div className="stl-placeholder" role="status">
        <LoaderCircle className="spin" size={24} />
        <span>Loading STL geometry...</span>
      </div>
    );

  const span = Math.max(...model.dimensions);
  const cellSize = 10 ** (Math.floor(Math.log10(span)) - 1);
  return (
    <>
      <div
        className="stl-toolbar"
        role="toolbar"
        aria-label="STL viewer controls"
      >
        <span>
          <Box size={15} />
          STL preview
        </span>
        <div>
          <button
            aria-pressed={wireframe}
            onClick={() => setWireframe((value) => !value)}
          >
            <ScanLine size={14} />
            Wireframe
          </button>
          <button
            aria-pressed={grid}
            onClick={() => setGrid((value) => !value)}
          >
            <Grid2X2 size={14} />
            Grid
          </button>
          <button onClick={() => setRevision((value) => value + 1)}>
            <RotateCcw size={14} />
            Fit model
          </button>
        </div>
      </div>
      <div
        className="stl-viewport"
        data-ready={ready}
        aria-label={`Interactive STL preview of ${asset.name}`}
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          onCreated={({ gl }) => {
            gl.domElement.tabIndex = 0;
            gl.domElement.setAttribute(
              "aria-label",
              "STL model canvas. Drag to orbit, scroll to zoom, or use arrow keys to pan.",
            );
          }}
          camera={{
            position: [span * 1.4, -span * 1.8, span * 1.3],
            up: [0, 0, 1],
            fov: 40,
          }}
          fallback={
            <p>
              Canvas is unavailable. Download this STL for local inspection.
            </p>
          }
        >
          <color attach="background" args={["#edf1ec"]} />
          <ambientLight intensity={0.85} />
          <directionalLight
            position={[span, -span, span * 2]}
            intensity={2.2}
          />
          <directionalLight position={[-span, span, span]} intensity={1.1} />
          <Bounds observe margin={1.3}>
            <mesh>
              <primitive object={model.geometry} attach="geometry" />
              <meshStandardMaterial
                color={color || "#aebda8"}
                roughness={0.52}
                metalness={0.12}
                side={DoubleSide}
                wireframe={wireframe}
              />
            </mesh>
            <FitModel revision={revision} />
          </Bounds>
          {grid && (
            <Grid
              args={[span * 3, span * 3]}
              rotation={[Math.PI / 2, 0, 0]}
              position={[0, 0, -model.dimensions[2] / 2 - span * 0.002]}
              cellSize={cellSize}
              sectionSize={cellSize * 5}
              cellColor="#becabc"
              sectionColor="#a1b29d"
              fadeDistance={span * 4}
            />
          )}
          <OrbitControls makeDefault enableDamping keyEvents />
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport
              axisColors={["#b67d69", "#83a080", "#819cac"]}
              labelColor="#ffffff"
            />
          </GizmoHelper>
          <ContextMonitor onLost={handleContextLost} onReady={setReady} />
        </Canvas>
      </div>
      <div className="stl-stats" aria-label="STL mesh statistics">
        <span>
          <strong>{model.triangles.toLocaleString()}</strong> triangles
        </span>
        <span>
          {model.dimensions
            .map(
              (value, index) =>
                `${["X", "Y", "Z"][index]} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
            )
            .join(" × ")}{" "}
          <strong>mm (assumed)</strong>
        </span>
        <span>{formatBytes(asset.size)}</span>
      </div>
      <p className="stl-help">
        Drag to orbit · Scroll or pinch to zoom · Right-drag or two-finger drag
        to pan · Arrow keys pan when focused · Click an axis to change view
      </p>
    </>
  );
}
