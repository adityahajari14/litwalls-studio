import "server-only";

import { access } from "node:fs/promises";
import sharp from "sharp";

import { jobAsset } from "@/lib/pipeline/paths";
import { coverageFor, dpiBySize } from "@/lib/pipeline/stages/probe";
import { DPI_FLOOR, SIZE_IDS } from "@/lib/print/sizes";
import type { PosterJob, ProbeResult } from "@/lib/print/types";

/** Everything downstream reads this, upscaled or not, so there is one input path. */
export const MASTER_FILE = "master.png";

/**
 * Cap on how far we will resample.
 *
 * Beyond ~2x, Lanczos produces a visibly soft, plasticky result that looks
 * worse than printing the smaller size honestly. We resample up to the cap and
 * leave the low-res warning in place rather than pretending the pixels are
 * there — the badge is the useful output, not the upscale.
 */
const MAX_SCALE = 2;

/**
 * Produce `master.png`, resampling upward only when the source is short of the
 * largest size's requirement.
 *
 * PNG, not JPEG: this is an intermediate that every crop is cut from, and
 * re-encoding lossy at each stage would compound artifacts. Disk is free here.
 *
 * Idempotent — an existing master is left alone, so re-running a batch does
 * not redo the expensive resample.
 */
export async function upscale(job: PosterJob): Promise<ProbeResult> {
  if (!job.probe) {
    throw new Error("upscale requires a completed probe");
  }

  const source = jobAsset(job.batchId, job.id, job.sourceRelPath);
  const master = jobAsset(job.batchId, job.id, MASTER_FILE);

  try {
    await access(master);
    // Already built. Re-read its real dimensions rather than trusting the
    // recorded ones, in case it was replaced by hand.
    const metadata = await sharp(master).metadata();
    if (metadata.width && metadata.height) {
      const size = { width: metadata.width, height: metadata.height };
      return {
        ...job.probe,
        ...size,
        dpiBySize: dpiBySize(size, job.kind),
        coverage: coverageFor(size, job.kind),
      };
    }
  } catch {
    // Not built yet — the normal path.
  }

  const { width, height } = job.probe;

  // Scale needed to bring the weakest size up to the floor. Split posters
  // measure per-panel, which dpiBySize already accounts for.
  const worstDpi = Math.min(...SIZE_IDS.map((id) => job.probe!.dpiBySize[id]));
  const needed = worstDpi >= DPI_FLOOR ? 1 : DPI_FLOOR / worstDpi;
  const scale = Math.min(needed, MAX_SCALE);

  const pipeline = sharp(source)
    // Applies EXIF rotation and strips the flag, so every downstream stage can
    // treat the master's dimensions as the truth without re-checking.
    .autoOrient();

  if (scale > 1.001) {
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);
    pipeline.resize(targetWidth, targetHeight, {
      // Lanczos3 is sharp's best resampling kernel for enlargement. It is not
      // an AI upscaler and does not invent detail; it just avoids the blocky
      // and haloed results of cheaper kernels.
      kernel: "lanczos3",
      fit: "fill",
    });
  }

  await pipeline.png({ compressionLevel: 6 }).toFile(master);

  const metadata = await sharp(master).metadata();
  const size = {
    width: metadata.width ?? width,
    height: metadata.height ?? height,
  };

  return {
    ...job.probe,
    ...size,
    upscaled: scale > 1.001,
    dpiBySize: dpiBySize(size, job.kind),
    // Recomputed rather than carried over: a resample can change the aspect
    // ratio slightly through rounding, and coverage is derived from it.
    coverage: coverageFor(size, job.kind),
  };
}
