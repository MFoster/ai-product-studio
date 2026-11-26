import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { studioRoot } from "../lib/files";

test("resolves the workspace studio root and honors its override", () => {
  const previous = process.env.APS_STUDIO_ROOT;
  try {
    delete process.env.APS_STUDIO_ROOT;
    assert.equal(
      studioRoot(),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
    );
    process.env.APS_STUDIO_ROOT = path.resolve("custom-studio");
    assert.equal(studioRoot(), path.resolve("custom-studio"));
  } finally {
    if (previous === undefined) delete process.env.APS_STUDIO_ROOT;
    else process.env.APS_STUDIO_ROOT = previous;
  }
});
