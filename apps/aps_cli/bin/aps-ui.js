#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

try {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      port: { type: "string", default: "3000" },
      hostname: { type: "string", default: "127.0.0.1" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: aps-ui [--root PATH] [--port 3000] [--hostname 127.0.0.1]",
    );
  } else {
    const root = path.resolve(
      values.root ?? process.env.APS_STUDIO_ROOT ?? process.cwd(),
    );
    if (!statSync(path.join(root, "config/studio.yaml")).isFile())
      throw new Error(`Not a studio: ${root}`);
    const ui = fileURLToPath(new URL("../dist/ui/", import.meta.url));
    if (!existsSync(path.join(ui, ".next/BUILD_ID")))
      throw new Error(
        "Packaged UI is missing; build the toolchain before using aps-ui.",
      );
    const require = createRequire(import.meta.url);
    const child = spawn(
      process.execPath,
      [
        require.resolve("next/dist/bin/next"),
        "start",
        "--hostname",
        values.hostname,
        "--port",
        values.port,
      ],
      {
        cwd: ui,
        stdio: "inherit",
        env: {
          ...process.env,
          APS_STUDIO_ROOT: root,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => child.kill(signal));
    child.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
    });
  }
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
