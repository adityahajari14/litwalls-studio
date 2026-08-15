import { listJobs, updateJob } from "@/lib/pipeline/store";
import { hasReached } from "@/lib/print/types";

/**
 * Approve several posters at once.
 *
 * For the common case where the model got a whole batch right and opening
 * twenty review screens to click Approve twenty times is the only thing
 * standing between you and publishing.
 *
 * Only posters that have finished rendering are eligible — approving
 * something with no images yet would sail straight past the gate the review
 * step exists to provide.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/approve">,
) {
  const { batchId } = await ctx.params;

  let ids: string[] | null = null;
  try {
    const body = (await request.json()) as { jobIds?: unknown };
    if (Array.isArray(body.jobIds)) {
      ids = body.jobIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // No body means "everything that is ready".
  }

  const jobs = await listJobs(batchId);
  const eligible = jobs.filter(
    (job) =>
      (ids === null || ids.includes(job.id)) &&
      hasReached(job.stage, "mocked") &&
      job.stage !== "approved" &&
      !hasReached(job.stage, "published"),
  );

  for (const job of eligible) {
    await updateJob(batchId, job.id, (current) => ({
      ...current,
      stage: "approved",
      status: { kind: "done" },
    }));
  }

  return Response.json({
    approved: eligible.length,
    jobs: await listJobs(batchId),
  });
}
