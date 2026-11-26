import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "packages/contracts");
const destination = path.join(
  root,
  "apps/aps_cli/node_modules/@mfoster/aps-contracts",
);
if (existsSync(destination)) {
  if (
    lstatSync(destination).isSymbolicLink() ||
    JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"))
      .apsContractBundle !== true
  )
    throw new Error(
      `Refusing to replace an unmanaged dependency: ${destination}`,
    );
  rmSync(destination, { recursive: true });
}
if (!process.argv.includes("--clean")) {
  mkdirSync(destination, { recursive: true });
  const manifest = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf8"),
  );
  for (const entry of manifest.files)
    cpSync(path.join(source, entry), path.join(destination, entry), {
      recursive: true,
    });
  writeFileSync(
    path.join(destination, "package.json"),
    `${JSON.stringify({ ...manifest, apsContractBundle: true }, null, 2)}\n`,
  );
}
