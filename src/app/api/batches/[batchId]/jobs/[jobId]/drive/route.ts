import { uploadToDrive } from "@/lib/pipeline/stages/drive";
import { readJob, updateJob } from "@/lib/pipeline/store";

/**
 * File one poster's artwork to Drive.
 *
 * Separate from publishing so the two can fail independently: a Drive outage
 * should not block a Shopify publish, and vice versa.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/jobs/[jobId]/drive">,
) {
  const { batchId, jobId } = await ctx.params;

  const job = await readJob(batchId, jobId);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

  const result = await uploadToDrive(job);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  const updated = await updateJob(batchId, jobId, (current) => ({
    ...current,
    drive: result.value,
    // Only advance the stage once every file is actually up there.
    stage: current.stage === "approved" ? "uploaded" : current.stage,
  }));

  return Response.json({ job: updated, files: Object.keys(result.value.files).length });
}
