import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { MAX_STL_BYTES, parseStl } from "../lib/stl-geometry";

const ascii = `solid triangle
facet normal 0 0 1
outer loop
vertex 10 20 30
vertex 14 20 30
vertex 10 26 30
endloop
endfacet
endsolid triangle`;

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function binary(): ArrayBuffer {
  const buffer = new ArrayBuffer(134);
  new Uint8Array(buffer).set(new TextEncoder().encode("solid binary header"));
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  view.setFloat32(92, 1, true);
  const vertices = [10, 20, 30, 14, 20, 30, 10, 26, 30];
  vertices.forEach((value, index) =>
    view.setFloat32(96 + index * 4, value, true),
  );
  return buffer;
}

for (const [format, source] of [
  ["ASCII", () => bytes(ascii)],
  ["ASCII with leading whitespace", () => bytes(`\n  ${ascii}`)],
  ["binary with a solid header", binary],
] as const) {
  test(`prepares ${format} STL without rescaling or changing the source`, () => {
    const buffer = source();
    const original = buffer.slice(0);
    const model = parseStl(buffer);
    try {
      assert.deepEqual(model.dimensions, [4, 6, 0]);
      assert.equal(model.triangles, 1);
      assert.deepEqual(
        model.geometry.boundingBox?.getCenter(new Vector3()).toArray(),
        [0, 0, 0],
      );
      assert.deepEqual(new Uint8Array(buffer), new Uint8Array(original));
    } finally {
      model.geometry.dispose();
    }
  });
}

test("rejects malformed, truncated and empty STL data before rendering", () => {
  assert.throws(
    () => parseStl(new ArrayBuffer(MAX_STL_BYTES + 1)),
    /limited to 64 MB/,
  );
  assert.throws(() => parseStl(bytes("not an STL")), /not a valid/);
  assert.throws(
    () => parseStl(binary().slice(0, 90)),
    /incomplete|not a valid|encoded data/,
  );
  assert.throws(
    () => parseStl(bytes("solid empty\nendsolid empty")),
    /no complete triangles/,
  );
  assert.throws(
    () => parseStl(bytes(ascii.replace("endsolid triangle", ""))),
    /incomplete/,
  );
  const invalid = binary();
  new DataView(invalid).setFloat32(96, Infinity, true);
  assert.throws(() => parseStl(invalid), /non-finite/);
});
