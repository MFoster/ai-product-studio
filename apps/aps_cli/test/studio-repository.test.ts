import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(new URL("../bin/aps-node.js", import.meta.url));

test("a separate studio can be cloned, updated, and synchronized", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-studio-git-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: temp,
    GIT_CONFIG_NOSYSTEM: "1",
    APS_STUDIO_ROOT: "",
  };
  const run = (program: string, args: string[], expected = 0) => {
    const result = spawnSync(program, args, {
      cwd: repo,
      env,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      expected,
      `${args.join(" ")}\n${result.stderr}`,
    );
    return result;
  };
  const git = (...args: string[]) => run("git", args);
  const aps = (root: string, ...args: string[]) =>
    run(process.execPath, [cli, ...args, "--root", root]);
  const origin = path.join(temp, "origin.git");
  const author = path.join(temp, "author");
  const checkout = path.join(temp, "studio");
  const frameworkSkill = path.join(
    repo,
    ".github/skills/example-style/SKILL.md",
  );
  const frameworkBefore = existsSync(frameworkSkill)
    ? readFileSync(frameworkSkill)
    : null;
  mkdirSync(author);
  git("init", "--bare", "-q", origin);
  git("init", "-q", author);
  git("-C", author, "config", "user.name", "Studio Test");
  git("-C", author, "config", "user.email", "studio-test@example.invalid");
  run(process.execPath, [cli, "init", author, "--name", "Test Studio"]);
  aps(author, "product-line", "create", "example", "--name", "Example");
  const skill = "product-line/example/ai/skill/style/SKILL.md";
  const source = path.join(author, skill);
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(
    source,
    "---\nname: example-style\ndescription: Example style.\n---\n\nFirst version.\n",
  );
  git("-C", author, "add", ".");
  git("-C", author, "commit", "-qm", "Create studio");
  git("-C", author, "remote", "add", "origin", origin);
  git("-C", author, "push", "-q", "-u", "origin", "HEAD:main");
  git("clone", "-q", "--branch", "main", origin, checkout);

  aps(checkout, "registry", "sync");
  const registered = path.join(
    checkout,
    ".github/skills/example-style/SKILL.md",
  );
  assert.match(readFileSync(registered, "utf8"), /First version/);
  assert.deepEqual(
    existsSync(frameworkSkill) ? readFileSync(frameworkSkill) : null,
    frameworkBefore,
  );
  aps(checkout, "validate");

  writeFileSync(
    source,
    "---\nname: example-style\ndescription: Example style.\n---\n\nSecond version.\n",
  );
  git("-C", author, "add", skill);
  git("-C", author, "commit", "-qm", "Update style");
  git("-C", author, "push", "-q", "origin", "HEAD:main");
  git("-C", checkout, "fetch", "-q");
  git("-C", checkout, "merge", "--ff-only", "@{upstream}");
  const stale = run(
    process.execPath,
    [cli, "registry", "check", "--root", checkout],
    1,
  );
  assert.match(stale.stderr, /Stale registered skill/);
  aps(checkout, "registry", "sync");
  assert.match(readFileSync(registered, "utf8"), /Second version/);
  aps(checkout, "validate");
});
