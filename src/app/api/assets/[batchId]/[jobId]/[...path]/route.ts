import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { jobAsset } from "@/lib/pipeline/paths";

/**
 * Serve a rendered file out of the workspace.
 *
 * These live outside `public/` deliberately — they are job state, not static
 * assets, and a 200MB original has no business being copied into the build.
 *
 * Streamed rather than read into a buffer so previewing a large master does
 * not spike memory.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
};

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/assets/[batchId]/[jobId]/[...path]">,
) {
  const { batchId, jobId, path } = await ctx.params;
  const relPath = path.join("/");

  let absolute: string;
  try {
    // Throws on traversal or an unsafe id. This is the boundary that makes a
    // user-controlled URL segment safe to turn into a filesystem read.
    absolute = jobAsset(batchId, jobId, relPath);
  } catch {
    return new Response("Bad path", { status: 400 });
  }

  let size: number;
  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });
    size = stats.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const extension = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  const stream = Readable.toWeb(
    createReadStream(absolute),
  ) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": String(size),
      // Rendered files change whenever a crop is edited, and a stale preview
      // would make the review screen lie about what will be published.
      "Cache-Control": "no-store",
    },
  });
}
