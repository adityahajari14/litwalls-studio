import { driveConnected } from "@/lib/drive/auth";
import {
  driveQueueStatus,
  enqueueMissing,
  pauseDrive,
  resumeDrive,
} from "@/lib/drive/queue";
import { listBatches, listJobs } from "@/lib/pipeline/store";
import { driveComplete, driveFiled } from "@/lib/print/types";

/**
 * Drive filing status, for one batch (`?batchId=`) or everything.
 *
 * Counts come from the job files, not the in-memory queue, so they are true
 * after a restart: "missing" is every poster on the storefront without all of
 * its files on Drive, whatever the reason.
 */
export async function GET(request: Request) {
  // Belt and braces: instrumentation resumes on start, but if that ran before
  // the queue module could load, the first status poll does it instead.
  void resumeDrive().catch(() => undefined);

  const batchId = new URL(request.url).searchParams.get("batchId");
  const batchIds = batchId ? [batchId] : (await listBatches()).map((b) => b.id);

  let published = 0;
  let filed = 0;
  let unlinked = 0;
  let pending = 0;
  let failed = 0;
  for (const id of batchIds) {
    for (const job of await listJobs(id)) {
      if (!job.shopify?.productId) continue;
      published += 1;
      // "Filed" means done: files on Drive AND the product linked to them.
      if (driveComplete(job)) filed += 1;
      else {
        if (driveFiled(job)) unlinked += 1;
        if (job.drivePending) pending += 1;
        else if (job.driveError) failed += 1;
      }
    }
  }

  return Response.json({
    connected: await driveConnected(),
    published,
    filed,
    missing: published - filed,
    /** Of `missing`: files all on Drive, but the Shopify product has no link yet. */
    unlinked,
    pending,
    failed,
    queue: driveQueueStatus(batchId ?? undefined),
  });
}

/** Pause: drop everything waiting; uploads already running finish. */
export async function DELETE() {
  const dropped = pauseDrive();
  return Response.json({ dropped, queue: driveQueueStatus() });
}

/** Queue every published poster missing from Drive (one batch, or all). */
export async function POST(request: Request) {
  let batchId: string | undefined;
  let everything = false;
  let urgent: boolean | undefined;
  try {
    const body = (await request.json()) as {
      batchId?: unknown;
      everything?: unknown;
      urgent?: unknown;
    };
    if (typeof body.batchId === "string") batchId = body.batchId;
    everything = body.everything === true;
    if (typeof body.urgent === "boolean") urgent = body.urgent;
  } catch {
    // No body: everything.
  }
  const queued = await enqueueMissing(batchId, everything, urgent ?? !everything);
  return Response.json({ queued, queue: driveQueueStatus(batchId) });
}
