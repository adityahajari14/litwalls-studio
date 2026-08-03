import { deleteBatch, listJobs, readBatch } from "@/lib/pipeline/store";

/**
 * One batch plus its jobs — the polling target for the batch screen, and the
 * fallback when the SSE stream cannot connect.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return Response.json({ error: "Batch not found." }, { status: 404 });
  }

  return Response.json({ batch, jobs: await listJobs(batchId) });
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return Response.json({ error: "Batch not found." }, { status: 404 });
  }

  // Removes the rendered files and original artwork too — the whole point of
  // colocating them is that cleanup is one recursive delete.
  await deleteBatch(batchId);
  return Response.json({ ok: true });
}
