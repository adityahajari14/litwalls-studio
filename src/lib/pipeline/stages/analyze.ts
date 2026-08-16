import "server-only";

import { findFocalPoint } from "@/lib/gemini/focal";
import {
  conformToAspect,
  needsReframe,
  reframeForAspect,
} from "@/lib/gemini/reframe";
import { describePoster } from "@/lib/gemini/metadata";
import { jobAsset } from "@/lib/pipeline/paths";
import { MASTER_FILE } from "@/lib/pipeline/stages/upscale";
import { readBatch } from "@/lib/pipeline/store";
import { fetchCatalogue } from "@/lib/shopify/numbering";
import { fetchCategories } from "@/lib/shopify/collections";
import { parseTitle } from "@/lib/print/title";
import { cropAspectFor, sizesFor } from "@/lib/print/sizes";
import type {
  AiMetadata,
  FocalPoint,
  NormRect,
  PosterJob,
} from "@/lib/print/types";

/**
 * Ask Gemini what this poster is, and where its subject sits.
 *
 * This is the one stage that costs money, so it checks its own output first
 * and skips work that has already been done. Re-running a batch after a crash
 * must not re-bill every poster.
 */

export type AnalyzeResult = { metadata: AiMetadata; focal: FocalPoint };

/**
 * Existing subjects and tags, fetched once per batch run.
 *
 * Passed into the prompt so Gemini reuses the exact spelling already in the
 * catalogue rather than inventing a near-duplicate. Cached for a few minutes
 * because a twenty-poster batch would otherwise make twenty identical
 * catalogue fetches.
 */
type Vocabulary = { subjects: string[]; tags: string[] };

let cache: { at: number; value: Vocabulary } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function loadVocabulary(): Promise<Vocabulary> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const { titles, tags } = await fetchCatalogue();
    const subjects = new Set<string>();
    for (const title of titles) {
      const parts = parseTitle(title);
      if (parts) subjects.add(parts.subject);
    }
    const value: Vocabulary = { subjects: [...subjects].sort(), tags };
    cache = { at: Date.now(), value };
    return value;
  } catch (cause) {
    // A vocabulary is an improvement, not a requirement. Losing it costs
    // consistency, not correctness, so it must not stop the batch.
    console.warn(
      `analyze: could not load catalogue vocabulary: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return { subjects: [], tags: [] };
  }
}

export async function analyze(job: PosterJob): Promise<Partial<PosterJob>> {
  const batch = await readBatch(job.batchId);
  if (!batch) throw new Error(`Batch not found for job ${job.id}`);

  // Skip work already done, but treat a fallback as unfinished: a poster that
  // fell back because the key was missing should get a real answer once the
  // key is present, without needing the job deleted and re-uploaded.
  const needsMetadata = !job.metadata || job.metadata.source === "fallback";
  const needsFocal = !job.focal || job.focal.source === "fallback";
  const needsCrops = job.aiCrops === undefined;
  if (!needsMetadata && !needsFocal && !needsCrops) return {};

  const image = jobAsset(job.batchId, job.id, MASTER_FILE);
  const vocabulary = needsMetadata
    ? await loadVocabulary()
    : { subjects: [], tags: [] };

  // Both calls read the same image and neither depends on the other, so they
  // run together rather than doubling the wait.
  const [metadata, focal] = await Promise.all([
    needsMetadata
      ? describePoster({
          image,
          sourceName: job.sourceName,
          category: batch.category,
          knownSubjects: vocabulary.subjects,
          knownTags: vocabulary.tags,
          collections: await categoryOptions(),
        })
      : Promise.resolve(job.metadata!),
    needsFocal
      ? findFocalPoint({ image, sourceName: job.sourceName })
      : Promise.resolve(job.focal!),
  ]);

  const aiCrops = needsCrops ? await reframeSizes(job) : job.aiCrops;

  return { metadata, focal, aiCrops };
}

/**
 * Ask for a purpose-chosen crop at each size whose shape differs sharply from
 * the source.
 *
 * Sizes that share an aspect ratio share one answer — A5, A4 and A3 are all
 * 1:√2, so asking three times would be three identical questions and three
 * charges. Sequential rather than parallel because the batch runner already
 * runs two jobs at once, and a burst of concurrent calls is the quickest way
 * to meet a rate limit.
 */
async function reframeSizes(
  job: PosterJob,
): Promise<PosterJob["aiCrops"]> {
  if (!job.probe) return {};

  const image = jobAsset(job.batchId, job.id, MASTER_FILE);
  const source = { width: job.probe.width, height: job.probe.height };
  const sourceAspect = source.width / source.height;

  const out: NonNullable<PosterJob["aiCrops"]> = {};
  const byAspect = new Map<string, { rect: NormRect; reason: string }>();

  for (const size of sizesFor(job.kind)) {
    const targetAspect = cropAspectFor(size.id, job.kind);
    if (!needsReframe(sourceAspect, targetAspect)) continue;

    const key = targetAspect.toFixed(3);
    let answer = byAspect.get(key);

    if (!answer) {
      const result = await reframeForAspect({
        image,
        sourceName: job.sourceName,
        targetAspect,
        label: size.label,
      });
      if (!result) continue;
      // The model's box is approximately the right shape; the renderer needs
      // it exact or the output is letterboxed.
      answer = {
        rect: conformToAspect(result.rect, targetAspect, source),
        reason: result.reason,
      };
      byAspect.set(key, answer);
    }

    out[size.id] = answer;
  }

  return out;
}

/**
 * The collections available to suggest from.
 *
 * Best-effort: an unreachable Shopify costs a suggestion, not the batch, so a
 * failure here returns an empty list and the prompt simply omits the question.
 */
async function categoryOptions(): Promise<{ id: string; label: string }[]> {
  try {
    const categories = await fetchCategories();
    return categories.map((c) => ({ id: c.id, label: c.label }));
  } catch {
    return [];
  }
}
