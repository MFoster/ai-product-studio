import { Vector3, type BufferGeometry } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

export const MAX_STL_BYTES = 64 * 1024 * 1024;

export interface StlModel {
  geometry: BufferGeometry;
  dimensions: [number, number, number];
  triangles: number;
}

export function parseStl(buffer: ArrayBuffer): StlModel {
  if (buffer.byteLength > MAX_STL_BYTES) {
    throw new Error(
      "STL previews are limited to 64 MB. Download this file to inspect it locally.",
    );
  }
  const view = new DataView(buffer);
  const binaryLength =
    buffer.byteLength >= 84 ? 84 + view.getUint32(80, true) * 50 : 0;
  const isBinary = binaryLength === buffer.byteLength && binaryLength >= 84;
  let input: ArrayBuffer | string = buffer;
  if (!isBinary) {
    const header = new TextDecoder().decode(buffer.slice(0, 80)).trimStart();
    if (!/^solid\b/i.test(header))
      throw new Error(
        "This file is not a valid ASCII or binary STL, or it is truncated.",
      );
    input = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (!/\bendsolid\b/i.test(input))
      throw new Error("This ASCII STL is incomplete: endsolid is missing.");
    // STLLoader checks a binary header even for ASCII input.
    input = input.trimStart().padEnd(84, " ");
  }
  const geometry = new STLLoader().parse(input);
  try {
    const positions = geometry.getAttribute("position");
    if (!positions || positions.count === 0 || positions.count % 3 !== 0) {
      throw new Error("This STL contains no complete triangles.");
    }
    for (let index = 0; index < positions.array.length; index++) {
      if (!Number.isFinite(positions.array[index]))
        throw new Error("This STL contains non-finite vertex coordinates.");
    }
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) throw new Error("The STL bounds could not be calculated.");
    const size = bounds.getSize(new Vector3());
    if (!Number.isFinite(size.length()) || size.length() === 0) {
      throw new Error("This STL has empty or invalid dimensions.");
    }
    const center = bounds.getCenter(new Vector3());
    // Center only the browser geometry; retain file units and the source's Z-up orientation.
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return {
      geometry,
      dimensions: [size.x, size.y, size.z],
      triangles: positions.count / 3,
    };
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}
