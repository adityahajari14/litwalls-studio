import "server-only";

import { newId } from "@/lib/pipeline/paths";
import { normalizePriceTable } from "@/lib/print/pricing";
import type {
  Batch,
  Category,
  PosterJob,
  PosterKind,
  SizeId,
} from "@/lib/print/types";

/**
 * Factories for new records.
 *
 * Kept apart from the store so there is exactly one place that decides what a
 * fresh Batch or PosterJob looks like. Every optional field is initialised
 * explicitly, including the empty ones — a job written with a missing `images`
 * array would blow up three stages later in code that reasonably assumed it
 * was there.
 */

export function createBatch(input: {
  name: string;
  category: Category;
  kind: PosterKind;
  prices?: Partial<Record<SizeId, string>>;
  compareAt?: Partial<Record<SizeId, string>>;
  defaultLibraryIds?: string[];
}): Batch {
  const now = Date.now();
  return {
    id: newId(),
    name: input.name.trim() || "Untitled batch",
    category: input.category,
    kind: input.kind,
    defaultLibraryIds: input.defaultLibraryIds ?? [],
    // Normalised at the boundary so nothing downstream has to wonder whether
    // a price is "499", "₹499 ", or garbage.
    prices: normalizePriceTable(input.prices ?? {}),
    compareAt: normalizePriceTable(input.compareAt ?? {}),
    jobIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createJob(input: {
  batch: Batch;
  sourceName: string;
  sourceRelPath: string;
}): PosterJob {
  const now = Date.now();
  return {
    id: newId(),
    batchId: input.batch.id,
    sourceName: input.sourceName,
    sourceRelPath: input.sourceRelPath,
    // Defaulted from the batch but stored on the job, so changing a batch's
    // kind later cannot silently reinterpret posters already rendered.
    kind: input.batch.kind,
    stage: "ingested",
    status: { kind: "idle" },
    probe: null,
    metadata: null,
    focal: null,
    cropOverrides: {},
    priceOverrides: {},
    compareAtOverrides: {},
    assets: [],
    mockups: [],
    selectedTemplateIds: [],
    // Batch defaults seed the gallery so a size guide is set once per batch
    // rather than once per poster.
    images: input.batch.defaultLibraryIds.map((libraryId) => ({
      kind: "library" as const,
      libraryId,
    })),
    drive: null,
    shopify: null,
    createdAt: now,
    updatedAt: now,
  };
}
