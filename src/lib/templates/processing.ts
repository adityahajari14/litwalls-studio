import "server-only";

import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TEMPLATES_DIR } from "@/lib/pipeline/paths";

/**
 * A marker file that says "a background job is still working on this template".
 *
 * The editor polls for it and shows an "analysing…" banner while it exists.
 * It lives in the template folder rather than in memory so a page load in a
 * fresh request can see it — but it is only ever a hint: if the dev server is
 * restarted mid-job the marker is left behind, so anything older than
 * `STALE_MS` is treated as finished and swept up on read.
 */

const MARKER = ".processing";
const STALE_MS = 10 * 60 * 1000;

function markerPath(id: string): string {
  return join(TEMPLATES_DIR, id, MARKER);
}

export async function markTemplateProcessing(id: string): Promise<void> {
  await writeFile(markerPath(id), String(Date.now()), "utf8").catch(
    () => undefined,
  );
}

export async function clearTemplateProcessing(id: string): Promise<void> {
  await rm(markerPath(id), { force: true }).catch(() => undefined);
}

/** True only if a marker exists AND is recent enough to still be trusted. */
export async function isTemplateProcessing(id: string): Promise<boolean> {
  try {
    const info = await stat(markerPath(id));
    if (Date.now() - info.mtimeMs < STALE_MS) return true;
    // Stale — a job that never finished. Clean it up so the UI stops waiting.
    await clearTemplateProcessing(id);
    return false;
  } catch {
    return false;
  }
}
