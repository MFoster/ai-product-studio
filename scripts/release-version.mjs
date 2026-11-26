import path from "node:path";
import { fileURLToPath } from "node:url";

export function releaseVersion(base, run) {
  const component = "(?:0|[1-9][0-9]*)";
  if (
    typeof base !== "string" ||
    !new RegExp(`^${component}\\.${component}\\.${component}$`).test(base) ||
    !/^[1-9][0-9]*$/.test(String(run))
  )
    throw new Error(
      "Expected a stable base version and positive workflow run number.",
    );
  const [major, minor, patch] = base.split(".").map(Number);
  const number = Number(run);
  const next = patch + number - 1;
  if (![major, minor, patch, number, next].every(Number.isSafeInteger))
    throw new Error("Release version exceeds the safe integer range.");
  return `${major}.${minor}.${next}`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(releaseVersion(process.argv[2], process.argv[3]));
