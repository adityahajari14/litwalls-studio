import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import { PRODUCT_IMAGES_DIR } from "@/lib/pipeline/paths";
import type { LibraryImage } from "@/lib/print/types";

/**
 * The shared product-image library.
 *
 * Images every product carries — a size guide, the 300gsm quality panel,
 * shipping info. They are uploaded to Shopify ONCE and referenced by every
 * product afterwards: re-uploading a size guide 154 times would bloat the
 * store's files for no benefit and make replacing it a 154-product job.
 *
 * The folder is the source of truth. Drop a file in and it appears; there is
 * no database to keep in sync, and no upload step to forget.
 */

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export type LibraryEntry = LibraryImage & {
  /** Content hash — the cache key for "have we uploaded this already?". */
  hash: string;
  bytes: number;
};

/** Optional metadata, keyed by filename. Anything absent gets a sane default. */
type Manifest = Record<
  string,
  { name?: string; role?: LibraryImage["role"]; order?: number }
>;

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await readFile(join(PRODUCT_IMAGES_DIR, "library.json"), "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // No manifest is the normal case — it only exists to override defaults.
    return {};
  }
}

/**
 * Derive a readable name from a filename.
 *
 * So that dropping in "size-guide.png" yields "Size guide" without anyone
 * having to write a manifest entry. The manifest exists for when the derived
 * name is wrong, not as a requirement.
 */
function nameFromFile(file: string): string {
  const stem = file.slice(0, file.length - extname(file).length);
  const words = stem.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Guess a role from the filename, so common cases need no configuration. */
function roleFromFile(file: string): LibraryImage["role"] {
  const lower = file.toLowerCase();
  if (/size|dimension|chart/.test(lower)) return "size-guide";
  if (/quality|gsm|material|paper|print/.test(lower)) return "quality";
  if (/ship|deliver|packag|roll|tube/.test(lower)) return "shipping";
  return "other";
}

export async function loadLibrary(): Promise<LibraryEntry[]> {
  let files: string[];
  try {
    files = (await readdir(PRODUCT_IMAGES_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()));
  } catch {
    // The folder is optional — a store with no library images still works.
    return [];
  }

  const manifest = await readManifest();

  const entries = await Promise.all(
    files.map(async (file): Promise<LibraryEntry> => {
      const path = join(PRODUCT_IMAGES_DIR, file);
      const [buffer, stats] = await Promise.all([readFile(path), stat(path)]);
      const override = manifest[file] ?? {};

      return {
        // The filename IS the id. Stable, human-meaningful, and it means
        // renaming a file is a deliberate act rather than a silent breakage.
        id: file,
        file,
        name: override.name ?? nameFromFile(file),
        role: override.role ?? roleFromFile(file),
        // Hashed by CONTENT, not filename: replace the size guide with a
        // corrected version under the same name and the hash changes, so it
        // re-uploads instead of silently serving the old one forever.
        hash: createHash("sha256").update(buffer).digest("hex"),
        bytes: stats.size,
      };
    }),
  );

  // Manifest order first, then alphabetical — so the size guide can be pinned
  // ahead of the others without renaming files.
  return entries.sort((a, b) => {
    const orderA = manifest[a.file]?.order ?? 100;
    const orderB = manifest[b.file]?.order ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export async function libraryEntry(id: string): Promise<LibraryEntry | null> {
  const all = await loadLibrary();
  return all.find((entry) => entry.id === id) ?? null;
}

export function libraryPath(id: string): string {
  // Ids come from URLs, so anything that could climb out of the folder is
  // refused rather than sanitised — a bad id means a bug, not a typo.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`Unsafe library id: ${id}`);
  }
  return join(PRODUCT_IMAGES_DIR, id);
}
