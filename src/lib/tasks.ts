import "server-only";

/**
 * Fire-and-forget background work for the dev server.
 *
 * The template editor and the library page kick off slow jobs — a multi-minute
 * CPU upscale, a Gemini call — that must not block the upload response. There
 * is no queue, no persistence and no cross-process coordination here on
 * purpose: this is a local single-process tool, and the honest failure mode
 * (restart the dev server and the in-flight job is abandoned) is handled by
 * the callers, which write a marker on disk and treat a stale one as "not
 * running" (see `templates/load.ts` and `library/load.ts`).
 *
 * The only thing this module actually buys over a bare `void fn()` is
 * de-duplication: starting the same `key` twice while the first run is still
 * going returns the first promise instead of doing the work again.
 */

const running = new Map<string, Promise<void>>();

/**
 * Run `fn` in the background under `key`. Returns immediately with the promise
 * for the run; callers normally ignore it. Errors are swallowed after being
 * logged — a background job that throws must not become an unhandled rejection
 * that takes the process down.
 */
export function runBackground(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;

  const run = (async () => {
    try {
      await fn();
    } catch (cause) {
      console.warn(
        `task ${key} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      running.delete(key);
    }
  })();

  running.set(key, run);
  return run;
}

/** Whether a job for this key is running in THIS process right now. */
export function isRunning(key: string): boolean {
  return running.has(key);
}
