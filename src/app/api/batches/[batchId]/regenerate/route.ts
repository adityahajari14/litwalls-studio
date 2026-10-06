import { access } from "node:fs/promises";

import { regenerateDescription, regenerateTitle } from "@/lib/gemini/metadata";
import { jobAsset } from "@/lib/pipeline/paths";
import { loadVocabulary } from "@/lib/pipeline/stages/analyze";
import { MASTER_FILE } from "@/lib/pipeline/stages/upscale";
import { listJobs, readBatch, updateJob } from "@/lib/pipeline/store";
import type { PosterJob } from "@/lib/print/types";

/**
 * Ask Gemini to rewrite one field — the title or the description — for every
 * poster in a batch.
 *
 * Two fields, two buttons, one route: they cost the same, fail the same way
 * and differ only in what they write back, so a `field` switch beats two
 * copies of the loop. Each call is one Gemini request per poster, which is why
 * the buttons ask first.
 *
 * Only that field is touched. Tags, alt text, prices, crops and the gallery
 * stay exactly as they were, and so does `source`: a poster a human has
 * already edited is not suddenly relabelled as the model's work.
 */

/** Gentle on rate limits — see `reframeSizes` in the analyze stage. */
const CONCURRENCY = 2;

type Outcome = "updated" | "skipped" | "failed";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/regenerate">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return Response.json({ error: "Batch not found." }, { status: 404 });
  }

  let body: { field?: string; jobIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (body.field !== "title" && body.field !== "description") {
    return Response.json(
      { error: 'field must be "title" or "description".' },
      { status: 400 },
    );
  }
  const field = body.field;
  const only = Array.isArray(body.jobIds)
    ? body.jobIds.filter((id): id is string => typeof id === "string")
    : null;

  const jobs = (await listJobs(batchId)).filter(
    (job) => only === null || only.includes(job.id),
  );
  if (jobs.length === 0) {
    return Response.json({ error: "No matching posters." }, { status: 400 });
  }

  // Fetched once for the whole run, so every poster is offered the same list
  // of existing subjects and spells a repeat of one the same way.
  const vocabulary =
    field === "title" ? await loadVocabulary() : { subjects: [], tags: [] };

  const failures: string[] = [];
  const counts: Record<Outcome, number> = { updated: 0, skipped: 0, failed: 0 };

  async function regenerate(job: PosterJob): Promise<Outcome> {
    // Never analysed: there is no metadata to update and nothing to anchor a
    // description to. The Run button is what produces it.
    if (!job.metadata) return "skipped";

    // A published product keeps its title: the number in it was claimed under
    // the old subject, and a new subject on the old number could collide with
    // another poster's. Its description is safe to rewrite and republish.
    if (field === "title" && job.shopify?.productId) return "skipped";

    // The upscaled master when there is one; the original otherwise, so a
    // poster that has not reached the upscale stage can still be described.
    const master = jobAsset(batchId, job.id, MASTER_FILE);
    const image = await access(master).then(
      () => master,
      () => jobAsset(batchId, job.id, job.sourceRelPath),
    );

    if (field === "title") {
      const result = await regenerateTitle({
        image,
        category: batch!.category,
        knownSubjects: vocabulary.subjects,
      });
      if (!result.ok) {
        failures.push(`${job.sourceName}: ${result.error}`);
        return "failed";
      }
      await updateJob(batchId, job.id, (current) => ({
        ...current,
        metadata: current.metadata && {
          ...current.metadata,
          subject: result.value.subject,
          subtitle: result.value.subtitle,
        },
      }));
      return "updated";
    }

    const result = await regenerateDescription({
      image,
      kind: job.kind,
      subject: job.metadata.subject,
      previous: job.metadata.description,
    });
    if (!result.ok) {
      failures.push(`${job.sourceName}: ${result.error}`);
      return "failed";
    }
    await updateJob(batchId, job.id, (current) => ({
      ...current,
      metadata: current.metadata && {
        ...current.metadata,
        description: result.value,
      },
    }));
    return "updated";
  }

  const queue = [...jobs];
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      // One poster throwing (unreadable file, disk error) must not abandon
      // the rest of the batch.
      const outcome = await regenerate(job).catch((cause) => {
        failures.push(
          `${job!.sourceName}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return "failed" as const;
      });
      counts[outcome]++;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );

  return Response.json({
    field,
    ...counts,
    failures,
    jobs: await listJobs(batchId),
  });
}
