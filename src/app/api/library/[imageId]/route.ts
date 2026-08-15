import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { libraryPath } from "@/lib/library/load";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/** Serve a library image for preview. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/library/[imageId]">,
) {
  const { imageId } = await ctx.params;

  let absolute: string;
  try {
    absolute = libraryPath(decodeURIComponent(imageId));
  } catch {
    return new Response("Bad id", { status: 400 });
  }

  let size: number;
  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });
    size = stats.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const extension = absolute.slice(absolute.lastIndexOf(".") + 1).toLowerCase();
  const stream = Readable.toWeb(
    createReadStream(absolute),
  ) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": String(size),
      // Replacing a library image on disk must show the new one immediately.
      "Cache-Control": "no-store",
    },
  });
}
