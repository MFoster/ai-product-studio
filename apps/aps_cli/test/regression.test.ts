import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  copyFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { parse } from "yaml";
import { readArchiveEntry } from "../src/archive.js";
import {
  baseline,
  baselineSnapshot,
  completionBaseline,
  nextBaseline,
  archiveEntries,
  xmlTree,
  terminalCommand,
} from "./regression-helpers.js";
import {
  loadAssets,
  loadGroupManifest,
  loadPrinter,
  loadStudio,
  validateSlice,
} from "../src/manifests.js";
import { windowsShell } from "../src/completion.js";
import {
  comparePaths,
  expandWindowsUserPath,
  matchesPathSuffix,
  normalizeRelativePath,
  relativePosix,
  resolvePath,
  unsafeRelativePath,
} from "../src/paths.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(new URL("../bin/aps-node.js", import.meta.url));
test("Windows shell detection follows process ancestry", () => {
  const processes = [
    { ProcessId: 10, ParentProcessId: 20, Name: "node.exe" },
    { ProcessId: 20, ParentProcessId: 30, Name: "Pwsh.EXE" },
    { ProcessId: 30, ParentProcessId: 0, Name: "cmd.exe" },
  ];
  assert.equal(windowsShell(processes, 10), "pwsh");
  assert.equal(windowsShell(processes, 30), "cmd");
  assert.equal(windowsShell(processes, 40), undefined);
  assert.throws(() => windowsShell([{ ProcessId: 10 }], 10));
});

test("registry paths use portable separators on Windows", () => {
  assert.equal(
    relativePosix(
      "C:\\studio",
      "C:\\studio\\.github\\skills\\example\\SKILL.md",
      path.win32,
    ),
    ".github/skills/example/SKILL.md",
  );
});

test("path ordering uses platform comparison rules", () => {
  assert.ok(comparePaths("C:\\foo\\a\\z", "C:\\foo\\a.txt", path.win32) < 0);
  assert.ok(comparePaths("z.stl", "A.stl", path.win32) > 0);
  assert.ok(comparePaths("\uE000.txt", "\u{10000}.txt", path.posix) < 0);
});

test("Windows manifest paths reject traversal and normalize separators", () => {
  assert.equal(unsafeRelativePath("..\\outside", path.win32), true);
  assert.equal(unsafeRelativePath("C:\\outside", path.win32), true);
  assert.equal(
    unsafeRelativePath("config\\material\\file.yaml", path.win32),
    false,
  );
  assert.equal(
    normalizeRelativePath("config\\material\\file.yaml", path.win32),
    "config/material/file.yaml",
  );
  assert.equal(unsafeRelativePath("..\\outside", path.posix), false);
});

test("glob suffix matching follows platform case rules", () => {
  assert.equal(matchesPathSuffix("MODEL.BLEND", ".blend", "win32"), true);
  assert.equal(matchesPathSuffix("MODEL.BLEND", ".blend", "linux"), false);
  assert.equal(matchesPathSuffix("file.YAML", ".yaml", "win32"), true);
});

test("Windows home expansion supports both separators and named profiles", () => {
  const env = { USERNAME: "maker", USERPROFILE: "C:\\Users\\maker" };
  assert.equal(
    expandWindowsUserPath("~\\studio", env),
    "C:\\Users\\maker\\studio",
  );
  assert.equal(
    expandWindowsUserPath("~maker/studio", env),
    "C:\\Users\\maker\\studio",
  );
  assert.equal(
    expandWindowsUserPath("~other\\studio", env),
    "C:\\Users\\other\\studio",
  );
  assert.equal(
    expandWindowsUserPath("~\\studio", {
      HOMEDRIVE: "D:",
      HOMEPATH: "\\profiles\\maker",
    }),
    "D:\\profiles\\maker\\studio",
  );
  assert.throws(() =>
    expandWindowsUserPath("~other", {
      USERNAME: "maker",
      USERPROFILE: "C:\\custom",
    }),
  );
  assert.throws(() => expandWindowsUserPath("~", {}));
});

function command(args: string[], env: NodeJS.ProcessEnv = {}, input?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    env: { ...process.env, APS_STUDIO_ROOT: "", ...env },
    encoding: "utf8",
    input,
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, null, result.stderr);
  return result;
}

test(
  "path resolution follows symlinks before parent traversal with established semantics",
  { skip: process.platform === "win32" },
  (t) => {
    const temp = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "aps-node-resolve-")),
    );
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    mkdirSync(path.join(temp, "actual/child"), { recursive: true });
    symlinkSync("actual/child", path.join(temp, "link"));
    symlinkSync("actual/missing", path.join(temp, "broken"));
    symlinkSync("loop", path.join(temp, "loop"));
    symlinkSync("other", path.join(temp, "first"));
    symlinkSync("first", path.join(temp, "other"));
    for (const [input, expected] of [
      [`${temp}/link/../target`, `${temp}/actual/target`],
      [`${temp}/broken/../target`, `${temp}/actual/target`],
      [`${temp}/link/../../missing/../target`, `${temp}/target`],
      [
        `${path.relative(process.cwd(), temp)}/link/../target`,
        `${temp}/actual/target`,
      ],
      [`${temp}/loop`, `${temp}/loop`],
      [`${temp}/loop/target`, `${temp}/loop/target`],
      [`${temp}/loop/../target`, `${temp}/target`],
      [`${temp}/first`, `${temp}/first`],
      [`${temp}/first/target`, `${temp}/first/target`],
    ])
      assert.equal(resolvePath(input), expected, input);
    for (const kind of ["node"] as const) {
      const result = command([
        "init",
        `${temp}/link/../new-studio`,
        "--dry-run",
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(`${temp}/actual/new-studio`));
    }
    const root = path.join(temp, "actual/studio");
    for (const args of [
      ["init", root],
      ["product-line", "create", "line", "--name", "Line", "--root", root],
      [
        "variant",
        "create",
        "line",
        "default",
        "--name",
        "Default",
        "--root",
        root,
      ],
      [
        "product",
        "create",
        "line",
        "default",
        "model",
        "--name",
        "Model",
        "--root",
        root,
      ],
    ]) {
      const result = command(args);
      assert.equal(result.status, 0, result.stderr);
    }
    symlinkSync(path.join(temp, "actual/child"), path.join(root, "pivot"));
    for (const kind of ["node"] as const) {
      const registry = command(["registry", "check"], {
        HOME: temp,
        APS_STUDIO_ROOT: "~/link/../studio",
      });
      assert.equal(registry.status, 0, registry.stderr);
      const workflow = command([
        "workflow",
        "status",
        "pivot/../studio/product-line/line/variant/default/model",
        "--root",
        root,
      ]);
      assert.equal(workflow.status, 0, workflow.stderr);
      assert.match(workflow.stdout, /model: brief/);
    }
  },
);

test(
  "non-strict path resolution handles inaccessible components with established semantics",
  { skip: process.platform === "win32" },
  (t) => {
    const temp = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "aps-node-permissions-")),
    );
    const directory = path.join(temp, "locked");
    mkdirSync(directory);
    t.after(() => {
      chmodSync(directory, 0o700);
      rmSync(temp, { recursive: true, force: true });
    });
    chmodSync(directory, 0);
    try {
      lstatSync(`${directory}/missing`);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EACCES"
      ) {
        t.skip("The test process can traverse the restricted directory.");
        return;
      }
    }
    const input = `${directory}/missing/../target`;
    assert.equal(resolvePath(input), path.join(directory, "target"));
  },
);

test("shell completion preserves established contracts for commands, options, choices and shell scripts", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-completion-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const run = (args: string[], env: NodeJS.ProcessEnv) => command(args, env);
  const expectedCompletion = (args: string[], env: NodeJS.ProcessEnv) =>
    completionBaseline(args, env, temp);
  const cases = [
    { words: "aps ", index: 1 },
    { words: "aps wo", index: 1 },
    { words: "aps --", index: 1 },
    { words: "aps workflow ", index: 2 },
    { words: "aps workflow advance x r", index: 4 },
    { words: "aps workflow advance x review --note hi --", index: 7 },
    { words: "aps init --name --", index: 3 },
    { words: "aps assets package model --g", index: 4 },
    { words: "aps config --y", index: 2 },
    { words: "aps config -", index: 2 },
    { words: "aps config --yes -", index: 3 },
    { words: "aps config -y -", index: 3 },
    { words: "aps constructor --", index: 2 },
    { words: "aps unknown w", index: 2 },
    { words: "aps workflow nonexistent --", index: 3 },
    { words: "aps workflow nonexistent ", index: 3 },
  ];
  for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
    for (const entry of cases) {
      const base = {
        COMP_WORDS: entry.words,
        COMP_CWORD: String(entry.index),
        _TYPER_COMPLETE_ARGS: entry.words,
        _TYPER_COMPLETE_FISH_ACTION: "get-args",
        _TYPER_COMPLETE_WORD_TO_COMPLETE: entry.words.endsWith(" ")
          ? ""
          : entry.words.split(" ").at(-1),
      };
      const expected = expectedCompletion([], {
        ...base,
        _APS_COMPLETE: `complete_${shell}`,
      });
      const actual = run([], {
        ...base,
        _APS_NODE_COMPLETE: `complete_${shell}`,
      });
      assert.equal(actual.status, expected.status, `${shell}: ${entry.words}`);
      const legacyCompletions = actual.stdout
        .replace(/\n"toolkit":"[^"]*"/g, "")
        .replace(/^toolkit(?:[\t:].*)?\n/gm, "");
      assert.equal(
        legacyCompletions,
        expected.stdout,
        `${shell}: ${entry.words}`,
      );
    }
    const env = { _TYPER_COMPLETE_TEST_DISABLE_SHELL_DETECTION: "1" };
    const expected = expectedCompletion(["--show-completion", shell], env);
    const actual = run(["--show-completion", shell], env);
    assert.equal(actual.status, expected.status, shell);
    assert.equal(
      actual.stdout
        .replaceAll("aps-node", "aps")
        .replaceAll("aps_node", "aps")
        .replaceAll("APS_NODE", "APS"),
      expected.stdout,
      shell,
    );
  }
  for (const words of ["aps workflow ", "aps nonexistent"]) {
    const base = {
      _TYPER_COMPLETE_ARGS: words,
      _TYPER_COMPLETE_FISH_ACTION: "is-args",
    };
    const expected = expectedCompletion([], {
      ...base,
      _APS_COMPLETE: "complete_fish",
    });
    const actual = run([], {
      ...base,
      _APS_NODE_COMPLETE: "complete_fish",
    });
    assert.equal(actual.status, expected.status, words);
    assert.equal(actual.stdout, expected.stdout, words);
  }
  if (process.platform !== "win32") {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SHELL: "/bin/zsh",
      _TYPER_COMPLETE_TEST_DISABLE_SHELL_DETECTION: "",
    };
    let shellCommands = ["/bin/bash"];
    if (process.platform === "darwin") {
      const bin = path.join(temp, "detect-bin");
      mkdirSync(bin);
      const fakePs = path.join(bin, "ps");
      writeFileSync(
        fakePs,
        '#!/bin/sh\nprintf "%s 999999 aps\\n999999 1 %s\\n" "$PPID" "$APS_TEST_SHELL_COMMAND"\n',
      );
      chmodSync(fakePs, 0o755);
      env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
      const xonsh = path.join(temp, "xonsh");
      writeFileSync(xonsh, "");
      shellCommands = ["/bin/bash", "-bash", `python ${xonsh}`];
    }
    for (const shellCommand of shellCommands) {
      const shellEnv = { ...env, APS_TEST_SHELL_COMMAND: shellCommand };
      const actual = spawnSync(
        "/bin/bash",
        [
          "-c",
          '"$@"; status=$?; exit "$status"',
          "shell",
          process.execPath,
          cli,
          "--show-completion",
        ],
        { cwd: repo, env: shellEnv, encoding: "utf8" },
      );
      if (actual.error) throw actual.error;
      const expected = expectedCompletion(
        ["--show-completion", shellCommand === "-bash" ? "zsh" : "bash"],
        {},
      );
      assert.equal(
        actual.status,
        shellCommand.startsWith("python ") ? 1 : 0,
        actual.stderr,
      );
      if (actual.status === 0)
        assert.equal(
          actual.stdout
            .replaceAll("aps-node", "aps")
            .replaceAll("aps_node", "aps")
            .replaceAll("APS_NODE", "APS"),
          expected.stdout,
        );
      if (actual.status === 0)
        assert.match(
          actual.stdout,
          shellCommand === "-bash" ? /#compdef/ : /complete -o default -F/,
        );
      else if (shellCommand.startsWith("python ")) {
        assert.match(actual.stderr, /Shell xonsh not supported/);
      }
    }
  }
  for (const shell of ["bash", "zsh", "fish"] as const) {
    const baselineHome = path.join(temp, `${shell}-baseline`);
    const homeNode = path.join(temp, `${shell}-node`);
    mkdirSync(homeNode);
    const args = ["--install-completion", shell];
    const environment = { _TYPER_COMPLETE_TEST_DISABLE_SHELL_DETECTION: "1" };
    const expected = expectedCompletion(args, {
      ...environment,
      HOME: baselineHome,
    });
    const actual = run(args, { ...environment, HOME: homeNode });
    assert.equal(actual.status, expected.status, `${shell}: ${actual.stderr}`);
    assert.equal(
      actual.stdout
        .replaceAll(homeNode, baselineHome)
        .replaceAll("aps-node", "aps"),
      expected.stdout,
    );
    const actualFiles = JSON.stringify(snapshot(homeNode))
      .replaceAll(homeNode, baselineHome)
      .replaceAll("aps-node", "aps")
      .replaceAll("aps_node", "aps")
      .replaceAll("APS_NODE", "APS");
    assert.deepEqual(
      JSON.parse(actualFiles),
      baselineSnapshot("snapshot-aps-completion", baselineHome),
      shell,
    );
  }
  if (process.platform !== "win32") {
    const bin = path.join(temp, "shell-bin");
    mkdirSync(bin);
    for (const shell of ["powershell", "pwsh"]) {
      const executable = path.join(bin, shell);
      writeFileSync(
        executable,
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$APS_COMPLETION_LOG"\nif [ "$1" = "-NoProfile" ]; then printf "%s\\n" "$APS_COMPLETION_PROFILE"; elif [ "$APS_FAIL_POLICY" = "1" ]; then exit 7; fi\n',
      );
      chmodSync(executable, 0o755);
      const baselineProfile = path.join(
        temp,
        `${shell}-baseline`,
        "profile.ps1",
      );
      const nodeProfile = path.join(temp, `${shell}-node`, "profile.ps1");
      const baselineLog = path.join(temp, `${shell}-baseline.log`);
      const nodeLog = path.join(temp, `${shell}-node.log`);
      const env = {
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        _TYPER_COMPLETE_TEST_DISABLE_SHELL_DETECTION: "1",
      };
      const args = ["--install-completion", shell];
      const expected = expectedCompletion(args, {
        ...env,
        APS_COMPLETION_PROFILE: baselineProfile,
        APS_COMPLETION_LOG: baselineLog,
      });
      const actual = run(args, {
        ...env,
        APS_COMPLETION_PROFILE: nodeProfile,
        APS_COMPLETION_LOG: nodeLog,
      });
      assert.equal(actual.status, expected.status, actual.stderr);
      assert.equal(
        actual.stdout
          .replaceAll(nodeProfile, baselineProfile)
          .replaceAll("aps-node", "aps"),
        expected.stdout,
      );
      assert.equal(
        readFileSync(nodeProfile, "utf8")
          .replaceAll("aps-node", "aps")
          .replaceAll("aps_node", "aps")
          .replaceAll("APS_NODE", "APS"),
        baseline<{ profile: string }[]>("powershell-profile", temp)[
          shell === "powershell" ? 0 : 1
        ].profile,
      );
      assert.equal(
        readFileSync(nodeLog, "utf8"),
        baseline<{ log: string }[]>("powershell-profile", temp)[
          shell === "powershell" ? 0 : 1
        ].log,
      );
      const failedProfile = path.join(temp, `${shell}-failed`, "profile.ps1");
      const failed = run(args, {
        ...env,
        APS_COMPLETION_PROFILE: failedProfile,
        APS_COMPLETION_LOG: nodeLog,
        APS_FAIL_POLICY: "1",
      });
      assert.equal(failed.status, 0, failed.stderr);
      assert.match(failed.stderr, /execution policy was not changed/);
      assert.ok(existsSync(failedProfile));
    }
  }
});

function snapshot(root: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  function walk(directory: string, relative = ""): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        result[`${name}/`] = null;
        walk(file, name);
      } else {
        const content = readFileSync(file, "utf8");
        result[name] = name.endsWith(".yaml") ? parse(content) : content;
      }
    }
  }
  if (existsSync(root)) walk(root);
  return result;
}

test("manifest validation and coercion preserve established contracts for representative edge cases", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-models-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "studio");
  assert.equal(command(["init", root]).status, 0);
  const studio = parse(
    readFileSync(path.join(root, "config/studio.yaml"), "utf8"),
  );
  const printer = parse(
    readFileSync(path.join(root, "config/printer/generic-fdm.yaml"), "utf8"),
  );
  const cases: {
    model: "studio" | "printer";
    data: Record<string, unknown>;
  }[] = [];
  function add(
    model: "studio" | "printer",
    values: Record<string, unknown>,
  ): void {
    const data = structuredClone(model === "studio" ? studio : printer);
    Object.assign(data, values);
    cases.push({ model, data });
  }
  add("studio", {});
  add("studio", { material_config: "config//./material.yaml" });
  add("studio", { material_config: "config/material/" });
  add("studio", { material_config: "../outside" });
  add("studio", { default_printer: "Bad_Slug" });
  add("studio", { product_lines: ["ok", "not/ok"] });
  add("studio", { unexpected: true });
  add("printer", {});
  for (const value of [
    "true",
    "false",
    "yes",
    "no",
    "ON",
    "Off",
    "t",
    "f",
    "0",
    "1",
    " true ",
    0,
    1,
    2,
    "invalid",
    null,
    [],
    {},
  ])
    add("printer", { supports_multi_material: value, max_material_slots: 1 });
  for (const value of [
    "0.4",
    "1_0",
    true,
    false,
    "not-a-number",
    -1,
    0,
    ".5",
    "1.",
    "1e2",
    "0_1",
    " 1 ",
    "0x10",
    "-0",
    null,
    [],
    {},
  ])
    add("printer", { nozzle_diameter_mm: value });
  for (const value of [
    "1.0",
    "2",
    0,
    -1,
    1.5,
    true,
    false,
    "1e2",
    "0_1",
    "1.5",
    " 1 ",
    "0x10",
    "-0",
    null,
    [],
    {},
  ])
    add("printer", { max_material_slots: value });
  add("printer", { build_volume_mm: { x: 100, y: 200, z: 300 } });
  add("printer", { build_volume_mm: { x: 100, y: 200 } });
  add("printer", { build_volume_mm: { x: 100, y: 0, z: 300 } });
  const expected = baseline<{ valid: boolean; data?: unknown }[][]>(
    "manifest-validation",
  )[0];
  assert.equal(expected.length, cases.length);
  for (const [index, item] of cases.entries()) {
    const file = path.join(temp, `${item.model}.json`);
    writeFileSync(file, JSON.stringify(item.data));
    let result: { valid: boolean; data?: unknown };
    try {
      result = {
        valid: true,
        data: item.model === "studio" ? loadStudio(file) : loadPrinter(file),
      };
    } catch {
      result = { valid: false };
    }
    assert.deepEqual(result, expected[index], JSON.stringify(item));
  }
});

test("relative asset, group and slice paths normalize with established semantics", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-paths-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const groups = {
    product: "model",
    groups: [
      {
        id: "assembly",
        name: "Assembly",
        revision: "v1",
        package: "package//assembly.3mf/",
        materials: [{ id: "white", name: "White", color: "#ffffff" }],
        parts: [
          {
            id: "part",
            name: "Part",
            meshes: [
              {
                asset: "export//part.stl/",
                material: "white",
                sha256: "a".repeat(64),
              },
            ],
          },
        ],
      },
    ],
  };
  const assets = {
    product: "model",
    generated_at: "2026-01-01T00:00:00Z",
    assets: [
      {
        path: "source//model.blend/",
        kind: "source",
        format: "blend",
        role: "source",
        sha256: "a".repeat(64),
        size_bytes: 1,
      },
    ],
  };
  const slice = {
    slug: "profile",
    name: "Profile",
    product: "model",
    printer_profile: "generic-fdm",
    evidence: "captured",
    recorded_at: "2026-01-01T00:00:00Z",
    source: "source//project.3mf/",
    settings_file: "slice//settings.json/",
    nozzle_diameter_mm: 0.4,
    layer_height_mm: 0.2,
    first_layer_height_mm: 0.2,
    wall_loops: 2,
  };
  const groupFile = path.join(temp, "groups.yaml");
  writeFileSync(groupFile, JSON.stringify(groups));
  writeFileSync(path.join(temp, "assets.yaml"), JSON.stringify(assets));
  const group = loadGroupManifest(groupFile).groups[0];
  const asset = loadAssets(temp).assets[0];
  const profile = validateSlice(slice, "slice");
  assert.deepEqual(
    {
      package: group.package,
      mesh: group.parts[0].meshes[0].asset,
      asset: asset.path,
      source: profile.source,
      settings: profile.settings_file,
    },
    {
      package: "package/assembly.3mf",
      mesh: "export/part.stl",
      asset: "source/model.blend",
      source: "source/project.3mf",
      settings: "slice/settings.json",
    },
  );
});

test("scaffolding normalizes the parent studio material path with established semantics", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-parent-path-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  for (const kind of ["node"] as const) {
    const root = roots[kind];
    assert.equal(command(["init", root]).status, 0);
    const file = path.join(root, "config/studio.yaml");
    const studio = parse(readFileSync(file, "utf8"));
    studio.material_config = "config//material/material.yaml/";
    writeFileSync(file, JSON.stringify(studio));
    const result = command([
      "product-line",
      "create",
      "line",
      "--name",
      "Line",
      "--root",
      root,
    ]);
    assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
  }
  assert.deepEqual(
    snapshot(roots.node),
    baselineSnapshot("snapshot-aps-node-parent-path", roots.node),
  );
});

test("native scaffolding preserves established contracts manifests, files, directories, and conflicts", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-parity-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  function both(args: (root: string) => string[], expected = 0): void {
    for (const kind of ["node"] as const) {
      const result = command(args(roots[kind]));
      assert.equal(
        result.status,
        expected,
        `${kind}: ${result.stdout}\n${result.stderr}`,
      );
    }
    assert.deepEqual(
      snapshot(roots.node),
      baselineSnapshot("snapshot-aps-node-parity", roots.node),
    );
  }

  both((root) => ["init", root, "--name", "Parity Studio", "--dry-run"]);
  both((root) => ["init", root, "--name", "Parity Studio"]);
  both((root) => ["init", root], 1);
  both((root) => [
    "product-line",
    "create",
    "zulu",
    "--name",
    "Zulu",
    "--root",
    root,
  ]);
  both((root) => [
    "product-line",
    "create",
    "alpha",
    "--name",
    "Alpha",
    "--description",
    "A line",
    "--root",
    root,
  ]);
  both(
    (root) => [
      "product-line",
      "create",
      "alpha",
      "--name",
      "Alpha",
      "--root",
      root,
    ],
    1,
  );
  both((root) => [
    "variant",
    "create",
    "alpha",
    "default",
    "--name",
    "Default",
    "--theme",
    "Winter",
    "--root",
    root,
  ]);
  both((root) => [
    "product",
    "create",
    "alpha",
    "default",
    "example",
    "--name",
    "Example",
    "--summary",
    "A product",
    "--root",
    root,
  ]);
  both((root) => [
    "product",
    "create",
    "alpha",
    "default",
    "later",
    "--name",
    "Later",
    "--root",
    root,
    "--dry-run",
  ]);
  both((root) => [
    "product",
    "create",
    "alpha",
    "default",
    "example",
    "--name",
    "Replacement",
    "--root",
    root,
    "--force",
  ]);
  both(
    (root) => [
      "product-line",
      "create",
      "Not-A-Slug",
      "--name",
      "Invalid",
      "--root",
      root,
    ],
    1,
  );
  both(
    (root) => [
      "product-line",
      "create",
      "trailing-newline\n",
      "--name",
      "Invalid",
      "--root",
      root,
    ],
    1,
  );
});

test("root selection honors environment, explicit override, and invalid configured root", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-roots-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    const other = path.join(temp, `${kind}-other`);
    for (const target of [root, other])
      assert.equal(command(["init", target]).status, 0);
    const env = { APS_STUDIO_ROOT: root };
    assert.equal(
      command(["product-line", "create", "env", "--name", "Env"], env).status,
      0,
    );
    assert.equal(
      command(
        ["product-line", "create", "other", "--name", "Other", "--root", other],
        env,
      ).status,
      0,
    );
    assert.ok(
      existsSync(path.join(root, "product-line/env/product-line.yaml")),
    );
    assert.ok(
      existsSync(path.join(other, "product-line/other/product-line.yaml")),
    );
    if (process.platform !== "win32") {
      const user = os.userInfo();
      const configured = `~${user.username}/${path.relative(user.homedir, root)}`;
      const result = command(["registry", "check"], {
        APS_STUDIO_ROOT: configured,
      });
      assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
      const missingUser = command(["registry", "check"], {
        APS_STUDIO_ROOT: `~aps-nonexistent-${path.basename(temp)}/studio`,
      });
      assert.equal(missingUser.status, 1, missingUser.stderr);
      assert.match(missingUser.stderr, /Could not determine home directory/);
      const missingStudio = `aps-nonexistent-${path.basename(temp)}`;
      const otherUser = command(["registry", "check"], {
        APS_STUDIO_ROOT: `~root/${missingStudio}`,
      });
      assert.equal(otherUser.status, 1, otherUser.stderr);
      assert.ok(
        otherUser.stderr.includes(
          path.join(
            process.platform === "darwin" ? "/private/var/root" : "/root",
            missingStudio,
          ),
        ),
        `${kind}: ${otherUser.stderr}`,
      );
    }
    const invalid = command(
      ["product-line", "create", "invalid", "--name", "Invalid"],
      { APS_STUDIO_ROOT: path.join(temp, "missing") },
    );
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stderr, /APS_STUDIO_ROOT is not a studio/);
  }
});

test("invalid parent manifests fail without silently accepting unknown fields", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-invalid-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    assert.equal(command(["init", root]).status, 0);
    const config = path.join(root, "config/studio.yaml");
    writeFileSync(config, `${readFileSync(config, "utf8")}unexpected: true\n`);
    const result = command([
      "product-line",
      "create",
      "line",
      "--name",
      "Line",
      "--root",
      root,
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /unexpected/i);
  }
});

test("scaffolding rejects null parent fields rather than applying defaults", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-null-parent-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    assert.equal(command(["init", root]).status, 0);
    assert.equal(
      command([
        "product-line",
        "create",
        "line",
        "--name",
        "Line",
        "--root",
        root,
      ]).status,
      0,
    );
    assert.equal(
      command([
        "variant",
        "create",
        "line",
        "variant",
        "--name",
        "Variant",
        "--root",
        root,
      ]).status,
      0,
    );
    for (const [file, fields, args] of [
      [
        "config/studio.yaml",
        ["material_config", "product_lines", "registry_index"],
        ["product-line", "create", "new", "--name", "New"],
      ],
      [
        "product-line/line/product-line.yaml",
        [
          "description",
          "audience",
          "design_language",
          "default_workflow",
          "variants",
        ],
        ["variant", "create", "line", "new", "--name", "New"],
      ],
      [
        "product-line/line/variant/variant/variant.yaml",
        ["theme", "palette", "constraints", "products"],
        ["product", "create", "line", "variant", "new", "--name", "New"],
      ],
    ] as const) {
      const target = path.join(root, file);
      const original = readFileSync(target, "utf8");
      for (const field of fields) {
        const data = parse(original) as Record<string, unknown>;
        data[field] = null;
        writeFileSync(target, JSON.stringify(data));
        const result = command([...args, "--root", root, "--dry-run"]);
        assert.equal(result.status, 1, `${kind}: ${field}: ${result.stderr}`);
        writeFileSync(target, original);
      }
    }
  }
});

test("unknown commands are rejected explicitly", () => {
  const result = command(["future-command"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No such command/);
});

test("invalid command arguments fail with the same exit status as the established CLI", () => {
  for (const args of [
    [],
    ["invalid-command"],
    ["assets"],
    ["assets", "invalid-command"],
    ["--help", "--unknown"],
    ["workflow", "--help", "--unknown"],
    ["init", "one", "two"],
    ["init", "--unknown"],
    ["init", "--name"],
    ["validate", "--force"],
    ["product-line", "create", "line"],
    ["variant", "create", "line"],
    ["product", "create", "line", "variant"],
    ["registry", "check", "--dry-run"],
    ["schema", "write", "extra"],
    ["assets", "inventory"],
    ["workflow", "advance", "product", "invalid", "--note", "note"],
    ["workflow", "advance", "product", "design"],
    ["workflow", "print-result", "product", "passed"],
    ["release", "create", "product", "v1"],
    ["slicer", "capture", "product"],
  ]) {
    const actual = command(args);
    assert.equal(actual.status, 2, args.join(" "));
    assert.ok(actual.stdout || actual.stderr, args.join(" "));
  }
  for (const [args, message] of [
    [["invalid-command"], "No such command 'invalid-command'."],
    [["registry", "--unknown"], "No such option: --unknown"],
    [["registry", "--help", "--unknown"], "No such option: --unknown"],
    [["--help", "--unknown"], "No such option: --unknown"],
    [["init", "--help", "--unknown"], "No such option: --unknown"],
    [["init", "--help", "--name"], "Option '--name' requires an argument."],
    [["init", "--unknown"], "No such option: --unknown"],
    [["init", "--name"], "Option '--name' requires an argument."],
    [["init", "--force=true"], "Option '--force' does not take a value."],
    [["config", "--yes=true"], "Option '--yes' does not take a value."],
    [["validate", "-y"], "No such option: -y"],
    [["validate", "--name"], "No such option: --name"],
    [["validate", "--force=true"], "No such option: --force"],
    [["workflow", "status", "product", "--name"], "No such option: --name"],
    [["registry", "check", "--dry-run=true"], "No such option: --dry-run"],
    [["init", "--root"], "No such option: --root"],
    [["init", "one", "two"], "Got unexpected extra argument(s) (two)"],
    [["product-line", "create", "line"], "Missing option '--name'."],
    [["variant", "create", "line"], "Missing argument 'slug'."],
    [["workflow", "advance", "product", "design"], "Missing option '--note'."],
    [
      ["workflow", "advance", "product", "invalid"],
      "Invalid value for 'stage': 'invalid' is not one of",
    ],
    [
      ["workflow", "advance", "product", "invalid", "extra"],
      "Invalid value for 'stage': 'invalid' is not one of",
    ],
  ] as const) {
    for (const kind of ["node"] as const) {
      const result = command([...args]);
      assert.ok(
        stripVTControlCharacters(result.stderr).includes(message),
        `${kind}: ${result.stderr}`,
      );
    }
  }
  for (const kind of ["node"] as const) {
    const result = command(["init", "--help", "--name", "--unknown"]);
    assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
    assert.match(stripVTControlCharacters(result.stdout), /--dry-run/);
  }
});

test("help describes command families without starting interactive prompts", () => {
  for (const [args, descriptions] of [
    [
      ["--help"],
      [
        "Initialize a new AI Product Studio directory.",
        "Interactively configure the studio printer",
      ],
    ],
    [
      ["assets", "--help"],
      ["Write a checksummed assets.yaml", "Report unmanaged model assets"],
    ],
    [
      ["workflow", "--help"],
      [
        "Show a product's current workflow",
        "Record passed or failed physical test-print evidence.",
      ],
    ],
    [
      ["registry", "--help"],
      [
        "Publish product-local agents and skills",
        "Check that the generated .github registry is current.",
      ],
    ],
    [["--help", "bogus"], ["Manage AI-first printable product lines."]],
    [
      ["init", "example", "--help"],
      ["Initialize a new AI Product Studio directory."],
    ],
    [
      ["workflow", "advance", "example", "--help"],
      ["Advance a product by one workflow stage"],
    ],
    [
      ["workflow", "--help", "bogus"],
      ["Inspect and advance gated product workflow stages."],
    ],
    [["--", "--help"], ["Manage AI-first printable product lines."]],
    [
      ["--", "workflow", "--help"],
      ["Inspect and advance gated product workflow stages."],
    ],
    [
      ["workflow", "--", "--help"],
      ["Inspect and advance gated product workflow stages."],
    ],
    [
      ["workflow", "--", "status", "--help"],
      ["Show a product's current workflow"],
    ],
  ] as const) {
    for (const kind of ["node"] as const) {
      const result = command([...args]);
      assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
      const output = result.stdout.replace(/\s+/g, " ");
      for (const description of descriptions)
        assert.ok(output.includes(description), `${kind}: ${description}`);
    }
  }
  const args = ["init", "--dry-run", "--", "--help"];
  for (const valueArgs of [args, ["init", "--dry-run", "--name", "--help"]]) {
    const expected = baseline<
      { args: string[]; status: number; stdout: string }[]
    >("help-values").find(
      (item) => JSON.stringify(item.args) === JSON.stringify(valueArgs),
    );
    assert.ok(expected);
    const actual = command(valueArgs);
    assert.equal(actual.status, expected.status);
    assert.equal(actual.stdout, expected.stdout);
  }
  const workflowHelp = command(["workflow", "advance", "--help"]);
  for (const stage of [
    "brief",
    "design",
    "review",
    "print-validation",
    "release",
  ])
    assert.ok(workflowHelp.stdout.includes(stage));
  assert.match(workflowHelp.stdout, /--note <str>\s+\[required\]/);
  assert.match(workflowHelp.stdout, /APS_STUDIO_ROOT/);
  assert.match(
    command(["init", "--help"]).stdout,
    /default: AI Product Studio/,
  );
  for (const [args, description] of [
    [["assets", "package", "--help"], "Build only this group ID."],
    [["config", "--help"], "Write without final confirmation."],
  ] as const) {
    for (const kind of ["node"] as const) {
      const result = command([...args]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.includes(description),
        `${kind}: ${result.stdout}`,
      );
    }
  }
});

test("help exposes the same options for every command", () => {
  const commands = [
    "",
    "init",
    "config",
    "validate",
    "product-line",
    "product-line create",
    "variant",
    "variant create",
    "product",
    "product create",
    "registry",
    "registry check",
    "registry sync",
    "assets",
    "assets inventory",
    "assets package",
    "assets legacy-inventory",
    "workflow",
    "workflow status",
    "workflow advance",
    "workflow print-result",
    "schema",
    "schema write",
    "release",
    "release create",
    "slicer",
    "slicer list",
    "slicer capture",
  ];
  const options = (text: string) =>
    [
      ...new Set(stripVTControlCharacters(text).match(/--[a-z][a-z-]*/g) ?? []),
    ].sort();
  for (const name of commands) {
    const args = [...name.split(" ").filter(Boolean), "--help"];
    const expected = baseline<{ args: string[]; options: string[] }[]>(
      "help-options",
    ).find((item) => JSON.stringify(item.args) === JSON.stringify(args));
    assert.ok(expected);
    const actual = command(args);
    assert.equal(actual.status, 0, name);
    assert.deepEqual(options(actual.stdout), expected.options, name);
  }
});

test("implemented Node commands do not execute Python", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-without-baseline-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "studio");
  assert.equal(command(["init", root], { PATH: "" }).status, 0);
  assert.equal(
    command(
      ["product-line", "create", "line", "--name", "Line", "--root", root],
      { PATH: "" },
    ).status,
    0,
  );
  const product = "product-line/line/variant/default/model";
  for (const args of [
    ["variant", "create", "line", "default", "--name", "Default"],
    ["product", "create", "line", "default", "model", "--name", "Model"],
    ["workflow", "status", product],
    ["assets", "inventory", product],
    ["slicer", "list", product],
    ["schema", "write"],
    ["validate"],
  ]) {
    const result = command([...args, "--root", root], { PATH: "" });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  }
});

test("workspace entry point uses Node without Python and resolves paths from the repository root", (t) => {
  const target = "apps/aps_cli/parity-dry-run-studio";
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-entry-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const executable of ["python", "python3"]) {
    const file = path.join(temp, executable);
    writeFileSync(
      file,
      "#!/bin/sh\necho 'unexpected Python invocation' >&2\nexit 125\n",
    );
    chmodSync(file, 0o755);
  }
  const nodeResult = spawnSync(
    "npm",
    ["run", "aps", "--", "init", target, "--dry-run"],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        APS_STUDIO_ROOT: "",
        PATH: `${temp}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  if (nodeResult.error) throw nodeResult.error;
  assert.equal(nodeResult.status, 0, nodeResult.stderr);
  assert.ok(
    nodeResult.stdout.includes(`Would initialize ${path.join(repo, target)}`),
  );
  assert.ok(!existsSync(path.join(repo, target)));
});

test("registry frontmatter truthiness preserves established contracts", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-frontmatter-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    assert.equal(command(["init", root]).status, 0);
    const directory = path.join(root, "product-line/line/ai/agent");
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "test.agent.md");
    for (const [name, description, status] of [
      ["[]", "valid", 1],
      ["{}", "valid", 1],
      ["valid", "[]", 1],
      ["valid", "{}", 1],
      [".nan", "valid", 0],
      ["valid", ".nan", 0],
      ["2001-01-01", "valid", 0],
    ] as const) {
      writeFileSync(
        file,
        `---\nname: ${name}\ndescription: ${description}\n---\n`,
      );
      const result = command(["registry", "sync", "--root", root, "--dry-run"]);
      assert.equal(
        result.status,
        status,
        `${kind}: ${name}, ${description}: ${result.stderr}`,
      );
    }
  }
});

test("registry synchronization and stale-file handling preserve established contracts", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-registry-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  function both(args: (root: string) => string[], expected = 0): void {
    for (const kind of ["node"] as const) {
      const result = command(args(roots[kind]));
      assert.equal(
        result.status,
        expected,
        `${kind}: ${result.stdout}\n${result.stderr}`,
      );
    }
    assert.deepEqual(
      snapshot(roots.node),
      baselineSnapshot("snapshot-aps-node-registry", roots.node),
    );
  }
  both((root) => ["init", root]);
  both((root) => [
    "product-line",
    "create",
    "line",
    "--name",
    "Line",
    "--root",
    root,
  ]);
  for (const root of Object.values(roots)) {
    const agent = path.join(
      root,
      "product-line/line/ai/agent/architect.agent.md",
    );
    const skill = path.join(root, "product-line/line/ai/skill/line-design");
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      agent,
      "---\nname: architect\ndescription: Design\n---\n\n# Agent\n",
    );
    writeFileSync(
      path.join(root, "product-line/line/ai/agent/uppercase.AGENT.MD"),
      "---\nname: uppercase\ndescription: Design\n---\n\n# Agent\n",
    );
    writeFileSync(
      path.join(skill, "SKILL.md"),
      "---\nname: line-design\ndescription: Design\n---\n\n# Skill\n",
    );
    writeFileSync(path.join(skill, "reference.md"), "# Reference\n");
  }
  both((root) => ["registry", "check", "--root", root], 1);
  both((root) => ["registry", "sync", "--root", root, "--dry-run"]);
  both((root) => ["registry", "sync", "--root", root]);
  both((root) => ["registry", "check", "--root", root]);
  for (const root of Object.values(roots)) {
    writeFileSync(
      path.join(root, "product-line/line/ai/skill/line-design/reference.md"),
      "# Changed\n",
    );
  }
  both((root) => ["registry", "check", "--root", root], 1);
  both((root) => ["registry", "sync", "--root", root]);
  for (const root of Object.values(roots)) {
    unlinkSync(
      path.join(root, "product-line/line/ai/agent/architect.agent.md"),
    );
  }
  both((root) => ["registry", "sync", "--root", root, "--dry-run"]);
  both((root) => ["registry", "sync", "--root", root]);
  both((root) => ["registry", "check", "--root", root]);
});

test("registry synchronization refuses to prune outside the studio", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-prune-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const outside = path.join(temp, "outside");
  writeFileSync(outside, "preserve");
  const externalDir = path.join(temp, "external");
  mkdirSync(path.join(externalDir, "child"), { recursive: true });
  writeFileSync(path.join(externalDir, "victim"), "preserve");
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    assert.equal(command(["init", root]).status, 0);
    mkdirSync(path.join(root, ".aps"), { recursive: true });
    writeFileSync(
      path.join(root, ".aps/registry.yaml"),
      "entries:\n- destination: ../outside\n",
    );
    for (const extra of [["--dry-run"], []]) {
      const result = command(["registry", "sync", "--root", root, ...extra]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Refusing to prune path outside studio root/);
      assert.equal(readFileSync(outside, "utf8"), "preserve");
    }
    if (process.platform !== "win32") {
      symlinkSync(path.join(externalDir, "child"), path.join(root, "pivot"));
      writeFileSync(
        path.join(root, ".aps/registry.yaml"),
        "entries:\n- destination: pivot/../victim\n",
      );
      const result = command(["registry", "sync", "--root", root]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Refusing to prune path outside studio root/);
      assert.equal(
        readFileSync(path.join(externalDir, "victim"), "utf8"),
        "preserve",
      );
    }
  }
});

test("schema generation preserves established contracts and removes only stale generated schemas", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-schema-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  for (const kind of ["node"] as const) {
    const root = roots[kind];
    assert.equal(command(["init", root]).status, 0);
    writeFileSync(path.join(root, "schema/stale.schema.json"), "{}");
    writeFileSync(path.join(root, "schema/UPPER.SCHEMA.JSON"), "{}");
    writeFileSync(path.join(root, "schema/custom.json"), "{}");
    const result = command(["schema", "write", "--root", root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote 11 schemas/);
    assert.ok(existsSync(path.join(root, "schema/custom.json")));
    assert.ok(!existsSync(path.join(root, "schema/stale.schema.json")));
    assert.equal(
      existsSync(path.join(root, "schema/UPPER.SCHEMA.JSON")),
      process.platform !== "win32",
    );
  }
  assert.deepEqual(
    snapshot(roots.node),
    baselineSnapshot("snapshot-aps-node-schema", roots.node),
  );
});

test("legacy asset inventory preserves established contracts without changing source files", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-legacy-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const reports: Record<string, unknown>[] = [];
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    const source = path.join(root, "legacy");
    assert.equal(command(["init", root]).status, 0);
    mkdirSync(path.join(source, "nested"), { recursive: true });
    writeFileSync(path.join(source, "Widget_model.BLEND"), "blend content");
    writeFileSync(path.join(source, "widget-part.stl"), "mesh content");
    writeFileSync(path.join(source, "notes.txt"), "not an asset");
    writeFileSync(path.join(source, "nested/hidden.stl"), "not inventoried");
    const before = snapshot(source);
    const result = command([
      "assets",
      "legacy-inventory",
      source,
      "--root",
      root,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Inventoried 2 unmanaged assets/);
    assert.deepEqual(snapshot(source), before);
    const report = parse(
      readFileSync(path.join(root, "report/legacy-assets.yaml"), "utf8"),
    ) as Record<string, unknown>;
    assert.ok(!Number.isNaN(Date.parse(String(report.generated_at))));
    delete report.generated_at;
    assert.equal(report.source, source);
    delete report.source;
    reports.push(report);
  }
  assert.deepEqual(reports[0], baseline("legacy-inventory")[0]);
});

test("workflow artifact extensions follow platform case rules", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-artifact-case-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const product = "product-line/line/variant/default/model";
  for (const kind of ["node"] as const) {
    const root = path.join(temp, kind);
    assert.equal(command(["init", root]).status, 0);
    for (const args of [
      ["product-line", "create", "line", "--name", "Line"],
      ["variant", "create", "line", "default", "--name", "Default"],
      ["product", "create", "line", "default", "model", "--name", "Model"],
      ["workflow", "advance", product, "design", "--note", "Design"],
    ]) {
      const result = command([...args, "--root", root]);
      assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
    }
    writeFileSync(path.join(root, product, "source/MODEL.BLEND"), "fixture");
    const result = command([
      "workflow",
      "advance",
      product,
      "review",
      "--note",
      "Review",
      "--approval",
      "test",
      "--root",
      root,
    ]);
    assert.equal(
      result.status,
      process.platform === "win32" ? 0 : 1,
      result.stderr,
    );
  }
});

test("workflow and release gates preserve established contracts without manufacturing print evidence", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-workflow-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  const productPath = "product-line/line/variant/default/model";

  function both(args: string[], expected = 0, message?: RegExp): void {
    for (const kind of ["node"] as const) {
      const result = command([...args, "--root", roots[kind]]);
      assert.equal(
        result.status,
        expected,
        `${kind}: ${result.stdout}\n${result.stderr}`,
      );
      if (message) assert.match(result.stderr, message, kind);
    }
  }
  function writeProduct(relative: string, value: string): void {
    for (const root of Object.values(roots)) {
      const file = path.join(root, productPath, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, value);
    }
  }
  function compare(): void {
    function normalize(data: Record<string, unknown>) {
      const workflow = data["workflow.yaml"] as { history: { at: string }[] };
      for (const event of workflow.history) {
        assert.ok(!Number.isNaN(Date.parse(event.at)));
        event.at = "<timestamp>";
      }
      const release = data["release/v1/release.yaml"] as
        { created_at: string } | undefined;
      if (release) {
        assert.ok(!Number.isNaN(Date.parse(release.created_at)));
        release.created_at = "<timestamp>";
      }
      return data;
    }
    assert.deepEqual(
      normalize(snapshot(path.join(roots.node, productPath))),
      normalize(
        baselineSnapshot(
          "snapshot-aps-node-workflow",
          path.join(roots.node, productPath),
        ),
      ),
    );
  }

  for (const kind of ["node"] as const) {
    assert.equal(command(["init", roots[kind]]).status, 0);
  }
  both(["product-line", "create", "line", "--name", "Line"]);
  both(["variant", "create", "line", "default", "--name", "Default"]);
  both(["product", "create", "line", "default", "model", "--name", "Model"]);
  both(["workflow", "status", productPath]);
  both(
    ["workflow", "advance", productPath, "review", "--note", "skip"],
    1,
    /one stage at a time/,
  );
  both(
    [
      "workflow",
      "print-result",
      productPath,
      "passed",
      "--evidence",
      "print-1",
    ],
    1,
    /only be recorded/,
  );
  both([
    "workflow",
    "advance",
    productPath,
    "design",
    "--note",
    "brief accepted",
  ]);
  both(
    [
      "workflow",
      "advance",
      productPath,
      "review",
      "--note",
      "review",
      "--approval",
      "review-1",
    ],
    1,
    /canonical .blend/,
  );
  writeProduct("source/model.blend", "source");
  both(
    ["workflow", "advance", productPath, "review", "--note", "review"],
    1,
    /approval reference/,
  );
  both([
    "workflow",
    "advance",
    productPath,
    "review",
    "--note",
    "review",
    "--approval",
    "review-1",
  ]);
  both(
    [
      "workflow",
      "advance",
      productPath,
      "print-validation",
      "--note",
      "ready",
      "--approval",
      "review-2",
    ],
    1,
    /two PNG/,
  );
  writeProduct("preview/front.png", "front");
  writeProduct("preview/back.png", "back");
  writeProduct(
    "assets.yaml",
    JSON.stringify({
      product: "model",
      generated_at: "2026-01-01T00:00:00Z",
      assets: [
        {
          path: "source/model.blend",
          kind: "source",
          format: "blend",
          role: "source",
          sha256: "abc",
          size_bytes: 6,
        },
        {
          path: "preview/front.png",
          kind: "preview",
          format: "png",
          role: "preview",
          sha256: "def",
          size_bytes: 5,
          release_eligible: false,
        },
      ],
    }),
  );
  both([
    "workflow",
    "advance",
    productPath,
    "print-validation",
    "--note",
    "ready",
    "--approval",
    "review-2",
  ]);
  both(
    ["release", "create", productPath, "v1", "--approval", "release-1"],
    1,
    /passed physical print/,
  );
  both(
    [
      "workflow",
      "print-result",
      productPath,
      "invalid",
      "--evidence",
      "print-1",
    ],
    1,
    /must be 'passed' or 'failed'/,
  );
  both(
    ["workflow", "print-result", productPath, "passed", "--evidence", "  "],
    1,
    /evidence is required/,
  );
  both([
    "workflow",
    "print-result",
    productPath,
    "failed",
    "--evidence",
    "print-1",
  ]);
  both(
    ["release", "create", productPath, "v1", "--approval", "release-1"],
    1,
    /passed physical print/,
  );
  both([
    "workflow",
    "print-result",
    productPath,
    "passed",
    "--evidence",
    "print-2",
  ]);
  both(
    ["release", "create", productPath, "v1", "--approval", "release-1"],
    1,
    /3MF package/,
  );
  writeProduct("package/model.3mf", "package");
  both([
    "release",
    "create",
    productPath,
    "v1",
    "--approval",
    "release-1",
    "--notes",
    "released",
  ]);
  both(
    ["release", "create", productPath, "v1", "--approval", "release-1"],
    1,
    /immutable/,
  );
  both(["workflow", "status", productPath]);
  compare();
});

test("managed inventory preserves established contracts and preserves authored metadata", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-inventory-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  const productPath = "product-line/line/variant/default/model";
  function both(args: string[], expected = 0): void {
    for (const kind of ["node"] as const) {
      const result = command([...args, "--root", roots[kind]]);
      assert.equal(result.status, expected, `${kind}: ${result.stderr}`);
    }
  }
  function writeProduct(relative: string, value: string): void {
    for (const root of Object.values(roots)) {
      const file = path.join(root, productPath, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, value);
    }
  }
  function manifests() {
    return Object.fromEntries(
      Object.entries(roots).map(([kind, root]) => {
        const manifest = parse(
          readFileSync(path.join(root, productPath, "assets.yaml"), "utf8"),
        );
        assert.ok(!Number.isNaN(Date.parse(manifest.generated_at)));
        manifest.generated_at = "<timestamp>";
        return [kind, manifest];
      }),
    );
  }
  for (const kind of ["node"] as const)
    assert.equal(command(["init", roots[kind]]).status, 0);
  both(["product-line", "create", "line", "--name", "Line"]);
  both(["variant", "create", "line", "default", "--name", "Default"]);
  both(["product", "create", "line", "default", "model", "--name", "Model"]);
  writeProduct("source/model.blend", "blend-data");
  writeProduct("source/model.blend1", "backup");
  writeProduct("source/order/a/child.txt", "nested");
  writeProduct("source/order/a.txt", "sibling");
  writeProduct("source/order/\uE000.txt", "private");
  writeProduct("source/order/\u{10000}.txt", "supplementary");
  writeProduct("export/stl/part.stl", "mesh");
  writeProduct("source/.DS_Store", "ignore");
  writeProduct("release/old/release.yaml", "ignore");
  both(["assets", "inventory", productPath]);
  let actual = manifests();
  assert.deepEqual(actual.node, nextBaseline("managed-inventory"));
  for (const root of Object.values(roots)) {
    const file = path.join(root, productPath, "assets.yaml");
    const data = parse(readFileSync(file, "utf8"));
    const model = data.assets.find(
      (asset: { path: string }) => asset.path === "source/model.blend",
    );
    model.role = "authored role";
    model.source = "source/canonical.blend";
    model.release_eligible = false;
    const backup = data.assets.find(
      (asset: { path: string }) => asset.path === "source/model.blend1",
    );
    backup.release_eligible = true;
    writeFileSync(file, JSON.stringify(data));
  }
  writeProduct("source/model.blend", "changed");
  both(["assets", "inventory", productPath]);
  actual = manifests();
  assert.deepEqual(actual.node, nextBaseline("managed-inventory"));
  const records = (
    actual.node as {
      assets: {
        path: string;
        role: string;
        source?: string;
        release_eligible: boolean;
      }[];
    }
  ).assets;
  assert.equal(
    records.find((item) => item.path === "source/model.blend")?.role,
    "authored role",
  );
  assert.equal(
    records.find((item) => item.path === "source/model.blend")?.source,
    "source/canonical.blend",
  );
  assert.equal(
    records.find((item) => item.path === "source/model.blend1")
      ?.release_eligible,
    false,
  );

  const sha256 = createHash("sha256").update("mesh").digest("hex");
  const group = {
    id: "assembly",
    name: "Assembly",
    revision: "v1",
    description: "",
    package: "package/group.3mf",
    materials: [
      { id: "white", name: "White", color: "#ffffff", material: "pla" },
    ],
    parts: [
      {
        id: "part",
        name: "Part",
        quantity: 1,
        meshes: [{ asset: "export/stl/part.stl", material: "white", sha256 }],
      },
    ],
    layout: { spacing_mm: 6, margin_mm: 5, orientation: "preserve-source" },
  };
  writeProduct(
    "groups.yaml",
    JSON.stringify({ product: "model", groups: [group] }),
  );
  both(["assets", "inventory", productPath], 1);
  const archive = path.join(temp, "group.3mf");
  writeFileSync(
    archive,
    Buffer.from(baseline<string[]>("inventory-package")[0], "base64"),
  );
  for (const root of Object.values(roots)) {
    const target = path.join(root, productPath, "package/group.3mf");
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(archive, target);
  }
  both(["assets", "inventory", productPath]);
  actual = manifests();
  assert.deepEqual(actual.node, nextBaseline("managed-inventory"));
  both(["validate"]);
  writeProduct("export/stl/part.stl", "tampered");
  for (const kind of ["node"] as const) {
    const assetFile = path.join(roots[kind], productPath, "assets.yaml");
    const before = readFileSync(assetFile, "utf8");
    const result = command([
      "assets",
      "inventory",
      productPath,
      "--root",
      roots[kind],
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /mesh checksum mismatch/);
    assert.equal(readFileSync(assetFile, "utf8"), before);
    const validation = command(["validate", "--root", roots[kind]]);
    assert.equal(validation.status, 1, validation.stderr);
    assert.match(validation.stderr, /Size mismatch: export\/stl\/part.stl/);
    assert.match(validation.stderr, /Checksum mismatch: export\/stl\/part.stl/);
  }
  if (process.platform !== "win32") {
    const external = path.join(temp, "external.stl");
    writeFileSync(external, "mesh");
    for (const root of Object.values(roots)) {
      const file = path.join(root, productPath, "export/stl/part.stl");
      unlinkSync(file);
      symlinkSync(external, file);
    }
    both(["assets", "inventory", productPath], 1);
  }
});

test("slicer captures and lists real project settings with matching evidence", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-slice-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  const productPath = "product-line/line/variant/default/model";
  function both(args: string[], expected = 0, message?: RegExp): void {
    for (const kind of ["node"] as const) {
      const result = command([...args, "--root", roots[kind]]);
      assert.equal(result.status, expected, `${kind}: ${result.stderr}`);
      if (message) assert.match(result.stderr, message, kind);
    }
  }
  for (const kind of ["node"] as const)
    assert.equal(command(["init", roots[kind]]).status, 0);
  both(["product-line", "create", "line", "--name", "Line"]);
  both(["variant", "create", "line", "default", "--name", "Default"]);
  both(["product", "create", "line", "default", "model", "--name", "Model"]);
  both(["slicer", "list", productPath]);
  const project = path.join(temp, "project.3mf");
  writeFileSync(
    project,
    Buffer.from(baseline<string[]>("slicer-project")[0], "base64"),
  );
  for (const root of Object.values(roots)) {
    const source = path.join(root, "project.3mf");
    copyFileSync(project, source);
    chmodSync(source, 0o640);
    utimesSync(source, 1_600_000_000, 1_600_000_000);
  }
  both([
    "slicer",
    "capture",
    productPath,
    "project.3mf",
    "--note",
    "First slice",
  ]);
  for (const root of Object.values(roots)) {
    const original = statSync(path.join(root, "project.3mf"));
    const captured = statSync(
      path.join(root, productPath, "slice/0-20mm-standard.3mf"),
    );
    assert.equal(captured.mode & 0o777, original.mode & 0o777);
    assert.equal(captured.mtimeMs, original.mtimeMs);
  }
  both(["slicer", "capture", productPath, "project.3mf"], 1, /already exists/);
  both(["slicer", "list", productPath]);
  both(["validate"]);
  for (const root of Object.values(roots)) {
    const slice = path.join(root, productPath, "slice");
    const profile = parse(
      readFileSync(path.join(slice, "0-20mm-standard.yaml"), "utf8"),
    );
    assert.ok(!Number.isNaN(Date.parse(profile.recorded_at)));
    profile.recorded_at = "<timestamp>";
    writeFileSync(
      path.join(slice, "0-20mm-standard.yaml"),
      JSON.stringify(profile),
    );
  }
  const relative = `${productPath}/slice`;
  assert.deepEqual(
    snapshot(path.join(roots.node, relative)),
    baselineSnapshot(
      "snapshot-aps-node-slice",
      path.join(roots.node, relative),
    ),
  );
  for (const root of Object.values(roots)) {
    const file = path.join(root, productPath, "slice/0-20mm-standard.yaml");
    const profile = JSON.parse(readFileSync(file, "utf8"));
    profile.recorded_at = "2026-01-01T00:00:00Z";
    profile.layer_height_mm = 0.0000123456789;
    writeFileSync(file, JSON.stringify(profile));
  }
  const listings = (["node"] as const).map((kind) =>
    command(["slicer", "list", productPath, "--root", roots[kind]]),
  );
  assert.equal(listings[0].status, 0, listings[0].stderr);
  assert.equal(
    listings[0].stdout,
    baseline<{ stdout: string }[]>("slice-listings").at(-1)?.stdout,
  );
  both(["slicer", "capture", productPath, "project.3mf", "--force"]);
  const plain = path.join(temp, "plain.3mf");
  writeFileSync(
    plain,
    Buffer.from(baseline<string[]>("plain-package")[0], "base64"),
  );
  for (const root of Object.values(roots))
    copyFileSync(plain, path.join(root, "plain.3mf"));
  both(
    ["slicer", "capture", productPath, "plain.3mf"],
    1,
    /not a saved slicer project/,
  );
});

test("group packaging preserves geometry, plates, colors, and immutable outputs", async (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-packages-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  const productPath = "product-line/line/variant/default/model";
  function both(args: string[], expected = 0, message?: RegExp): void {
    for (const kind of ["node"] as const) {
      const result = command([...args, "--root", roots[kind]]);
      assert.equal(result.status, expected, `${kind}: ${result.stderr}`);
      if (message) assert.match(result.stderr, message, kind);
    }
  }
  for (const kind of ["node"] as const)
    assert.equal(command(["init", roots[kind]]).status, 0);
  both(["product-line", "create", "line", "--name", "Line"]);
  both(["variant", "create", "line", "default", "--name", "Default"]);
  both(["product", "create", "line", "default", "model", "--name", "Model"]);
  function tetra(size: number[], origin: number[]): Buffer {
    const points = [
      origin,
      [origin[0] + size[0], origin[1], origin[2]],
      [origin[0], origin[1] + size[1], origin[2]],
      [origin[0], origin[1], origin[2] + size[2]],
    ];
    const faces = [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ];
    const result = Buffer.alloc(84 + 50 * faces.length);
    result.writeUInt32LE(faces.length, 80);
    for (let index = 0; index < faces.length; index++)
      for (let vertex = 0; vertex < 3; vertex++)
        for (let axis = 0; axis < 3; axis++)
          result.writeFloatLE(
            points[faces[index][vertex]][axis],
            84 + 50 * index + 12 + vertex * 12 + axis * 4,
          );
    return result;
  }
  const meshes = {
    "export/stl/body.stl": tetra([140, 160, 10], [12, 14, -5]),
    "export/stl/color.stl": tetra([10, 10, 3], [15, 17, -4]),
    "export/stl/pin.stl": tetra([2, 2, 20], [0, 0, 0]),
  };
  const digest = (file: keyof typeof meshes) =>
    createHash("sha256").update(meshes[file]).digest("hex");
  const group = {
    id: "folding-corner",
    name: "Foundry Corner",
    revision: "v1",
    description: "Complete corner and service pin",
    package: "package/v1/foundry-corner.3mf",
    materials: [
      { id: "stone", name: "Ash Stone", color: "#BBBBBB" },
      { id: "metal", name: "Charcoal", color: "#222222" },
    ],
    parts: [
      {
        id: "wall",
        name: "Wall",
        quantity: 2,
        meshes: [
          {
            asset: "export/stl/body.stl",
            material: "stone",
            sha256: digest("export/stl/body.stl"),
          },
          {
            asset: "export/stl/color.stl",
            material: "metal",
            sha256: digest("export/stl/color.stl"),
          },
        ],
      },
      {
        id: "pin",
        name: "Service Pin",
        meshes: [
          {
            asset: "export/stl/pin.stl",
            material: "metal",
            sha256: digest("export/stl/pin.stl"),
          },
        ],
      },
    ],
  };
  for (const root of Object.values(roots)) {
    const printerPath = path.join(root, "config/printer/generic-fdm.yaml");
    const printer = parse(readFileSync(printerPath, "utf8"));
    printer.supports_multi_material = true;
    printer.max_material_slots = 4;
    writeFileSync(printerPath, JSON.stringify(printer));
    const product = path.join(root, productPath);
    for (const [file, contents] of Object.entries(meshes)) {
      const target = path.join(product, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    writeFileSync(
      path.join(product, "groups.yaml"),
      JSON.stringify({ product: "model", groups: [group] }),
    );
  }
  both(
    ["assets", "package", productPath, "--group", "missing"],
    1,
    /No asset groups found/,
  );
  const targets = Object.values(roots).map((root) =>
    path.join(root, productPath, group.package),
  );
  function writeGroups(groups: unknown[]): void {
    for (const root of Object.values(roots))
      writeFileSync(
        path.join(root, productPath, "groups.yaml"),
        JSON.stringify({ product: "model", groups }),
      );
  }
  const invalidGroups: ((candidate: typeof group) => void)[] = [
    (candidate) => {
      candidate.name = "  ";
    },
    (candidate) => {
      candidate.parts[0].quantity = 1.5;
    },
    (candidate) => {
      candidate.parts[0].meshes[0].material = "unknown";
    },
    (candidate) => {
      candidate.parts[0].meshes[0].asset = "../escape.stl";
    },
    (candidate) => {
      candidate.package = "source/output.3mf";
    },
    (candidate) => {
      candidate.parts.push(candidate.parts[0]);
    },
    (candidate) => {
      candidate.parts[0].meshes.push(candidate.parts[0].meshes[0]);
    },
  ];
  for (const mutate of invalidGroups) {
    const invalid = structuredClone(group);
    mutate(invalid);
    writeGroups([invalid]);
    both(["assets", "package", productPath], 1);
    for (const target of targets) assert.equal(existsSync(target), false);
  }
  writeGroups([group, group]);
  both(["assets", "package", productPath], 1);
  const badMesh = Buffer.from("solid ascii STL");
  const badGroup = structuredClone(group);
  badGroup.parts[0].meshes[0].sha256 = createHash("sha256")
    .update(badMesh)
    .digest("hex");
  for (const root of Object.values(roots))
    writeFileSync(path.join(root, productPath, "export/stl/body.stl"), badMesh);
  writeGroups([badGroup]);
  both(["assets", "package", productPath], 1, /binary millimeter STL/);
  for (const root of Object.values(roots))
    writeFileSync(
      path.join(root, productPath, "export/stl/body.stl"),
      meshes["export/stl/body.stl"],
    );
  for (const target of targets) assert.equal(existsSync(target), false);
  writeGroups([{ ...group, layout: { margin_mm: 100 } }]);
  both(["assets", "package", productPath], 1, /cannot fit/);
  for (const target of targets) assert.equal(existsSync(target), false);
  writeGroups([
    {
      ...group,
      materials: [
        { ...group.materials[0], material: "nylon" },
        group.materials[1],
      ],
    },
  ]);
  both(["assets", "package", productPath], 1, /unsupported materials/);
  for (const root of Object.values(roots)) {
    const printerPath = path.join(root, "config/printer/generic-fdm.yaml");
    const printer = JSON.parse(readFileSync(printerPath, "utf8"));
    printer.max_material_slots = 1;
    writeFileSync(printerPath, JSON.stringify(printer));
  }
  writeGroups([group]);
  both(["assets", "package", productPath], 1, /material slots/);
  for (const root of Object.values(roots)) {
    const printerPath = path.join(root, "config/printer/generic-fdm.yaml");
    const printer = JSON.parse(readFileSync(printerPath, "utf8"));
    printer.max_material_slots = 4;
    writeFileSync(printerPath, JSON.stringify(printer));
  }
  writeGroups([
    group,
    {
      ...group,
      id: "oversize",
      package: "package/v1/oversize.3mf",
      layout: { margin_mm: 100 },
    },
  ]);
  both(["assets", "package", productPath], 1, /cannot fit/);
  for (const root of Object.values(roots)) {
    const packageRoot = path.join(root, productPath, "package");
    assert.ok(
      !readdirSync(packageRoot).some((name) => name.startsWith(".aps-groups-")),
    );
  }
  for (const target of targets) assert.equal(existsSync(target), false);
  writeGroups([group]);
  both(["assets", "package", productPath, "--group", "folding-corner"]);
  const expected = baseline<Record<string, unknown>[]>("assembly-package")[0];
  const file = path.join(roots.node, productPath, group.package);
  const actual: Record<string, unknown> = {};
  const entries = await archiveEntries(file);
  assert.deepEqual(entries.sort(), Object.keys(expected).sort());
  for (const name of entries) {
    const bytes = await readArchiveEntry(file, name);
    const value = bytes.toString("utf8");
    actual[name] =
      /\.(xml|rels|model)$/.test(name) || name.endsWith("model_settings.config")
        ? xmlTree(value)
        : JSON.parse(value, (_key, value) =>
            typeof value === "number" && Object.is(value, -0) ? 0 : value,
          );
  }
  assert.deepEqual(actual, expected);
  both(["assets", "inventory", productPath]);
  both(["validate"]);
  both(["assets", "package", productPath], 1, /Refusing to overwrite/);
});

test("interactive configuration preserves established contracts presets and confirmation behavior", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-config-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  for (const kind of ["node"] as const) {
    const root = roots[kind];
    assert.equal(command(["init", root]).status, 0);
    assert.equal(
      command([
        "product-line",
        "create",
        "line",
        "--name",
        "Line",
        "--root",
        root,
      ]).status,
      0,
    );
    const answers =
      [
        "Maker Studio",
        "large-corexy",
        "Large CoreXY",
        "3__00",
        "\u0663_\u0660\u0660",
        "300",
        "320",
        "0.6",
        "1.8",
        "1.0",
        "y",
        "0__4",
        "\u0660_\u0664",
        "Bambu Studio",
        "3mf",
        "pla,asa",
      ].join("\n") + "\n";
    const result = command(["config", "--root", root, "--yes"], {}, answers);
    assert.equal(
      result.status,
      0,
      `${kind}: ${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /3__00.*not a valid float/);
    assert.match(result.stdout, /0__4.*not a valid int/);
    const before = snapshot(root);
    const cancelled = command(
      ["config", "--root", root],
      {},
      "\n".repeat(14) + "n\n",
    );
    assert.equal(
      cancelled.status,
      0,
      `${kind}: ${cancelled.stdout}\n${cancelled.stderr}`,
    );
    assert.match(cancelled.stdout, /Configuration unchanged/);
    assert.deepEqual(snapshot(root), before);
    for (const material of ["unobtainium", "constructor"]) {
      const invalid = command(
        ["config", "--root", root, "--yes"],
        {},
        "\n".repeat(13) + `${material}\n`,
      );
      assert.equal(
        invalid.status,
        1,
        `${kind}: ${invalid.stdout}\n${invalid.stderr}`,
      );
      assert.match(invalid.stderr, /Unsupported material/);
      assert.deepEqual(snapshot(root), before);
    }
  }
  assert.deepEqual(
    snapshot(roots.node),
    baselineSnapshot("snapshot-aps-node-config", roots.node, -1),
  );
});

test("interactive float inputs preserve established contracts, including non-finite values", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-floats-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const [index, [dimension, nozzle]] of [
    ["inf", ""],
    ["nan", ""],
    ["1e9999", ""],
    ["-inf", ""],
    ["", "nan"],
  ].entries()) {
    const results = [];
    for (const kind of ["node"] as const) {
      const root = path.join(temp, `${index}-${kind}`);
      assert.equal(command(["init", root]).status, 0);
      const answers =
        ["", "", "", dimension, "", "", nozzle, "", "", "", "", "", ""].join(
          "\n",
        ) + "\n";
      const result = command(["config", "--root", root, "--yes"], {}, answers);
      results.push({ status: result.status, files: snapshot(root) });
    }
    const answers =
      ["", "", "", dimension, "", "", nozzle, "", "", "", "", "", ""].join(
        "\n",
      ) + "\n";
    const expectedStatus = baseline<{ input: string; status: number }[]>(
      "config-status",
    ).find((item) => item.input === answers);
    assert.ok(expectedStatus);
    assert.equal(results[0].status, expectedStatus.status);
    assert.deepEqual(
      results[0].files,
      baselineSnapshot(
        "snapshot-aps-node-floats",
        path.join(temp, `${index}-node`),
      ),
      `${dimension}, ${nozzle}`,
    );
  }
});

test("guided menus and missing arguments work on a real terminal", async (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-tty-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  const tty = (args: string[], input: string) =>
    terminalCommand([process.execPath, cli, ...args], input, repo);
  for (const kind of ["node"] as const) {
    const unknown = await tty(["constructor"], "");
    assert.equal(
      unknown.status,
      2,
      `${kind}: ${unknown.stdout}\n${unknown.stderr}`,
    );
    assert.match(unknown.stdout, /No such command/);
    const init = await tty([], `init\n${roots[kind]}\nGuided Studio\nn\nn\n`);
    assert.equal(init.status, 0, `${kind}: ${init.stdout}\n${init.stderr}`);
    assert.match(init.stdout, /choose a command/);
    assert.match(init.stdout, /Initialize a new AI Product Studio directory/);
    const retry = await tty(
      [],
      `init\n${path.join(roots[kind], "nested-studio")}\nNested Studio\n1\nn\nn\n`,
    );
    assert.equal(retry.status, 0, `${kind}: ${retry.stdout}\n${retry.stderr}`);
    assert.match(retry.stdout, /Error: invalid input/);
    const nested = await tty(
      [],
      `product-line\n1\nwinter\nWinter\nSnowy\n${roots[kind]}\nn\nn\n`,
    );
    assert.equal(
      nested.status,
      0,
      `${kind}: ${nested.stdout}\n${nested.stderr}`,
    );
    assert.match(nested.stdout, /Description/);
    const partial = await tty(
      ["product-line", "create", "spring", "--root", roots[kind]],
      "Spring\n",
    );
    assert.equal(
      partial.status,
      0,
      `${kind}: ${partial.stdout}\n${partial.stderr}`,
    );
    assert.match(partial.stdout, /Name \(--name\)/);
    const option = await tty(
      ["product-line", "create", "autumn", "--root", roots[kind], "--name"],
      "Autumn\n",
    );
    assert.equal(
      option.status,
      0,
      `${kind}: ${option.stdout}\n${option.stderr}`,
    );
    assert.match(option.stdout, /Name \(--name\)/);
    const invalid = await tty(["product-line", "create", "--unknown"], "");
    assert.equal(
      invalid.status,
      2,
      `${kind}: ${invalid.stdout}\n${invalid.stderr}`,
    );
    assert.doesNotMatch(invalid.stdout, /Aborted|choose a command/);
    const invalidStage = await tty(
      [
        "workflow",
        "advance",
        "missing",
        "--note",
        "note",
        "--root",
        roots[kind],
      ],
      "not-a-stage\nreview\n",
    );
    assert.equal(
      invalidStage.status,
      1,
      `${kind}: ${invalidStage.stdout}\n${invalidStage.stderr}`,
    );
    assert.match(invalidStage.stdout, /not-a-stage.*not one of/);
    const eof = await tty([], "\u0004");
    assert.equal(eof.status, 1, `${kind}: ${eof.stdout}\n${eof.stderr}`);
    assert.match(eof.stdout, /Aborted/);
    const exit = await tty([], "not-a-command\n0\n");
    assert.equal(exit.status, 0, `${kind}: ${exit.stdout}\n${exit.stderr}`);
    assert.match(exit.stdout, /Choose a command name or its number/);
    const help = await tty(["product", "create", "--help"], "");
    assert.equal(help.status, 0, `${kind}: ${help.stdout}\n${help.stderr}`);
    assert.doesNotMatch(help.stdout, /choose a command/);
  }
  assert.deepEqual(
    snapshot(roots.node),
    baselineSnapshot("snapshot-aps-node-tty", roots.node),
  );
});

test("YAML 1.1 scalars and numeric manifest coercion retain established behavior", (t) => {
  const temp = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "aps-node-yaml-")),
  );
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const roots = {
    node: path.join(temp, "node"),
  };
  for (const kind of ["node"] as const) {
    const root = roots[kind];
    assert.equal(command(["init", root, "--name", "yes"]).status, 0);
    assert.equal(
      command([
        "product-line",
        "create",
        "line",
        "--name",
        "on",
        "--root",
        root,
      ]).status,
      0,
    );
    assert.equal(
      command([
        "variant",
        "create",
        "line",
        "variant",
        "--name",
        "no",
        "--root",
        root,
      ]).status,
      0,
    );
    assert.equal(
      command([
        "product",
        "create",
        "line",
        "variant",
        "model",
        "--name",
        "off",
        "--root",
        root,
      ]).status,
      0,
    );
    for (const oracle of ["node"] as const) {
      const validation = command(["validate", "--root", root]);
      assert.equal(
        validation.status,
        0,
        `${kind} scaffold in ${oracle}: ${validation.stderr}`,
      );
    }
    const product = path.join(root, "product-line/line/variant/variant/model");
    const manifest = path.join(product, "product.yaml");
    const data = parse(readFileSync(manifest, "utf8"));
    data.dimensions_mm = { width: "12.5" };
    writeFileSync(manifest, JSON.stringify(data));
    const printer = path.join(root, "config/printer/generic-fdm.yaml");
    const printerData = parse(readFileSync(printer, "utf8"));
    printerData.nozzle_diameter_mm = "0.4";
    printerData.supports_multi_material = "false";
    printerData.max_material_slots = "1.0";
    writeFileSync(printer, JSON.stringify(printerData));
    const workflow = path.join(product, "workflow.yaml");
    writeFileSync(
      workflow,
      "product: model\nhistory:\n  - stage: brief\n    at: 2026-01-01T00:00:00Z\n    note: start\n",
    );
    for (const oracle of ["node"] as const) {
      const validation = command(["validate", "--root", root]);
      assert.equal(
        validation.status,
        0,
        `${kind} files in ${oracle}: ${validation.stderr}`,
      );
    }
    data.slug = "model\n";
    writeFileSync(manifest, JSON.stringify(data));
    for (const oracle of ["node"] as const) {
      const validation = command(["validate", "--root", root]);
      assert.equal(validation.status, 1, `${kind} invalid slug in ${oracle}`);
    }
  }
});
