import { Readable } from "node:stream";
import path from "node:path";
import { FileAccessError, openAsset, studioRoot } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(request: Request) {
  let handle;
  try {
    const url = new URL(request.url);
    const relative = url.searchParams.get("path") || "";
    handle = await openAsset(studioRoot(), relative);
    const info = await handle.stat();
    const extension = path.extname(relative).toLowerCase();
    const inline =
      imageTypes[extension] && url.searchParams.get("download") !== "1";
    const headers = new Headers({
      "Content-Type": inline
        ? imageTypes[extension]
        : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.basename(relative))}`,
      "Content-Length": String(info.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    const stream = handle.createReadStream({ autoClose: true });
    handle = undefined;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers,
    });
  } catch (error) {
    await handle?.close();
    if (error instanceof FileAccessError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("Asset read failed", error);
    return Response.json(
      { error: "Could not read the asset." },
      { status: 500 },
    );
  }
}
