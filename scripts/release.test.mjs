import assert from "node:assert/strict";
import test from "node:test";
import { releaseVersion } from "./release-version.mjs";
import { publishToolchain } from "./publish-toolchain.mjs";

test("main releases are stable, unique per run, and repeatable on retries", () => {
  assert.equal(releaseVersion("0.1.0", "1"), "0.1.0");
  assert.equal(releaseVersion("0.1.0", "5"), "0.1.4");
  assert.equal(releaseVersion("0.2.3", "5"), "0.2.7");
  assert.equal(releaseVersion("0.1.0", "5"), releaseVersion("0.1.0", "5"));
  for (const [base, run] of [
    ["0.1.0-beta.1", "1"],
    ["01.1.0", "1"],
    ["0.1.0", "0"],
    ["0.1.0", "NaN"],
    ["0.1.0", "9007199254740992"],
  ])
    assert.throws(() => releaseVersion(base, run));
});

const commit = "a".repeat(40);
const manifest = {
  name: "@example/toolchain",
  version: "0.1.0",
  apsReleaseCommit: commit,
};
const missing = { status: 1, stdout: '{"error":{"code":"E404"}}', stderr: "" };

test("new releases publish the tested archive and retries preserve immutable versions", () => {
  const calls = [];
  publishToolchain("verified.tgz", manifest, commit, (command, args) => {
    calls.push([command, args]);
    return calls.length === 1 ? missing : { status: 0 };
  });
  assert.deepEqual(calls[1], [
    "npm",
    ["publish", "verified.tgz", "--registry=https://npm.pkg.github.com"],
  ]);
  let lookups = 0;
  publishToolchain("verified.tgz", manifest, commit, () => {
    lookups++;
    return { status: 0, stdout: JSON.stringify(manifest) };
  });
  assert.equal(lookups, 1);
});

test("publication refuses version collisions, lookup failures, and publishing errors", () => {
  assert.throws(
    () =>
      publishToolchain("verified.tgz", manifest, commit, () => ({
        status: 0,
        stdout: JSON.stringify({ apsReleaseCommit: "b".repeat(40) }),
      })),
    /different commit/,
  );
  assert.throws(
    () =>
      publishToolchain("verified.tgz", manifest, commit, () => ({
        status: 1,
        stdout: '{"error":{"code":"E401"}}',
        stderr: "unauthorized",
      })),
    /Cannot check/,
  );
  let attempts = 0;
  assert.throws(
    () =>
      publishToolchain("verified.tgz", manifest, commit, () =>
        ++attempts === 1 ? missing : { status: 1, stderr: "denied" },
      ),
    /publication failed/,
  );
  assert.throws(
    () => publishToolchain("verified.tgz", manifest, "b".repeat(40)),
    /matching release commit/,
  );
});
