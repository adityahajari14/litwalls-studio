/**
 * One-time server setup, run by Next before any route handler.
 */
export async function register() {
  // Only the Node runtime has sharp; the edge runtime would fail the import.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const sharp = (await import("sharp")).default;

  /**
   * Disable sharp's operation cache.
   *
   * It keeps decoded images — and their file handles — alive between calls,
   * keyed by path. On Windows that makes a file it has read unwritable until
   * the handle is released, so re-rendering a poster failed with "unable to
   * open for write / Invalid argument" on a file the process itself was
   * holding. The cache only helps when the same input is processed repeatedly,
   * which is the opposite of this pipeline: every poster is read once.
   */
  sharp.cache(false);

  /**
   * Cap libvips' thread pool.
   *
   * sharp defaults to one thread per core and the pipeline already runs two
   * jobs concurrently, so an eight-core machine ends up with sixteen encode
   * threads fighting each other — and a laptop that stops responding while a
   * batch renders. This runs next to the user's browser; leaving headroom
   * matters more than finishing a second sooner.
   */
  sharp.concurrency(2);
}
