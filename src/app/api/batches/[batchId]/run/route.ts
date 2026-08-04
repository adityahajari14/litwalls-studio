import { runJobs } from "@/lib/pipeline/pipeline";
import { listJobs, readBatch } from "@/lib/pipeline/store";
import { hasReached } from "@/lib/print/types";

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

  // Anything that has finished the automatic stages is left alone, whether it
  // is waiting for review or already approved.
  //
  // `hasReached` rather than an equality check on "mocked": an approved job is
  // PAST mocked, so `stage !== "mocked"` treated it as unfinished and re-ran
  // the whole pipeline over it — silently discarding the human's crop edits
  // and dropping it back out of the approved state.
  const pending = jobs.filter(
    (job) =>
      job.status.kind !== "needs-review" && !hasReached(job.stage, "mocked"),
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
