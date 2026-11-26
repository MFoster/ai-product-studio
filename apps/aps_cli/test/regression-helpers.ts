import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { open, type Entry } from "yauzl";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cursors = new Map<string, number>();

export function baseline<T = unknown[]>(name: string, root = repo): T {
  const content = readFileSync(
    new URL(`./fixtures/baseline/${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(content, (_key, value: unknown) => {
    if (typeof value === "string")
      return value.replaceAll("<ROOT>", root).replaceAll("<REPO>", repo);
    if (value !== null && typeof value === "object" && "$number" in value) {
      assert.ok(
        ["Infinity", "-Infinity", "NaN"].includes(String(value.$number)),
      );
      return Number(value.$number);
    }
    return value;
  }) as T;
}

export function nextBaseline(name: string, root = repo): unknown {
  const records = baseline(name, root);
  const index = cursors.get(name) ?? 0;
  assert.ok(
    index < records.length,
    `Missing baseline record: ${name}[${index}]`,
  );
  cursors.set(name, index + 1);
  return records[index];
}

export function baselineSnapshot(
  name: string,
  root: string,
  index?: number,
): Record<string, unknown> {
  const value =
    index === undefined
      ? nextBaseline(name, root)
      : baseline(name, root).at(index);
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

interface CompletionRecord {
  args: string[];
  words: string;
  mode: string;
  fishAction: string;
  status: number;
  stdout: string;
}

export function completionBaseline(
  args: string[],
  env: NodeJS.ProcessEnv,
  root: string,
): CompletionRecord {
  const record = baseline<CompletionRecord[]>("completion", root).find(
    (item) =>
      JSON.stringify(item.args) === JSON.stringify(args) &&
      item.words === (env.COMP_WORDS ?? env._TYPER_COMPLETE_ARGS ?? "") &&
      item.mode === (env._APS_COMPLETE ?? "") &&
      item.fishAction === (env._TYPER_COMPLETE_FISH_ACTION ?? ""),
  );
  assert.ok(
    record,
    `Missing completion baseline: ${JSON.stringify({ args, env })}`,
  );
  return record;
}

export async function archiveEntries(file: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    open(file, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) {
        reject(error ?? new Error(`Unable to open ${file}`));
        return;
      }
      const names: string[] = [];
      archive.on("error", reject);
      archive.on("entry", (entry: Entry) => {
        names.push(entry.fileName);
        archive.readEntry();
      });
      archive.on("end", () => resolve(names));
      archive.readEntry();
    });
  });
}

export function xmlTree(content: string): unknown {
  const document = new DOMParser({
    onError: (level, message) => {
      throw new Error(`Invalid XML (${level}): ${message}`);
    },
  }).parseFromString(content, "application/xml");
  function tree(element: Element): unknown {
    const attributes: Record<string, string> = {};
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index);
      assert.ok(attribute);
      if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
      attributes[
        attribute.namespaceURI
          ? `{${attribute.namespaceURI}}${attribute.localName}`
          : attribute.name
      ] = attribute.value;
    }
    const children: unknown[] = [];
    let text = "";
    let seenElement = false;
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        seenElement = true;
        children.push(tree(child as Element));
      } else if (
        !seenElement &&
        (child.nodeType === 3 || child.nodeType === 4)
      ) {
        text += child.nodeValue ?? "";
      }
    }
    return [
      element.namespaceURI
        ? `{${element.namespaceURI}}${element.localName}`
        : element.tagName,
      attributes,
      text,
      children,
    ];
  }
  assert.ok(document.documentElement);
  return tree(document.documentElement);
}

export async function terminalCommand(
  executable: string[],
  input: string,
  cwd: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  const args =
    process.platform === "darwin"
      ? ["-q", "/dev/null", ...executable]
      : ["-qefc", executable.map(quote).join(" "), "/dev/null"];
  return new Promise((resolve, reject) => {
    // BSD script needs a pipe, not Node's socket-backed stdin, and input must wait for the child.
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        `cat | { script ${args.map(quote).join(" ")}; status=$?; printf '\\nAPS_PTY_EXIT:%s\\n' "$status" >&2; exit "$status"; }`,
      ],
      {
        cwd,
        env: { ...process.env, APS_STUDIO_ROOT: "" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let sent = false;
    const timeout = setTimeout(() => {
      child.stdin.end();
      child.kill("SIGTERM");
      reject(new Error(`PTY command timed out: ${stdout}\n${stderr}`));
    }, 15000);
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
      if (!sent) {
        sent = true;
        child.stdin.write(input);
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
      if (stderr.includes("APS_PTY_EXIT:")) child.stdin.end();
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({
        status,
        stdout,
        stderr: stderr.replace(/\nAPS_PTY_EXIT:\d+\n/, ""),
      });
    });
  });
}
