"use client";

import { JobRow } from "@/components/job-row";
import { useBatchStream } from "@/components/use-batch-stream";
import type { PosterJob } from "@/lib/print/types";

/**
 * The batch's poster list, kept live.
 *
 * Rendered on the server first so the page is complete without JavaScript,
 * then taken over by the stream — which is what lets you watch a batch process
 * in one tab while it runs from another.
 */
export function JobList({
  batchId,
  initialJobs,
}: {
  batchId: string;
  initialJobs: PosterJob[];
}) {
  const jobs = useBatchStream(batchId, initialJobs);

  if (jobs.length === 0) {
    return (
      <p className="mt-3 text-sm text-zinc-500">
        Nothing uploaded yet. Drop artwork above to get started.
      </p>
    );
  }

  const ready = jobs.filter((job) => job.stage === "approved").length;

  return (
    <>
      <ul className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800">
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </ul>
      {ready > 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          {ready} of {jobs.length} approved and ready to publish.
        </p>
      ) : null}
    </>
  );
}
