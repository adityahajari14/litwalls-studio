import "server-only";

import { readJob, updateJob } from "@/lib/pipeline/store";
import { analyze } from "@/lib/pipeline/stages/analyze";
import { cropAll } from "@/lib/pipeline/stages/crop";
import { renderMockups } from "@/lib/pipeline/stages/mockup";
import { probe } from "@/lib/pipeline/stages/probe";
import { upscale } from "@/lib/pipeline/stages/upscale";
import { hasReached, STAGE_ORDER } from "@/lib/print/types";
import type { JobStage, PosterJob } from "@/lib/print/types";

/**
 * Move a job forward one stage at a time, stopping when it needs a human.
 *
 * Every stage records its result in job.json BEFORE returning, and every stage
 * is skipped if the job has already passed it. Together those two properties
 * make the pipeline resumable: if the dev server dies mid-batch, clicking Run
 * again re-enters at the first incomplete stage and redoes nothing. That is
 * the whole recovery story, and it is sufficient because a human is watching.
 */

/** The last stage that runs without human input. */
const AUTOMATIC_END: JobStage = "mocked";

type StageFn = (job: PosterJob) => Promise<Partial<PosterJob>>;

/**
 * What each stage does, and what it writes back.
 *
 * Stages return a patch rather than mutating, so the runner can persist
 * through updateJob's per-job lock and never lose a concurrent write.
 */
const STAGES: Partial<Record<JobStage, StageFn>> = {
  probed: async (job) => ({ probe: await probe(job) }),

  upscaled: async (job) => ({ probe: await upscale(job) }),

  analyzed: async (job) => analyze(job),

  cropped: async (job) => ({ assets: await cropAll(job) }),

  mocked: async (job) => ({ mockups: await renderMockups(job) }),
};

/**
 * Advance one job as far as it can go unattended.
 *
 * Failures are recorded on the job and returned rather than thrown: one poster
 * with a corrupt file must not take down a batch of twenty.
 */
export async function advanceJob(
  batchId: string,
  jobId: string,
  options: { until?: JobStage } = {},
): Promise<PosterJob> {
  const until = options.until ?? AUTOMATIC_END;

  // Bail out BEFORE touching status. A job that is already finished — waiting
  // for review, or approved — has nothing to advance, and flipping it to
  // "running" and back would leave it looking busy while doing nothing, or
  // stranded as "running" if the process died in between.
  const existing = await readJob(batchId, jobId);
  if (!existing) throw new Error(`Job not found: ${batchId}/${jobId}`);
  if (hasReached(existing.stage, until)) return existing;

  let current = await updateJob(batchId, jobId, (job) => ({
    ...job,
    status: { kind: "running", stage: job.stage, startedAt: Date.now() },
  }));

  for (const stage of STAGE_ORDER) {
    // Already done, or beyond what this run should attempt.
    if (hasReached(current.stage, stage)) continue;
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(until)) break;

    const run = STAGES[stage];
    if (!run) {
      // No work for this stage — record the transition and continue.
      current = await updateJob(batchId, jobId, (job) => ({
        ...job,
        stage,
      }));
      continue;
    }

    try {
      current = await updateJob(batchId, jobId, (job) => ({
        ...job,
        status: { kind: "running", stage, startedAt: Date.now() },
      }));

      const patch = await run(current);

      current = await updateJob(batchId, jobId, (job) => ({
        ...job,
        ...patch,
        stage,
        status: { kind: "idle" },
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return updateJob(batchId, jobId, (job) => ({
        ...job,
        status: { kind: "failed", stage, message, at: Date.now() },
      }));
    }
  }

  // Reaching the end of the automatic stages means it is a human's turn.
  if (hasReached(current.stage, AUTOMATIC_END)) {
    current = await updateJob(batchId, jobId, (job) =>
      job.stage === AUTOMATIC_END
        ? { ...job, status: { kind: "needs-review" } }
        : job,
    );
  }

  return current;
}

/**
 * Run a batch, several posters at a time.
 *
 * The AI upscale stage's own CPU-bound work now happens in a separate pool of
 * processes (see ai-upscale.ts, upscale-pool.ts), which has its own cap on
 * how many posters it upscales at once. This concurrency figure is no longer
 * fighting that — it just controls how many jobs can be mid-flight on the
 * OTHER stages (Gemini calls, sharp renders) at the same time, so it can
 * afford to be higher than before without making the machine unresponsive.
 */
export async function runJobs(
  batchId: string,
  jobIds: string[],
  concurrency = 4,
): Promise<void> {
  const queue = [...jobIds];

  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      // advanceJob records its own failures, so one bad poster cannot stop
      // the worker from picking up the next.
      await advanceJob(batchId, id).catch(() => undefined);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
}
