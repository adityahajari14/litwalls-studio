import "server-only";

import { readFile } from "node:fs/promises";
import sharp from "sharp";

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
  const original = await readFile(libraryPath(entry.id));
  const { buffer, mimeType, filename } = await fitForShopify(
    original,
    entry.file,
    mimeFor(entry.file),
  );

  const target = await createImageUpload({
    filename,
    mimeType,
    fileSize: buffer.byteLength,
  });
  await uploadToStagedTarget(target, buffer, filename, mimeType);

  return { originalSource: target.resourceUrl, alt: entry.name };
}

/**
 * Shopify refuses product images over 20 MB or 20 megapixels. The staged
 * upload's signed policy enforces it, so an oversize file does not fail
 * politely: it comes back as "EntityTooLarge" and the image is silently
 * missing from the product. Library images are whatever someone dropped in —
 * the two in the repo are 130 MP, 28 and 52 MB — so they are brought inside
 * the limit here, and files that already fit go through untouched.
 *
 * The margins sit well under the real limits: nobody views a gallery image
 * beyond a few thousand pixels, and a file that only just fits is one
 * metadata block away from not fitting.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_LONG_EDGE = 4096;

async function fitForShopify(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const meta = await sharp(buffer).metadata();
  const megapixels = ((meta.width ?? 0) * (meta.height ?? 0)) / 1e6;
  if (buffer.byteLength <= MAX_BYTES && megapixels <= 16) {
    return { buffer, mimeType, filename };
  }

  // Alpha is kept as PNG — a flattened size guide would gain a background it
  // never had. Opaque images become JPEG, which is far smaller at this size.
  const keepAlpha = Boolean(meta.hasAlpha);
  const stem = filename.replace(/\.[^.]+$/, "");

  for (let edge = MAX_LONG_EDGE; edge >= 1024; edge = Math.floor(edge * 0.8)) {
    const resized = sharp(buffer).resize(edge, edge, {
      fit: "inside",
      kernel: "lanczos3",
      withoutEnlargement: true,
    });
    const out = keepAlpha
      ? await resized.png({ compressionLevel: 9 }).toBuffer()
      : await resized.jpeg({ quality: 90 }).toBuffer();
    if (out.byteLength <= MAX_BYTES) {
      console.log(
        `library: ${filename} ${Math.round(megapixels)}MP ${(buffer.byteLength / 1048576).toFixed(1)}MB -> fit within ${edge}px, ${(out.byteLength / 1048576).toFixed(1)}MB for Shopify`,
      );
      return keepAlpha
        ? { buffer: out, mimeType: "image/png", filename: `${stem}.png` }
        : { buffer: out, mimeType: "image/jpeg", filename: `${stem}.jpg` };
    }
  }

  throw new Error(`${filename} could not be shrunk below Shopify's size limit`);
}

function mimeFor(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}
