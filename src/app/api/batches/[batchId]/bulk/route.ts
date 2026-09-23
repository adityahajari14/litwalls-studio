import { listJobs, updateJob } from "@/lib/pipeline/store";
import { normalizePriceTable } from "@/lib/print/pricing";
import type { SizeId } from "@/lib/print/types";

/**
 * Apply one change to several posters at once.
 *
 * Tags and prices especially: a whole batch usually shares them, and setting
 * them one review screen at a time is the most repetitive thing in the tool.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/bulk">,
) {
  const { batchId } = await ctx.params;

  let body: {
    jobIds?: string[];
    addTags?: string[];
    removeTags?: string[];
    prices?: Record<string, string>;
    compareAt?: Record<string, string>;
    templateIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const jobs = await listJobs(batchId);
  const targets = Array.isArray(body.jobIds)
    ? jobs.filter((job) => body.jobIds!.includes(job.id))
    : jobs;

  if (targets.length === 0) {
    return Response.json({ error: "No matching posters." }, { status: 400 });
  }

  const addTags = (body.addTags ?? []).map((t) => t.trim()).filter(Boolean);
  const removeTags = (body.removeTags ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const prices = body.prices ? normalizePriceTable(body.prices) : null;
  const compareAt = body.compareAt
    ? normalizePriceTable(body.compareAt)
    : null;

  for (const target of targets) {
    await updateJob(batchId, target.id, (job) => {
      const next = { ...job };

      if (addTags.length > 0 || removeTags.length > 0) {
        const existing = job.metadata?.tags ?? [];
        // Case-insensitive on both sides, because the live tag cloud already
        // carries near-duplicates and bulk editing is exactly where a second
        // spelling would propagate across a whole batch.
        const kept = existing.filter(
          (tag) => !removeTags.includes(tag.trim().toLowerCase()),
        );
        const merged = [...kept];
        for (const tag of addTags) {
          if (
            !merged.some((t) => t.trim().toLowerCase() === tag.toLowerCase())
          ) {
            merged.push(tag);
          }
        }
        next.metadata = {
          subject: job.metadata?.subject ?? "",
          subtitle: job.metadata?.subtitle ?? null,
          sequence: job.metadata?.sequence ?? null,
          altText: job.metadata?.altText ?? "",
          description: job.metadata?.description ?? "",
          tags: merged,
          // A bulk tag edit is a human decision, so it must not be treated as
          // an unfinished AI result and re-asked on the next run.
          source: "manual",
        };
      }

      if (prices) {
        next.priceOverrides = {
          ...job.priceOverrides,
          ...(prices as Partial<Record<SizeId, string>>),
        };
      }
      if (compareAt) {
        next.compareAtOverrides = {
          ...job.compareAtOverrides,
          ...(compareAt as Partial<Record<SizeId, string>>),
        };
      }
      if (Array.isArray(body.templateIds)) {
        next.selectedTemplateIds = body.templateIds;
      }

      return next;
    });
  }

  return Response.json({
    updated: targets.length,
    jobs: await listJobs(batchId),
  });
}
