import { enqueueDrive } from "@/lib/drive/queue";
import { listPublished } from "@/lib/pipeline/registry";
import { readSettings } from "@/lib/pipeline/settings";
import { listJobs, readBatch, readJob, updateJob } from "@/lib/pipeline/store";
import { hasReached } from "@/lib/print/types";
import { Numberer } from "@/lib/shopify/numbering";
import { publishJob } from "@/lib/shopify/publish";
import {
  claimJob,
  currentRun,
  finishRun,
  releaseJob,
  saveProgress,
  startRun,
  type PublishRun,
} from "@/lib/shopify/publish-runs";

/** Whether this batch is being published right now, and how far along. The
 *  button asks on load, so a page reloaded mid-run shows the run rather than
 *  offering to start a second one. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/publish">,
) {
  const { batchId } = await ctx.params;
  return Response.json({ running: await currentRun(batchId) });
}

/**
 * Publish every approved poster in a batch to Shopify.
 *
 * One Numberer for the whole run, loaded once from the live catalogue. That is
 * what lets ten Spider-Man posters number 06 through 15 rather than all
 * claiming 06 — none of them exist in Shopify until this route creates them.
 *
 * `status` is accepted so a first run can go out as DRAFT. Until the storefront
 * handles size variants, a live four-variant product would sell A5 whatever
 * the customer picked.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/publish">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return Response.json({ error: "Batch not found." }, { status: 404 });
  }

  let status: "ACTIVE" | "DRAFT" = "DRAFT";
  let republish = false;
  let onlyJobIds: string[] | null = null;
  // Filing to Drive is on unless the request explicitly turns it off — every
  // poster on the storefront should have its print files on Drive.
  let drive = true;
  try {
    const body = (await request.json()) as {
      status?: string;
      republish?: boolean;
      jobIds?: unknown;
      drive?: boolean;
    };
    if (body.status === "ACTIVE") status = "ACTIVE";
    republish = body.republish === true;
    drive = body.drive !== false;
    if (Array.isArray(body.jobIds)) {
      onlyJobIds = body.jobIds.filter(
        (id): id is string => typeof id === "string",
      );
    }
  } catch {
    // No body: keep the safer default.
  }

  // One run per batch. Without this, reloading the page mid-publish brought
  // the button back, and a second click published every remaining poster a
  // second time.
  const claim = await startRun(batchId, republish ? "republish" : "publish");
  if (!claim.ok) {
    const { running } = claim;
    return Response.json(
      {
        error:
          `This batch is already ${running.mode === "republish" ? "republishing" : "publishing"} ` +
          `(${running.done + running.failed} of ${running.total} done). ` +
          "Wait for it to finish — it keeps going even if the page is closed.",
        running,
      },
      { status: 409 },
    );
  }
  try {
    return await publishBatch(
      batchId,
      batch,
      { status, republish, onlyJobIds, drive },
      claim.run,
    );
  } finally {
    await finishRun(batchId);
  }
}

async function publishBatch(
  batchId: string,
  batch: NonNullable<Awaited<ReturnType<typeof readBatch>>>,
  options: {
    status: "ACTIVE" | "DRAFT";
    republish: boolean;
    onlyJobIds: string[] | null;
    drive: boolean;
  },
  run: PublishRun,
): Promise<Response> {
  const { status, republish, onlyJobIds, drive } = options;
  const jobs = await listJobs(batchId);
  // A republish re-sends posters that already have a Shopify product, updating
  // it in place (publishJob passes the existing product id). The normal run
  // skips those, so it can never touch a live product by accident.
  const ready = jobs.filter(
    (job) =>
      hasReached(job.stage, "approved") &&
      Boolean(job.shopify?.productId) === republish &&
      (onlyJobIds === null || onlyJobIds.includes(job.id)),
  );

  run.total = ready.length;
  await saveProgress(batchId, run);

  if (ready.length === 0) {
    return Response.json({
      published: 0,
      failed: 0,
      message: republish
        ? "No published posters to republish in this batch."
        : "Nothing approved and unpublished in this batch.",
    });
  }

  // A republish keeps each product's CURRENT status rather than applying the
  // dashboard's draft default, which would silently pull a live product off
  // the storefront. The registry is where that status was recorded.
  const currentStatus = new Map<string, "ACTIVE" | "DRAFT">();
  if (republish) {
    for (const record of await listPublished()) {
      currentStatus.set(record.productId, record.status);
    }
  }

  let numberer: Numberer;
  try {
    numberer = await Numberer.load();
  } catch (cause) {
    return Response.json(
      {
        error: `Could not read the catalogue to assign numbers: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      },
      { status: 502 },
    );
  }

  const settings = await readSettings();
  const results: { job: string; ok: boolean; detail: string }[] = [];
  const toFile: { batchId: string; jobId: string }[] = [];

  // Sequential, deliberately: each publish claims a number from the shared
  // Numberer and stages four images. Running them in parallel would race on
  // numbering for no meaningful speed-up.
  for (const listed of ready) {
    // Read again right before sending: the list above is minutes old by the
    // time a poster near the end is reached, and anything that published this
    // poster meanwhile must not be repeated.
    const job = (await readJob(batchId, listed.id)) ?? listed;
    if (!republish && job.shopify?.productId) {
      run.done += 1;
      results.push({
        job: job.sourceName,
        ok: true,
        detail: job.shopify.handle,
      });
      continue;
    }
    if (!claimJob(batchId, job.id)) {
      run.failed += 1;
      results.push({
        job: job.sourceName,
        ok: false,
        detail: "Already being published by another run — skipped.",
      });
      continue;
    }
    run.current = job.metadata?.subject ?? job.sourceName;
    await saveProgress(batchId, run);

    try {
      const result = await publishJob({
        job,
        batch,
        settingsPrices: settings.prices,
        settingsCompareAt: settings.compareAt,
        settingsSplitPrices: settings.splitPrices,
        settingsSplitCompareAt: settings.splitCompareAt,
        descriptionTemplate: settings.descriptionTemplate,
        numberer,
        status: republish
          ? (currentStatus.get(job.shopify!.productId) ?? "DRAFT")
          : status,
      });

      if (result.ok) {
        await updateJob(batchId, job.id, (current) => ({
          ...current,
          shopify: result.value,
          stage: "published",
          status: { kind: "done" },
        }));

        // The print files belong on Drive, so filing them is part of
        // publishing — but it is QUEUED, not done here. Run inline, one restart
        // or closed tab mid-run left a Drive folder with nothing in it and no
        // record of why. The queue saves "needs filing" on the job first, files
        // in the background, retries failures, and resumes after a restart.
        // Queued as each product lands, so Drive starts while Shopify continues.
        if (drive) {
          toFile.push({ batchId, jobId: job.id });
          await enqueueDrive([{ batchId, jobId: job.id }]);
        }
        results.push({
          job: job.sourceName,
          ok: true,
          detail: result.value.handle,
        });
      } else {
        await updateJob(batchId, job.id, (current) => ({
          ...current,
          status: {
            kind: "failed",
            stage: "published",
            message: result.error,
            at: Date.now(),
          },
        }));
        results.push({ job: job.sourceName, ok: false, detail: result.error });
      }
      if (result.ok) run.done += 1;
      else run.failed += 1;
    } finally {
      releaseJob(batchId, job.id);
      await saveProgress(batchId, run);
    }
  }
  run.current = null;

  return Response.json({
    published: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    driveQueued: toFile.length,
    republish,
    status,
    results,
    jobs: await listJobs(batchId),
  });
}
