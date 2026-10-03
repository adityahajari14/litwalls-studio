import "server-only";

import { runAiUpscale4x } from "@/lib/pipeline/stages/upscale-pool";

/**
 * 4x super-resolution via the 4x-UltraSharp ONNX model, run locally — on the
 * GPU where DirectML is available, on CPU otherwise (see upscale-pool.ts).
 *
 * Unlike Lanczos resampling (see `upscale.ts`), this regenerates plausible
 * fine detail rather than smoothly stretching existing pixels — the
 * difference between a print that looks soft at 13x19" and one that looks
 * sharp. Licensed CC-BY-NC-SA-4.0 upstream; this deployment operates under a
 * separately obtained commercial license — see MODEL_LICENSE.md.
 *
 * The actual tiling and inference run in a separate process, not here — see
 * scripts/upscale-worker.mjs and upscale-pool.ts. onnxruntime-node's
 * `session.run()` blocks whatever thread calls it for the duration of
 * inference, and this server is a single Node process shared with every other
 * request — including the SSE stream the batch page uses to show live
 * progress — so running it in-process would freeze the whole app for as long
 * as a poster takes to upscale.
 */
export async function aiUpscale4x(
  sourcePath: string,
  destPath: string,
): Promise<{ width: number; height: number }> {
  return runAiUpscale4x(sourcePath, destPath);
}
