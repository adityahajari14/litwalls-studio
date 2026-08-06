import { readSettings } from "@/lib/pipeline/settings";
import { listJobs, readBatch, updateJob } from "@/lib/pipeline/store";
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
  try {
    const body = (await request.json()) as { status?: string };
    if (body.status === "ACTIVE") status = "ACTIVE";
  } catch {
    // No body: keep the safer default.
  }

  const jobs = await listJobs(batchId);
  const ready = jobs.filter(
    (job) => hasReached(job.stage, "approved") && !job.shopify?.productId,
  );

  if (ready.length === 0) {
    return Response.json({
      published: 0,
      failed: 0,
      message: "Nothing approved and unpublished in this batch.",
    });
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

  // Sequential, deliberately: each publish claims a number from the shared
  // Numberer and stages four images. Running them in parallel would race on
  // numbering for no meaningful speed-up.
  for (const job of ready) {
    const result = await publishJob({
      job,
      batch,
      settingsPrices: settings.prices,
      settingsCompareAt: settings.compareAt,
      numberer,
      status,
    });

    if (result.ok) {
      await updateJob(batchId, job.id, (current) => ({
        ...current,
        shopify: result.value,
        stage: "published",
        status: { kind: "done" },
      }));
      results.push({ job: job.sourceName, ok: true, detail: result.value.handle });
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
    status,
    results,
    jobs: await listJobs(batchId),
  });
}
