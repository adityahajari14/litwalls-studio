import { listPublished } from "@/lib/pipeline/registry";
import { readSettings } from "@/lib/pipeline/settings";
import { uploadToDrive } from "@/lib/pipeline/stages/drive";
import { listJobs, readBatch, readJob, updateJob } from "@/lib/pipeline/store";
import { hasReached } from "@/lib/print/types";
import { Numberer } from "@/lib/shopify/numbering";
import { publishJob } from "@/lib/shopify/publish";

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
  try {
    const body = (await request.json()) as {
      status?: string;
      republish?: boolean;
      jobIds?: unknown;
    };
    if (body.status === "ACTIVE") status = "ACTIVE";
    republish = body.republish === true;
    if (Array.isArray(body.jobIds)) {
      onlyJobIds = body.jobIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // No body: keep the safer default.
  }

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
  const results: {
    job: string;
    ok: boolean;
    detail: string;
    /** Set when the product published but its print files did not reach Drive. */
    driveError?: string;
  }[] = [];

  // Sequential, deliberately: each publish claims a number from the shared
  // Numberer and stages four images. Running them in parallel would race on
  // numbering for no meaningful speed-up.
  for (const job of ready) {
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

      // The print files belong on Drive, not on the storefront, so filing
      // them is part of publishing. Kept separate from the Shopify result: the
      // product is live either way, and a Drive outage or an unconnected
      // account must not report a published product as failed. Files already
      // there are skipped, so a republish costs nothing here.
      const filed = await uploadToDrive(
        (await readJob(batchId, job.id)) ?? job,
      );
      if (filed.ok) {
        await updateJob(batchId, job.id, (current) => ({
          ...current,
          drive: filed.value,
        }));
      }
      results.push({
        job: job.sourceName,
        ok: true,
        detail: result.value.handle,
        ...(filed.ok ? {} : { driveError: filed.error }),
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
  }

  return Response.json({
    published: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    driveFailed: results.filter((r) => r.driveError).length,
    republish,
    status,
    results,
    jobs: await listJobs(batchId),
  });
}
