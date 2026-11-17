import { fileToDriveNow } from "@/lib/drive/queue";
import { readJob } from "@/lib/pipeline/store";

/**
 * File one poster's artwork to Drive, now, and wait for the result.
 *
 * Separate from publishing so the two can fail independently: a Drive outage
 * should not block a Shopify publish, and vice versa. Goes through the Drive
 * queue rather than around it, so pressing this while the background queue is
 * already filing the same poster joins that upload instead of duplicating it.
 * A failure is saved on the job and retried by the queue.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/jobs/[jobId]/drive">,
) {
  const { batchId, jobId } = await ctx.params;

  if (!(await readJob(batchId, jobId))) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  const result = await fileToDriveNow(batchId, jobId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json({
    job: await readJob(batchId, jobId),
    files: Object.keys(result.value.files).length,
  });
}
