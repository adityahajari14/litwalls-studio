import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { distance, DUPLICATE_THRESHOLD } from "@/lib/image/fingerprint";
import { WORKSPACE, writeJsonAtomic } from "@/lib/pipeline/paths";

/**
 * A durable record of every poster ever published.
 *
 * Kept OUTSIDE the batch directories on purpose: a batch gets deleted once its
 * posters are live, and the whole value of duplicate detection is recognising
 * something published a year ago. Tying the record to the batch would make it
 * evaporate exactly when it starts being useful.
 *
 * Also doubles as the answer to "what has this tool actually published?",
 * which nothing could answer before.
 */

const FILE = join(WORKSPACE, "published.json");

export type PublishedRecord = {
  /** Perceptual fingerprint of the source artwork. */
  fingerprint: string;
  productId: string;
  handle: string;
  title: string;
  subject: string;
  categoryId: string;
  categoryLabel: string;
  status: "ACTIVE" | "DRAFT";
  publishedAt: number;
  /** Kept so a published poster can still be traced back if the batch exists. */
  batchId: string;
  jobId: string;
  sourceName: string;
};

type Registry = Record<string, PublishedRecord>;

async function read(): Promise<Registry> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Registry;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function listPublished(): Promise<PublishedRecord[]> {
  const registry = await read();
  return Object.values(registry).sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Keyed by product id, so re-publishing the same product updates in place. */
export async function recordPublished(record: PublishedRecord): Promise<void> {
  const registry = await read();
  registry[record.productId] = record;
  await writeJsonAtomic(FILE, registry);
}

export async function forgetPublished(productId: string): Promise<void> {
  const registry = await read();
  delete registry[productId];
  await writeJsonAtomic(FILE, registry);
}

export type DuplicateMatch = {
  record: PublishedRecord;
  distance: number;
};

/**
 * Anything already published that looks like this artwork.
 *
 * Returns matches rather than a boolean, and never blocks: the caller shows
 * them so a human can decide. Two posters of the same character legitimately
 * look alike, and refusing an upload outright would be wrong more often than
 * it was right.
 */
export async function findDuplicates(
  candidate: string,
): Promise<DuplicateMatch[]> {
  const registry = await read();

  return Object.values(registry)
    .map((record) => ({
      record,
      distance: distance(candidate, record.fingerprint),
    }))
    .filter((match) => match.distance <= DUPLICATE_THRESHOLD)
    .sort((a, b) => a.distance - b.distance);
}
