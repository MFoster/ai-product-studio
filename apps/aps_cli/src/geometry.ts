import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveGroupAsset } from "./groups.js";
import type { AssetGroup, Printer } from "./manifests.js";

type Vector = [number, number, number];
type MeshSpec = AssetGroup["parts"][number]["meshes"][number];
type PartSpec = AssetGroup["parts"][number];

export interface Mesh {
  source: MeshSpec;
  vertices: Vector[];
  triangles: Vector[];
}

export interface Part {
  spec: PartSpec;
  meshes: Mesh[];
  lower: Vector;
  size: Vector;
}

export interface Instance {
  part: Part;
  copy: number;
  x: number;
  y: number;
}

export function readMesh(productDir: string, source: MeshSpec): Mesh {
  const data = readFileSync(resolveGroupAsset(productDir, source.asset));
  if (createHash("sha256").update(data).digest("hex") !== source.sha256)
    throw new Error(`Mesh checksum mismatch: ${source.asset}`);
  if (data.length < 84)
    throw new Error(`Expected a binary millimeter STL: ${source.asset}`);
  const count = data.readUInt32LE(80);
  if (!count || data.length !== 84 + 50 * count)
    throw new Error(`Invalid binary STL triangle count: ${source.asset}`);
  const vertices: Vector[] = [];
  const triangles: Vector[] = [];
  const indices = new Map<string, number>();
  const edges = new Map<string, { count: number; winding: number }>();
  let volume = 0;
  for (let offset = 84; offset < data.length; offset += 50) {
    const coordinates = [12, 24, 36].map((start): Vector => [
      data.readFloatLE(offset + start),
      data.readFloatLE(offset + start + 4),
      data.readFloatLE(offset + start + 8),
    ]);
    if (
      coordinates.some((vertex) =>
        vertex.some((value) => !Number.isFinite(value)),
      )
    )
      throw new Error(`Non-finite STL geometry: ${source.asset}`);
    const [a, b, c] = coordinates;
    const u = b.map((value, i) => value - a[i]);
    const v = c.map((value, i) => value - a[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (normal.reduce((sum, value) => sum + value * value, 0) <= 1e-20)
      throw new Error(`Degenerate STL triangle: ${source.asset}`);
    const triangle = coordinates.map((coordinate) => {
      const key = JSON.stringify(coordinate);
      let index = indices.get(key);
      if (index === undefined) {
        index = vertices.length;
        indices.set(key, index);
        vertices.push(coordinate);
      }
      return index;
    }) as Vector;
    triangles.push(triangle);
    for (const [first, second] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ]) {
      const key = `${Math.min(first, second)},${Math.max(first, second)}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++;
      edge.winding += first < second ? 1 : -1;
      edges.set(key, edge);
    }
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  if (
    [...edges.values()].some(
      (edge) => edge.count !== 2 || edge.winding !== 0,
    ) ||
    volume <= 0
  )
    throw new Error(
      `STL must be closed with outward consistent winding: ${source.asset}`,
    );
  return { source, vertices, triangles };
}

export function readParts(productDir: string, group: AssetGroup): Part[] {
  return group.parts.map((spec) => {
    const meshes = spec.meshes.map((mesh) => readMesh(productDir, mesh));
    const lower: Vector = [Infinity, Infinity, Infinity];
    const upper: Vector = [-Infinity, -Infinity, -Infinity];
    for (const mesh of meshes)
      for (const vertex of mesh.vertices)
        for (let axis = 0; axis < 3; axis++) {
          lower[axis] = Math.min(lower[axis], vertex[axis]);
          upper[axis] = Math.max(upper[axis], vertex[axis]);
        }
    return {
      spec,
      meshes,
      lower,
      size: [upper[0] - lower[0], upper[1] - lower[1], upper[2] - lower[2]],
    };
  });
}

export function planPlates(
  group: AssetGroup,
  parts: Part[],
  printer: Printer,
): Instance[][] {
  const { x: width, y: depth, z: height } = printer.build_volume_mm;
  const { margin_mm: margin, spacing_mm: gap } = group.layout;
  const plates: Instance[][] = [];
  const shelves: { x: number; y: number; height: number }[][] = [];
  const sorted = [...parts].sort(
    (a, b) =>
      b.size[1] - a.size[1] ||
      b.size[0] - a.size[0] ||
      (a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0),
  );
  for (const part of sorted) {
    if (
      part.size[0] > width - 2 * margin ||
      part.size[1] > depth - 2 * margin ||
      part.size[2] > height
    )
      throw new Error(
        `Group ${group.id}/${part.spec.id} cannot fit the configured print volume`,
      );
    for (let copy = 1; copy <= part.spec.quantity; copy++) {
      let placed = false;
      for (let plateIndex = 0; plateIndex < shelves.length; plateIndex++) {
        const rows = shelves[plateIndex];
        let row = rows.find(
          (item) =>
            part.size[1] <= item.height &&
            item.x + part.size[0] <= width - margin,
        );
        if (!row) {
          const last = rows[rows.length - 1];
          const y = last.y + last.height + gap;
          if (y + part.size[1] <= depth - margin) {
            row = { x: margin, y, height: part.size[1] };
            rows.push(row);
          }
        }
        if (row) {
          plates[plateIndex].push({ part, copy, x: row.x, y: row.y });
          row.x += part.size[0] + gap;
          placed = true;
          break;
        }
      }
      if (!placed) {
        shelves.push([
          { x: margin + part.size[0] + gap, y: margin, height: part.size[1] },
        ]);
        plates.push([{ part, copy, x: margin, y: margin }]);
      }
    }
  }
  return plates;
}
