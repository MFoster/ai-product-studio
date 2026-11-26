import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandWindowsUserPath(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  const separator = value.search(/[\\/]/);
  const username = value.slice(1, separator === -1 ? undefined : separator);
  const suffix = separator === -1 ? "" : value.slice(separator + 1);
  let home =
    env.USERPROFILE !== undefined
      ? env.USERPROFILE
      : env.HOMEPATH !== undefined
        ? path.win32.join(env.HOMEDRIVE ?? "", env.HOMEPATH)
        : undefined;
  if (home === undefined)
    throw new Error("Could not determine home directory.");
  if (username && username !== env.USERNAME) {
    if (env.USERNAME !== path.win32.basename(home))
      throw new Error("Could not determine home directory.");
    home = path.win32.join(path.win32.dirname(home), username);
  }
  return path.win32.join(home, suffix);
}

export function expandUserPath(value: string): string {
  if (!value.startsWith("~")) return value;
  if (process.platform === "win32")
    return expandWindowsUserPath(value, process.env);
  const separator = value.indexOf("/");
  const username = value.slice(1, separator === -1 ? undefined : separator);
  const suffix = separator === -1 ? "" : value.slice(separator + 1);
  if (!username) return suffix ? `${os.homedir()}/${suffix}` : os.homedir();
  const user = os.userInfo();
  if (username === user.username)
    return suffix ? `${user.homedir}/${suffix}` : user.homedir;
  let home: string | undefined;
  if (process.platform === "darwin") {
    const result = spawnSync("/usr/bin/id", ["-P", username], {
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status === 0) home = result.stdout.trim().split(":")[8];
  } else {
    const executable = ["/usr/bin/getent", "/bin/getent"].find(existsSync);
    if (executable) {
      const result = spawnSync(executable, ["passwd", username], {
        encoding: "utf8",
      });
      if (result.error) throw result.error;
      if (result.status === 0) home = result.stdout.trim().split(":")[5];
    }
  }
  if (!home) throw new Error("Could not determine home directory.");
  return suffix ? `${home}/${suffix}` : home;
}

export function normalizeRelativePath(
  value: string,
  platform: path.PlatformPath = path,
): string {
  const normalized = path.posix.normalize(value.split(platform.sep).join("/"));
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export function unsafeRelativePath(
  value: string,
  platform: path.PlatformPath = path,
): boolean {
  return (
    platform.isAbsolute(value) ||
    value.split(platform.sep === "\\" ? /[\\/]/ : /\//).includes("..")
  );
}

export function matchesPathSuffix(
  name: string,
  suffix: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32"
    ? name.toLowerCase().endsWith(suffix.toLowerCase())
    : name.endsWith(suffix);
}

export function comparePaths(
  left: string,
  right: string,
  platform: path.PlatformPath = path,
): number {
  const [first, second] = [left, right].map((value) =>
    platform
      .normalize(value)
      .split(platform.sep)
      .map((part) => (platform.sep === "\\" ? part.toLowerCase() : part)),
  );
  for (let index = 0; index < Math.min(first.length, second.length); index++) {
    const a = Array.from(
      first[index],
      (character) => character.codePointAt(0) ?? 0,
    );
    const b = Array.from(
      second[index],
      (character) => character.codePointAt(0) ?? 0,
    );
    for (let offset = 0; offset < Math.min(a.length, b.length); offset++) {
      const difference = a[offset] - b[offset];
      if (difference) return difference;
    }
    if (a.length !== b.length) return a.length - b.length;
  }
  return first.length - second.length;
}

export function relativePosix(
  root: string,
  target: string,
  platform: path.PlatformPath = path,
): string {
  return platform.relative(root, target).split(platform.sep).join("/");
}

export function joinRoot(root: string, value: string): string {
  return path.isAbsolute(value) ? value : `${root}${path.sep}${value}`;
}

export function resolvePath(input: string): string {
  if (process.platform !== "win32") {
    const resolveParts = (
      start: string,
      parts: string[],
      active: Set<string>,
    ): string => {
      let current = start;
      for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
          current = path.dirname(current);
          continue;
        }
        const candidate = path.join(current, part);
        let symlink = false;
        try {
          symlink = lstatSync(candidate).isSymbolicLink();
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            !["ENOENT", "ENOTDIR", "ELOOP", "EACCES", "EPERM"].includes(
              String(error.code),
            )
          )
            throw error;
        }
        if (!symlink) {
          current = candidate;
          continue;
        }
        if (active.has(candidate)) {
          current = candidate;
          continue;
        }
        const target = readlinkSync(candidate);
        const nextActive = new Set(active);
        nextActive.add(candidate);
        current = resolveParts(
          path.isAbsolute(target) ? path.parse(target).root : current,
          target.split(path.sep),
          nextActive,
        );
      }
      return current;
    };
    const base = path.isAbsolute(input)
      ? path.parse(input).root
      : realpathSync(process.cwd());
    return resolveParts(base, input.split(path.sep), new Set());
  }
  const absolute = path.resolve(input);
  let current = absolute;
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...missing);
}

export function requireSlug(value: string, label: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(value)) {
    throw new Error(`${label} must use lowercase kebab-case: '${value}'`);
  }
  return value;
}
