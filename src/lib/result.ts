/**
 * A success-or-failure value that callers must inspect rather than a thrown
 * exception they may forget to catch.
 *
 * Used for everything that talks to the outside world — Gemini, Google Drive,
 * Shopify. The pipeline's defining property is that one poster failing must
 * never kill a batch of twenty, and an exception thrown four frames deep in an
 * HTTP client is exactly how that happens. A Result makes "this one didn't
 * work, carry on" the path of least resistance instead of the path you have to
 * remember to write.
 *
 * Genuine programmer errors (a bad argument, a broken invariant) should still
 * throw — those are bugs, and they should be loud.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}

/**
 * Wrap a promise, converting a rejection into an `err`.
 *
 * `context` is prepended to the message because by the time a failure surfaces
 * in the review UI, "fetch failed" on its own is useless — "Drive upload for
 * A3-p2.jpg: fetch failed" tells you where to look.
 */
export async function attempt<T>(
  context: string,
  fn: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(`${context}: ${message}`);
  }
}
