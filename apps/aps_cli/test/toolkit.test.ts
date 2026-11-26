import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { initialize, createLine } from "../src/scaffolding.js";
import { checkToolkit, syncToolkit } from "../src/toolkit.js";
import { completionCandidates } from "../src/interactive.js";

function fixture(t: { after: (callback: () => void) => void }) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aps-toolkit-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "studio");
  const resources = path.join(temp, "resources");
  initialize(root, "Consumer", { force: false, dryRun: false });
  const resource = path.join(resources, ".github/skills/example/SKILL.md");
  mkdirSync(path.dirname(resource), { recursive: true });
  writeFileSync(
    resource,
    "---\nname: example\ndescription: Generic example.\n---\nVersion one\n",
  );
  mkdirSync(path.join(resources, "seed"), { recursive: true });
  writeFileSync(
    path.join(resources, "seed/constitution.md"),
    "Seed constitution\n",
  );
  return { root, resources, resource };
}

test("sync installs toolkit, studio and line capabilities while preserving user instructions", (t) => {
  const { root, resources, resource } = fixture(t);
  const agents = readFileSync(path.join(root, "AGENTS.md"));
  const local = path.join(root, "ai/agent/designer.agent.md");
  mkdirSync(path.dirname(local), { recursive: true });
  writeFileSync(
    local,
    "---\nname: designer\ndescription: Studio designer.\n---\n",
  );
  createLine(root, "line", "Line", "", { force: false, dryRun: false });
  writeFileSync(
    path.join(root, "product-line/line/ai/agent/specialist.agent.md"),
    "---\nname: specialist\ndescription: Line specialist.\n---\n",
  );
  assert.equal(syncToolkit(root, true, resources), 3);
  assert.equal(existsSync(path.join(root, ".toolkit")), false);
  assert.equal(syncToolkit(root, false, resources), 3);
  assert.deepEqual(checkToolkit(root, resources), []);
  assert.deepEqual(readFileSync(path.join(root, "AGENTS.md")), agents);
  assert.ok(
    existsSync(path.join(root, ".github/agents/line--specialist.agent.md")),
  );
  const constitution = path.join(root, ".specify/memory/constitution.md");
  writeFileSync(constitution, "My studio principles\n");
  writeFileSync(
    resource,
    "---\nname: example\ndescription: Updated example.\n---\nVersion two\n",
  );
  assert.equal(checkToolkit(root, resources).length, 1);
  syncToolkit(root, false, resources);
  assert.match(
    readFileSync(path.join(root, ".github/skills/example/SKILL.md"), "utf8"),
    /Version two/,
  );
  assert.equal(readFileSync(constitution, "utf8"), "My studio principles\n");
  unlinkSync(resource);
  syncToolkit(root, false, resources);
  assert.equal(
    existsSync(path.join(root, ".github/skills/example/SKILL.md")),
    false,
  );
});

test("sync preflights local edits, unowned files, and source collisions", (t) => {
  const { root, resources, resource } = fixture(t);
  const target = path.join(root, ".github/skills/example/SKILL.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "User-owned content");
  assert.throws(() => syncToolkit(root, false, resources), /unowned file/);
  assert.equal(readFileSync(target, "utf8"), "User-owned content");
  unlinkSync(target);
  syncToolkit(root, false, resources);
  writeFileSync(target, "Local edits");
  writeFileSync(resource, "Upstream update");
  for (const dryRun of [true, false])
    assert.throws(
      () => syncToolkit(root, dryRun, resources),
      /edited managed file/,
    );
  assert.equal(readFileSync(target, "utf8"), "Local edits");
  unlinkSync(resource);
  assert.throws(
    () => syncToolkit(root, false, resources),
    /edited managed file/,
  );
  assert.equal(readFileSync(target, "utf8"), "Local edits");
  writeFileSync(resource, "Upstream update");
  const local = path.join(root, "ai/skill/example/SKILL.md");
  mkdirSync(path.dirname(local), { recursive: true });
  writeFileSync(
    local,
    "---\nname: example\ndescription: Local example.\n---\n",
  );
  assert.throws(() => syncToolkit(root, false, resources), /collision/);
});

test("new toolkit commands are discoverable independently of the Python oracle", () => {
  assert.ok(
    completionCandidates([], "tool").some((entry) => entry.value === "toolkit"),
  );
  assert.deepEqual(
    completionCandidates(["toolkit"], "").map((entry) => entry.value),
    ["sync", "check"],
  );
});

test(
  "sync refuses symlink destinations and tampered ownership paths",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, resources } = fixture(t);
    const outside = path.join(path.dirname(root), "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(root, ".github/skills/example"));
    assert.throws(() => syncToolkit(root, false, resources), /symlinks/);
    assert.deepEqual(checkToolkit(root, resources), [
      "Toolkit is not synchronized; run `aps toolkit sync`.",
    ]);
    unlinkSync(path.join(root, ".github/skills/example"));
    syncToolkit(root, false, resources);
    const file = path.join(root, ".toolkit/manifest.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.entries[0].destination = ".github/skills/../../../outside/victim";
    writeFileSync(file, JSON.stringify(state));
    assert.throws(
      () => syncToolkit(root, false, resources),
      /Unsafe managed path/,
    );
  },
);
