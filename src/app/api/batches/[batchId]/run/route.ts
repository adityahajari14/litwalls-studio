import { runJobs } from "@/lib/pipeline/pipeline";
import { listJobs, readBatch } from "@/lib/pipeline/store";

/**
 * Process every job in a batch that has not finished the automatic stages.
 *
 * Runs to completion before responding. A 20-poster batch takes a while, but
 * this is a local tool with one user watching a progress indicator, and a
 * synchronous response means the client knows exactly when it is safe to
 * re-read. `after()` was the alternative and is the wrong tool: it is bounded
 * by maxDuration, which a large batch would blow straight past.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/run">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return Response.json({ error: "Batch not found." }, { status: 404 });
  }

  const jobs = await listJobs(batchId);

  // Anything already past the automatic stages, or parked for review, is left
  // alone — re-running a batch must not redo finished work.
  const pending = jobs.filter(
    (job) => job.status.kind !== "needs-review" && job.stage !== "mocked",
  );

  await runJobs(
    batchId,
    pending.map((job) => job.id),
  );

  const after = await listJobs(batchId);
  return Response.json({
    ran: pending.length,
    jobs: after,
    failed: after.filter((job) => job.status.kind === "failed").length,
  });
}
