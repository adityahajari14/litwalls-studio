import { collectFiles, zipStream } from "@/lib/pipeline/archive";
import { batchDir } from "@/lib/pipeline/paths";
import { readBatch } from "@/lib/pipeline/store";

/**
 * Download a whole batch as a ZIP.
 *
 * Originals, rendered print files, mockups and job metadata. Two uses: handing
 * print files to a printer who is not on your Drive, and — more importantly —
 * having a copy of a batch that is not only inside a gitignored directory.
 *
 * Streamed, so a batch of 200MB originals never sits in memory.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/export">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return new Response("Batch not found", { status: 404 });
  }

  const safeName =
    batch.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    batchId;

  const entries = await collectFiles(batchDir(batchId), safeName);
  if (entries.length === 0) {
    return new Response("Nothing to export", { status: 404 });
  }

  return new Response(zipStream(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
