import "server-only";

import { updateJob } from "@/lib/pipeline/store";
import { cropAll } from "@/lib/pipeline/stages/crop";
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

  analyzed: async (job) => {
    // Phase 4 replaces this with Gemini. Until then the neutral fallback: the
    // whole frame is the subject, which makes cropRectFor a centre crop.
    if (job.focal) return {};
    return {
      focal: {
        subject: { x: 0, y: 0, width: 1, height: 1 },
        anchor: { x: 0.5, y: 0.5 },
        confidence: 0,
        source: "fallback" as const,
      },
    };
  },

  cropped: async (job) => ({ assets: await cropAll(job) }),

  mocked: async () => {
    // Phase 3 renders mockups here.
    return {};
  },
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
 * Run a batch, a couple of posters at a time.
 *
 * Concurrency 2 rather than higher: Lanczos on a 5000px master plus four JPEG
 * encodes will saturate a laptop, and this runs next to the user's browser.
 * Going wider makes the whole machine unresponsive to finish marginally sooner.
 */
export async function runJobs(
  batchId: string,
  jobIds: string[],
  concurrency = 2,
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
