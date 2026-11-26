import { createHash } from "node:crypto";
import { FileAccessError, openAsset, studioRoot } from "@/lib/files";
import { loadCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let handle;
  try {
    const relative = new URL(request.url).searchParams.get("path") || "";
    handle = await openAsset(studioRoot(), relative);
    const catalog = await loadCatalog();
    const asset = catalog.products
      .flatMap((product) => product.assets)
      .find((item) => item.path === relative);
    if (!asset?.expectedHash || !/^[a-f0-9]{64}$/i.test(asset.expectedHash)) {
      throw new FileAccessError(
        "This asset has no valid recorded SHA-256 to compare.",
        422,
      );
    }
    const before = await handle.stat();
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new FileAccessError(
        "File changed during verification. Try again.",
        409,
      );
    }
    const actual = hash.digest("hex");
    return Response.json(
      {
        actual,
        expected: asset.expectedHash,
        matches: actual === asset.expectedHash.toLowerCase(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FileAccessError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("Asset verification failed", error);
    return Response.json(
      { error: "Could not verify the asset." },
      { status: 500 },
    );
  } finally {
    await handle?.close();
  }
}
