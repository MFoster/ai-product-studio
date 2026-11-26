import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const registry = "https://npm.pkg.github.com";

export function publishToolchain(archive, manifest, commit, run = spawnSync) {
  if (
    !archive ||
    !/^[a-f0-9]{40,64}$/.test(commit ?? "") ||
    manifest.apsReleaseCommit !== commit
  )
    throw new Error(
      "Publishing requires an archive and matching release commit metadata.",
    );
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const result = run(
    "npm",
    [
      "view",
      `${manifest.name}@${manifest.version}`,
      "--json",
      `--registry=${registry}`,
    ],
    options,
  );
  if (result.error) throw result.error;
  if (result.status === 0) {
    const published = JSON.parse(result.stdout);
    if (published.apsReleaseCommit !== commit)
      throw new Error(
        "The release version already belongs to a different commit.",
      );
    return "Package already published from this commit; completing the GitHub release.";
  }
  const failure = JSON.parse(result.stdout || "{}");
  if (failure.error?.code !== "E404")
    throw new Error(
      `Cannot check published package: ${result.stderr || result.stdout}`,
    );
  const publication = run(
    "npm",
    ["publish", archive, `--registry=${registry}`],
    options,
  );
  if (publication.error) throw publication.error;
  if (publication.status !== 0)
    throw new Error(
      `Package publication failed: ${publication.stderr || publication.stdout}`,
    );
  return `Published ${manifest.name}@${manifest.version}.`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../apps/aps_cli/package.json", import.meta.url),
      "utf8",
    ),
  );
  console.log(
    publishToolchain(process.argv[2], manifest, process.env.GITHUB_SHA),
  );
}
