import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  PRODUCT_IMAGES_DIR,
  ensureDir,
  writeFileAtomic,
  writeJsonAtomic,
} from "@/lib/pipeline/paths";
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

const MANIFEST_FILE = join(PRODUCT_IMAGES_DIR, "library.json");

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await readFile(MANIFEST_FILE, "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // No manifest is the normal case — it only exists to override defaults.
    return {};
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await ensureDir(PRODUCT_IMAGES_DIR);
  await writeJsonAtomic(MANIFEST_FILE, manifest);
}

const ROLES: LibraryImage["role"][] = [
  "size-guide",
  "quality",
  "shipping",
  "other",
];

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

/**
 * Turn an uploaded filename into a safe, unique id for the folder.
 *
 * The filename IS the id (see `loadLibrary`), so it has to be filesystem-safe
 * and not collide with an existing image. A clash gets a `-2`, `-3`… suffix
 * rather than silently overwriting the size guide every product already
 * points at.
 */
export async function libraryUploadId(originalName: string): Promise<string> {
  const ext = extname(originalName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported image type: ${ext || "(none)"}`);
  }
  const stem =
    originalName
      .slice(0, originalName.length - ext.length)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "image";

  const existing = new Set((await loadLibrary()).map((entry) => entry.id));
  let candidate = `${stem}${ext}`;
  for (let n = 2; existing.has(candidate); n++) {
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

/** Write an uploaded image into the folder. Caller has already vetted the id. */
export async function saveLibraryImage(
  id: string,
  data: Buffer | Uint8Array,
): Promise<LibraryEntry> {
  await ensureDir(PRODUCT_IMAGES_DIR);
  await writeFileAtomic(libraryPath(id), data);
  const entry = await libraryEntry(id);
  if (!entry) throw new Error(`Saved ${id} but could not read it back`);
  return entry;
}

/** Merge name / role / order overrides into the manifest for one image. */
export async function updateLibraryEntry(
  id: string,
  patch: { name?: string; role?: string; order?: number },
): Promise<void> {
  const manifest = await readManifest();
  const current = manifest[id] ?? {};
  const next = { ...current };

  if (typeof patch.name === "string" && patch.name.trim()) {
    next.name = patch.name.trim().slice(0, 120);
  }
  if (
    typeof patch.role === "string" &&
    (ROLES as string[]).includes(patch.role)
  ) {
    next.role = patch.role as LibraryImage["role"];
  }
  if (typeof patch.order === "number" && Number.isFinite(patch.order)) {
    next.order = patch.order;
  }

  manifest[id] = next;
  await writeManifest(manifest);
}

/** Pin the display order by writing sequential `order` values. */
export async function reorderLibrary(ids: string[]): Promise<void> {
  const manifest = await readManifest();
  ids.forEach((id, index) => {
    manifest[id] = { ...(manifest[id] ?? {}), order: index };
  });
  await writeManifest(manifest);
}

/**
 * Delete an image and its manifest entry.
 *
 * A published product keeps its own staged copy on Shopify, and
 * `stageLibraryImage` already tolerates a missing file, so nothing downstream
 * breaks — the image just stops appearing in future galleries.
 */
export async function deleteLibraryImage(id: string): Promise<void> {
  await rm(libraryPath(id), { force: true });
  const manifest = await readManifest();
  if (id in manifest) {
    delete manifest[id];
    await writeManifest(manifest);
  }
}
