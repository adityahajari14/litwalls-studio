import {
  deleteJob,
  readBatch,
  readJob,
  updateJob,
  writeBatch,
} from "@/lib/pipeline/store";
import { normalizePriceTable } from "@/lib/print/pricing";
import { resolveCategories } from "@/lib/print/categories";
import {
  fetchCategories,
  fetchCategoriesFallback,
} from "@/lib/shopify/collections";
import type { Category, NormRect, PosterJob, SizeId } from "@/lib/print/types";

/** The collections a poster can be filed into. Falls back to the Storefront
 *  list, as the batch form does, so an Admin token without read_collections
 *  degrades rather than making the field unsettable. */
async function liveCategories(): Promise<Category[]> {
  try {
    return await fetchCategories();
  } catch {
    return await fetchCategoriesFallback().catch(() => []);
  }
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/jobs/[jobId]">,
) {
  const { batchId, jobId } = await ctx.params;
  const job = await readJob(batchId, jobId);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
  return Response.json({ job });
}

/**
 * Remove one poster from a batch.
 *
 * Deletes the job directory — original artwork, rendered files and all — and
 * drops it from the batch's index. Nothing is removed from Shopify or Drive:
 * a published product is a customer-facing thing, and deleting one silently
 * because a local file was tidied up would be the wrong call.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/jobs/[jobId]">,
) {
  const { batchId, jobId } = await ctx.params;

  const [batch, job] = await Promise.all([
    readBatch(batchId),
    readJob(batchId, jobId),
  ]);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

  await deleteJob(batchId, jobId);

  if (batch) {
    await writeBatch({
      ...batch,
      jobIds: batch.jobIds.filter((id) => id !== jobId),
    });
  }

  return Response.json({
    ok: true,
    published: Boolean(job.shopify?.productId),
  });
}

/**
 * Apply review edits.
 *
 * Every field is optional and only what is sent gets changed, so the crop
 * editor and the metadata form can save independently without one clobbering
 * the other's unsaved state.
 *
 * A human edit always wins over the model: setting metadata here marks the
 * source as "manual", which is what stops the analyze stage from deciding the
 * job looks unfinished and asking Gemini again.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/jobs/[jobId]">,
) {
  const { batchId, jobId } = await ctx.params;

  const existing = await readJob(batchId, jobId);
  if (!existing) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  // Fetched before the update rather than inside it: `updateJob` holds the
  // job file while it runs, and a Shopify round trip is not something to do
  // with a write in hand.
  const available = Array.isArray(body.categoryIds)
    ? await liveCategories()
    : [];

  const job = await updateJob(batchId, jobId, (current) => {
    const next: PosterJob = { ...current };

    if (body.metadata && typeof body.metadata === "object") {
      const m = body.metadata as Record<string, unknown>;
      next.metadata = {
        subject:
          typeof m.subject === "string"
            ? m.subject.trim()
            : (current.metadata?.subject ?? ""),
        subtitle:
          typeof m.subtitle === "string" && m.subtitle.trim()
            ? m.subtitle.trim()
            : null,
        // Never taken from the client: it is resolved against the live
        // catalogue at publish time, and accepting one here would let a stale
        // browser tab claim a number that has since been used.
        sequence: current.metadata?.sequence ?? null,
        tags: Array.isArray(m.tags)
          ? m.tags
              .filter((t): t is string => typeof t === "string" && t.trim() !== "")
              .map((t) => t.trim())
          : (current.metadata?.tags ?? []),
        altText:
          typeof m.altText === "string"
            ? m.altText.trim().slice(0, 125)
            : (current.metadata?.altText ?? ""),
        description:
          typeof m.description === "string"
            ? m.description.trim().slice(0, 600)
            : (current.metadata?.description ?? ""),
        source: "manual",
      };
    }

    if (body.cropOverrides && typeof body.cropOverrides === "object") {
      const overrides: Partial<Record<SizeId, NormRect>> = {
        ...current.cropOverrides,
      };
      for (const [sizeId, value] of Object.entries(
        body.cropOverrides as Record<string, unknown>,
      )) {
        if (value === null) {
          // Explicit null means "reset to the computed crop".
          delete overrides[sizeId as SizeId];
          continue;
        }
        const rect = value as NormRect;
        if (
          [rect?.x, rect?.y, rect?.width, rect?.height].every(
            (n) => typeof n === "number" && Number.isFinite(n),
          ) &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          overrides[sizeId as SizeId] = rect;
        }
      }
      next.cropOverrides = overrides;
    }

    if (body.priceOverrides && typeof body.priceOverrides === "object") {
      next.priceOverrides = normalizePriceTable(
        body.priceOverrides as Record<string, string>,
      );
    }
    if (body.compareAtOverrides && typeof body.compareAtOverrides === "object") {
      next.compareAtOverrides = normalizePriceTable(
        body.compareAtOverrides as Record<string, string>,
      );
    }

    if (Array.isArray(body.categoryIds)) {
      // Resolved against LIVE Shopify rather than trusted from the client,
      // for the same reason batch creation is: a stale browser tab must not
      // be able to file a poster into a collection that has since been
      // renamed or deleted. The ORDER given is kept — the first is the main
      // collection, and re-sorting here would rename the product.
      next.categories = resolveCategories(
        body.categoryIds.filter((id): id is string => typeof id === "string"),
        available,
      );
    }

    if (Array.isArray(body.selectedTemplateIds)) {
      next.selectedTemplateIds = body.selectedTemplateIds.filter(
        (id): id is string => typeof id === "string",
      );
    }

    if (Array.isArray(body.images)) {
      next.images = body.images.filter(
        (image): image is PosterJob["images"][number] =>
          typeof image === "object" && image !== null && "kind" in image,
      );
    }

    if (body.approved === true) {
      next.stage = "approved";
      // "done" rather than "idle": approval is terminal for the automatic
      // pipeline, and a job left looking idle reads as still-pending work.
      next.status = { kind: "done" };
    }

    return next;
  });

  const batch = await readBatch(batchId);
  return Response.json({ job, batch });
}
