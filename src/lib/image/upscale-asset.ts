import "server-only";

import { rm } from "node:fs/promises";
import sharp, { type Sharp } from "sharp";

import { aiUpscale4x } from "@/lib/pipeline/stages/ai-upscale";
import { writeFileAtomic } from "@/lib/pipeline/paths";

/**
 * Run the AI upscaler over a standalone asset — a mockup background, a shared
 * library image — and write the sharper result back in place.
 *
 * This is the pipeline's `aiUpscale4x` primitive without the poster job around
 * it: no `ProbeResult`, no job directory, no DPI maths.
 *
 * The model runs at a fixed 4x, tile by tile on CPU, and its cost grows with
 * the square of the input — a 2400px photo is thousands of tiles and tens of
 * minutes. Since the output only needs to reach `maxLongEdge` (2400 for a
 * mockup wall, nobody views it larger), the source is first brought down to a
 * quarter of that, then the model regenerates detail back up. A ~600px input
 * is a couple of minutes and the 2400px result is genuinely sharper than a
 * plain Lanczos stretch of the original would be.
 *
 * Runs entirely off the request path via `runBackground`. Returns the finished
 * dimensions, or null if the file could not be read.
 */
export type UpscaleAssetOptions = {
  /** Longest edge the finished file may have. Defaults to 2400. */
  maxLongEdge?: number;
  /**
   * Output encoding. "jpeg" for room photos; "keep" re-encodes as the source
   * format, which matters for a library PNG that carries transparency.
   */
  encode?: "jpeg" | "keep";
};

const DEFAULT_MAX_LONG_EDGE = 2400;
const MODEL_SCALE = 4;

export async function upscaleAssetInPlace(
  path: string,
  options: UpscaleAssetOptions = {},
): Promise<{ width: number; height: number } | null> {
  const maxLongEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;

  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) {
    console.warn(`upscale-asset: ${path} is not a readable image`);
    return null;
  }

  // A transparent source (some size guides) would be flattened by the model's
  // `removeAlpha()`. Not worth a colour-fringe regression on a diagram for a
  // sharpness gain nobody will notice — leave it alone.
  if (meta.hasAlpha && options.encode !== "jpeg") {
    console.log(
      `upscale-asset: skipping ${path} — it has an alpha channel the upscaler would flatten`,
    );
    return { width: meta.width, height: meta.height };
  }

  const started = Date.now();
  const prepPath = `${path}.prep.png`;
  const aiPath = `${path}.upscale.png`;

  try {
    // Feed the model an input no larger than maxLongEdge / 4, so its 4x pass
    // lands at or below the target without a giant tile count.
    const modelInputCap = Math.ceil(maxLongEdge / MODEL_SCALE);
    const longEdge = Math.max(meta.width, meta.height);
    const prepared = sharp(path).removeAlpha();
    if (longEdge > modelInputCap) {
      prepared.resize(modelInputCap, modelInputCap, {
        fit: "inside",
        kernel: "lanczos3",
        withoutEnlargement: true,
      });
    }
    await prepared.png().toFile(prepPath);

    await aiUpscale4x(prepPath, aiPath);

    // The 4x output may sit a little over the cap by rounding — bring it home.
    const pipeline = sharp(aiPath).resize(maxLongEdge, maxLongEdge, {
      fit: "inside",
      kernel: "lanczos3",
      withoutEnlargement: true,
    });

    const encoded =
      options.encode === "jpeg"
        ? await pipeline
            .jpeg({ quality: 88 })
            .toBuffer({ resolveWithObject: true })
        : await reencodeAsSource(pipeline, meta.format);

    await writeFileAtomic(path, encoded.data);
    console.log(
      `upscale-asset: ${path} ${meta.width}x${meta.height} -> ${encoded.info.width}x${encoded.info.height} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { width: encoded.info.width, height: encoded.info.height };
  } finally {
    await Promise.all([
      rm(prepPath, { force: true }).catch(() => undefined),
      rm(aiPath, { force: true }).catch(() => undefined),
    ]);
  }
}

/** Re-encode as the source format so a PNG stays a PNG (alpha, lossless). */
async function reencodeAsSource(pipeline: Sharp, format: string | undefined) {
  switch (format) {
    case "png":
      return pipeline
        .png({ compressionLevel: 8 })
        .toBuffer({ resolveWithObject: true });
    case "webp":
      return pipeline.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    case "avif":
      return pipeline.avif({ quality: 60 }).toBuffer({ resolveWithObject: true });
    default:
      return pipeline.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  }
}
