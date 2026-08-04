import { cropAll } from "@/lib/pipeline/stages/crop";
import { renderMockups } from "@/lib/pipeline/stages/mockup";
import { readJob, updateJob } from "@/lib/pipeline/store";

/**
 * Re-cut the print files and mockups after a crop or template change.
 *
 * Everything is regenerated rather than diffed. Working out precisely which
 * files a crop change invalidates is fiddly and easy to get subtly wrong, and
 * the cost of being wrong is publishing a stale file. Re-rendering one poster
 * takes a couple of seconds, which is cheap enough that correctness wins.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/jobs/[jobId]/rerender">,
) {
  const { batchId, jobId } = await ctx.params;

  const job = await readJob(batchId, jobId);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
  if (!job.probe) {
    return Response.json(
      { error: "This poster has not been processed yet." },
      { status: 409 },
    );
  }

  try {
    const assets = await cropAll(job);
    // Mockups are built from the freshly cut A3, so they must be rendered
    // from the updated job rather than the one read above.
    const mockups = await renderMockups({ ...job, assets });

    const updated = await updateJob(batchId, jobId, (current) => ({
      ...current,
      assets,
      mockups,
      status: { kind: "needs-review" },
    }));

    return Response.json({ job: updated });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await updateJob(batchId, jobId, (current) => ({
      ...current,
      status: { kind: "failed", stage: "cropped", message, at: Date.now() },
    }));
    return Response.json({ error: message }, { status: 500 });
  }
}
