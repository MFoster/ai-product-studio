import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = path.join(root, "apps/aps_cli");
const ui = path.join(root, "apps/engineer_ui");
const capabilities = path.join(app, "capabilities");
const output = path.join(app, "dist/ui");
const require = createRequire(path.join(ui, "package.json"));
const manifest = JSON.parse(
  readFileSync(path.join(app, "package.json"), "utf8"),
);
for (const name of ["next", "react", "react-dom"]) {
  const version = require(`${name}/package.json`).version;
  if (manifest.dependencies[name] !== version)
    throw new Error(
      `Packaged ${name} must pin the UI build's exact runtime version ${version}.`,
    );
}
const agents = [
  "blender-3d-print-expert",
  "blender-product-photographer",
  "product-line-curator",
  "studio-orchestrator",
];
const skills = [
  "3mf-release-packaging",
  "ams-multipart-color",
  "bambu-plate-planning",
  "calibration-coupon-design",
  "catalog-render-and-review",
  "curved-surface-relief",
  "fdm-detail-design",
  "fit-tolerance-engineering",
  "mesh-printability-audit",
  "model-repair-from-stl",
  "organic-character-detail",
  "procedural-decoration-system",
  "support-free-orientation",
  "test-print-feedback-loop",
  "threaded-container-mechanism",
  "wall-strength-engineering",
  ...[
    "analyze",
    "checklist",
    "clarify",
    "constitution",
    "converge",
    "implement",
    "plan",
    "specify",
    "tasks",
  ].map((name) => `speckit-${name}`),
];

const result = spawnSync("npm", ["run", "build", "--workspace=engineer_ui"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

rmSync(capabilities, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });
mkdirSync(capabilities, { recursive: true });
for (const name of agents)
  cpSync(
    path.join(root, ".github/agents", `${name}.agent.md`),
    path.join(capabilities, ".github/agents", `${name}.agent.md`),
    { recursive: true },
  );
for (const name of skills)
  cpSync(
    path.join(root, ".github/skills", name),
    path.join(capabilities, ".github/skills", name),
    { recursive: true, dereference: false },
  );
for (const name of ["blender", "manifests", "product-assets"])
  cpSync(
    path.join(root, ".github/instructions", `${name}.instructions.md`),
    path.join(capabilities, ".github/instructions", `${name}.instructions.md`),
    { recursive: true },
  );
for (const name of ["scripts", "templates"])
  cpSync(
    path.join(root, ".specify", name),
    path.join(capabilities, ".specify", name),
    {
      recursive: true,
      filter: (source) =>
        !source
          .split(path.sep)
          .some((part) => part === "__pycache__" || part.endsWith(".pyc")),
    },
  );
for (const name of [".gitignore", "UPSTREAM-LICENSE"])
  cpSync(
    path.join(root, ".specify", name),
    path.join(capabilities, ".specify", name),
  );
for (const relative of [
  "agent/product-specialist.agent.md",
  "skill/product-design/SKILL.md",
  ...[
    "product_setup",
    "catalog_photography",
    "group_photography",
    "package_3mf",
    "package_bambu_3mf",
  ].map((name) => `blender/${name}.py`),
])
  cpSync(
    path.join(root, "template", relative),
    path.join(capabilities, "template", relative),
    { recursive: true },
  );
mkdirSync(path.join(capabilities, "seed"), { recursive: true });
cpSync(
  path.join(root, ".specify/memory/constitution.md"),
  path.join(capabilities, "seed/constitution.md"),
);
cpSync(
  path.join(root, ".specify/integration.json"),
  path.join(capabilities, "seed/integration.json"),
);
cpSync(path.join(ui, ".next"), path.join(output, ".next"), {
  recursive: true,
  filter: (source) =>
    ![
      "cache",
      "dev",
      "types",
      "trace",
      "trace-build",
      "diagnostics",
      "node_modules",
    ].includes(
      path.relative(path.join(ui, ".next"), source).split(path.sep)[0],
    ),
});
if (existsSync(path.join(ui, "public")))
  cpSync(path.join(ui, "public"), path.join(output, "public"), {
    recursive: true,
  });
const serverManifest = JSON.parse(
  readFileSync(path.join(output, ".next/required-server-files.json"), "utf8"),
);
serverManifest.appDir = ".";
serverManifest.relativeAppDir = ".";
serverManifest.config.outputFileTracingRoot = ".";
serverManifest.config.repoRoot = ".";
serverManifest.config.configFileName = "next.config.mjs";
if (serverManifest.config.turbopack) serverManifest.config.turbopack.root = ".";
const portableManifest = JSON.stringify(serverManifest, null, 2);
writeFileSync(
  path.join(output, ".next/required-server-files.json"),
  portableManifest,
);
writeFileSync(
  path.join(output, ".next/required-server-files.js"),
  `self.__SERVER_FILES_MANIFEST=${portableManifest}`,
);
const config = ts.transpileModule(
  readFileSync(path.join(ui, "next.config.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
writeFileSync(path.join(output, "next.config.mjs"), config);
writeFileSync(
  path.join(output, "package.json"),
  '{"type":"module","private":true}\n',
);
for (const name of ["README.md", "LICENSE"])
  cpSync(path.join(root, name), path.join(app, name));
console.log(
  "Built toolchain with explicitly selected generic capabilities and production UI.",
);
