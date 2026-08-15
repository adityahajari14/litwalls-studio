import "server-only";

import { readFile } from "node:fs/promises";

import { libraryEntry, libraryPath, type LibraryEntry } from "@/lib/library/load";
import { LIBRARY_MEDIA_FILE, writeJsonAtomic } from "@/lib/pipeline/paths";
import { createImageUpload, uploadToStagedTarget } from "@/lib/shopify/admin";

/**
 * Upload library images to Shopify once, then reuse the result forever.
 *
 * Without this, publishing 154 products would upload 154 copies of the same
 * size guide. The cache is keyed by CONTENT HASH rather than filename, so
 * correcting an image causes a fresh upload while renaming one does not.
 *
 * The stored value is a staged `resourceUrl`, which Shopify accepts as an
 * `originalSource` for as long as it is valid. If one has expired the publish
 * simply re-stages it — an expired URL is a cache miss, not an error.
 */

type MediaCache = Record<
  string,
  { resourceUrl: string; uploadedAt: number; file: string }
>;

async function readCache(): Promise<MediaCache> {
  try {
    const raw = await readFile(LIBRARY_MEDIA_FILE, "utf8");
    const parsed = JSON.parse(raw) as MediaCache;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Staged uploads expire. Shopify does not document a precise lifetime, so this
 * errs well short of any plausible one: re-staging costs a second, while
 * publishing with a dead URL fails the whole product.
 */
const MAX_AGE_MS = 60 * 60 * 1000;

export type StagedFile = { originalSource: string; alt: string };

/**
 * Get an uploadable reference for a library image, staging it if needed.
 *
 * Returns null rather than throwing when the image has gone missing from disk:
 * a product should still publish without its size guide, and the review screen
 * already shows which library images are attached.
 */
export async function stageLibraryImage(
  id: string,
): Promise<StagedFile | null> {
  const entry = await libraryEntry(id);
  if (!entry) {
    console.warn(`library: "${id}" is attached to a product but not on disk`);
    return null;
  }

  const cache = await readCache();
  const hit = cache[entry.hash];
  if (hit && Date.now() - hit.uploadedAt < MAX_AGE_MS) {
    return { originalSource: hit.resourceUrl, alt: entry.name };
  }

  const staged = await stageFresh(entry);
  cache[entry.hash] = {
    resourceUrl: staged.originalSource,
    uploadedAt: Date.now(),
    file: entry.file,
  };
  await writeJsonAtomic(LIBRARY_MEDIA_FILE, cache);

  return staged;
}

async function stageFresh(entry: LibraryEntry): Promise<StagedFile> {
  const buffer = await readFile(libraryPath(entry.id));
  const mimeType = mimeFor(entry.file);

  const target = await createImageUpload({
    filename: entry.file,
    mimeType,
    fileSize: buffer.byteLength,
  });
  await uploadToStagedTarget(target, buffer, entry.file, mimeType);

  return { originalSource: target.resourceUrl, alt: entry.name };
}

function mimeFor(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}
