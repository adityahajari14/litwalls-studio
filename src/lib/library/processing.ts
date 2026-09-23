import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PRODUCT_IMAGES_DIR, writeJsonAtomic } from "@/lib/pipeline/paths";

/**
 * Which shared images have a background upscale still running.
 *
 * A tiny JSON map `{ id: startedAt }` beside the images. Same shape of promise
 * as the template marker: it is only a hint, entries older than `STALE_MS` are
 * ignored (a dev-server restart abandons the job), and the library page polls
 * it to show a "sharpening…" badge.
 */

const FILE = join(PRODUCT_IMAGES_DIR, ".processing.json");
const STALE_MS = 10 * 60 * 1000;

async function read(): Promise<Record<string, number>> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, number>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function markLibraryProcessing(id: string): Promise<void> {
  const map = await read();
  map[id] = Date.now();
  await writeJsonAtomic(FILE, map).catch(() => undefined);
}

export async function clearLibraryProcessing(id: string): Promise<void> {
  const map = await read();
  if (!(id in map)) return;
  delete map[id];
  await writeJsonAtomic(FILE, map).catch(() => undefined);
}

/** Ids whose upscale is still in flight, stale entries dropped. */
export async function libraryProcessingIds(): Promise<string[]> {
  const map = await read();
  const now = Date.now();
  return Object.entries(map)
    .filter(([, startedAt]) => now - startedAt < STALE_MS)
    .map(([id]) => id);
}
