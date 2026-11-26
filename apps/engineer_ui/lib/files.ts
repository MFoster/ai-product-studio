import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

export class FileAccessError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function studioRoot(): string {
  return path.resolve(
    /*turbopackIgnore: true*/
    process.env.APS_STUDIO_ROOT || path.join(process.cwd(), "../.."),
  );
}

export function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function safePath(
  root: string,
  relative: string,
): Promise<string> {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    path.isAbsolute(relative) ||
    relative.split("/").some((part) => part === ".." || part.startsWith("."))
  ) {
    throw new FileAccessError("Invalid catalog path.");
  }
  const base = await realpath(root);
  const candidate = path.resolve(base, relative);
  if (!within(base, candidate))
    throw new FileAccessError("Path is outside the catalog.", 403);
  try {
    const resolved = await realpath(candidate);
    if (!within(base, resolved))
      throw new FileAccessError(
        "Symlinks outside the catalog are not allowed.",
        403,
      );
    return resolved;
  } catch (error) {
    if (isMissing(error)) throw new FileAccessError("File not found.", 404);
    throw error;
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// Only product files are exposed, never arbitrary repository or configuration files.
export async function openAsset(root: string, relative: string) {
  const parts = relative.split("/");
  if (
    parts.length < 6 ||
    parts[0] !== "product-line" ||
    parts[2] !== "variant" ||
    ![parts[1], parts[3], parts[4]].every((part) =>
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part),
    )
  ) {
    throw new FileAccessError("Only product assets can be opened.", 403);
  }
  const product = parts.slice(0, 5).join("/");
  const manifest = await safePath(root, `${product}/product.yaml`);
  if (!(await stat(/*turbopackIgnore: true*/ manifest)).isFile())
    throw new FileAccessError("Product not found.", 404);
  const file = await safePath(root, relative);
  if (!(await lstat(file)).isFile())
    throw new FileAccessError("Not a file.", 404);
  return open(/*turbopackIgnore: true*/ file, "r");
}
