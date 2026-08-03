import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { TEMPLATES_DIR } from "@/lib/pipeline/paths";
import { loadTemplate } from "@/lib/templates/load";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Serve a template's background image.
 *
 * Templates live outside `public/` because they are curated content the user
 * edits by hand, and copying them into the build would mean restarting the
 * dev server after every tweak.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/templates/[templateId]/background">,
) {
  const { templateId } = await ctx.params;

  // Ids come from a URL, so they are untrusted until checked. Anything other
  // than the library's own naming scheme is refused outright.
  if (!/^[a-z0-9-]{1,64}$/.test(templateId)) {
    return new Response("Bad template id", { status: 400 });
  }

  const entry = await loadTemplate(templateId);

  // A folder with a background but no valid template.json is the normal state
  // while authoring — the corner picker needs to show that image.
  const filename = entry.ok ? entry.template.background : "background.jpg";
  const absolute = join(TEMPLATES_DIR, templateId, filename);

  let size: number;
  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });
    size = stats.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const stream = Readable.toWeb(
    createReadStream(absolute),
  ) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
