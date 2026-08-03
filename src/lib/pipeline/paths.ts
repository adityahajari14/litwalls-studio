import "server-only";

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Where Studio keeps its state on disk.
 *
 * Everything lives under `workspace/` at the project root: job metadata,
 * original artwork, rendered files, the Drive token. One gitignored directory
 * means "delete the folder" is complete, correct cleanup, and it keeps a
 * long-lived Google credential from ever sitting next to source.
 */

/**
 * `process.cwd()` is the project root under both `next dev` and `next build`.
 * Resolved once at module load so a later `chdir` cannot move the workspace
 * out from under a job that is mid-render.
 */
const ROOT = resolve(process.cwd());

export const WORKSPACE = join(ROOT, "workspace");
export const BATCHES_DIR = join(WORKSPACE, "batches");
export const SETTINGS_FILE = join(WORKSPACE, "settings.json");
export const DRIVE_TOKEN_FILE = join(WORKSPACE, "drive-token.json");
export const LIBRARY_MEDIA_FILE = join(WORKSPACE, "library-media.json");

/** Committed content directories, curated by hand rather than written to. */
export const TEMPLATES_DIR = join(ROOT, "mockup-templates");
export const PRODUCT_IMAGES_DIR = join(ROOT, "product-images");

export function batchDir(batchId: string): string {
  return join(BATCHES_DIR, safeId(batchId));
}

export function batchFile(batchId: string): string {
  return join(batchDir(batchId), "batch.json");
}

export function jobDir(batchId: string, jobId: string): string {
  return join(batchDir(batchId), "jobs", safeId(jobId));
}

export function jobFile(batchId: string, jobId: string): string {
  return join(jobDir(batchId, jobId), "job.json");
}

/** Absolute path for a job-relative asset path like "sizes/A4.jpg". */
export function jobAsset(
  batchId: string,
  jobId: string,
  relPath: string,
): string {
  const base = jobDir(batchId, jobId);
  const full = resolve(base, relPath);
  // Containment check: a relPath is data that reaches us from JSON on disk and
  // from HTTP query strings, so "../../.env" must not resolve outside the job.
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`Asset path escapes its job directory: ${relPath}`);
  }
  return full;
}

/**
 * Reject ids that could climb the tree or collide with a device name.
 *
 * Ids are generated internally, so this should never fire — which is exactly
 * why it throws rather than sanitising. A malformed id means a bug upstream,
 * and quietly rewriting it into something valid would hide that bug while
 * writing files to a surprising place.
 */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`Unsafe id: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Short, sortable, collision-resistant id.
 *
 * Time prefix first so a directory listing is chronological — when something
 * goes wrong at 1am, `ls workspace/batches` showing newest-last is worth more
 * than a shorter string.
 */
export function newId(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${time}-${random}`;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Write a file atomically: full write to a temp name, then rename over.
 *
 * `rename` is atomic on NTFS within a volume, so a crash mid-write leaves
 * either the old file or the new one — never a truncated job.json that fails
 * to parse and takes the whole batch's state with it. The temp file sits in
 * the same directory precisely so the rename stays within one volume.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Write JSON atomically, formatted so a human can read and edit it. */
export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
