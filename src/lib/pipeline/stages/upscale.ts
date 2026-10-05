import "server-only";

import { access, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

import { jobAsset } from "@/lib/pipeline/paths";
import { aiUpscale4x } from "@/lib/pipeline/stages/ai-upscale";
import { coverageFor, dpiBySize } from "@/lib/pipeline/stages/probe";
import { DPI_FLOOR, sizeIdsFor } from "@/lib/print/sizes";
import type { PosterJob, ProbeResult } from "@/lib/print/types";

/** Everything downstream reads this, upscaled or not, so there is one input path. */
export const MASTER_FILE = "master.png";

/**
 * Cap on how far we will resample.
 *
 * The model itself is fixed at 4x (see MODEL_SCALE). Past that, a source
 * still short of the floor gets a further Lanczos stretch on top of the AI
 * pass, up to this ceiling — real regenerated detail first, then a plain
 * resample for whatever gap remains, rather than pretending the model can
 * responsibly invent an 8x jump in a single pass. Beyond 8x total there is
 * too little real signal left in the source for even that combination to be
 * honest, and the low-res badge is the more truthful output at that point.
 */
const MAX_SCALE = 8;

/** The model's own fixed scale factor — see ai-upscale.ts. */
const MODEL_SCALE = 4;

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
  const worstDpi = Math.min(
    ...sizeIdsFor(job.kind).map((id) => job.probe!.dpiBySize[id]),
  );
  // 2% headroom: rounding the scale factor to integer target pixels, then
  // integer pixels again to a DPI ratio, can land a scale that was computed
  // to clear the floor EXACTLY a couple of DPI under it once both roundings
  // are through — verified against a wide sweep of source dimensions to be
  // the smallest margin that never leaves a shortfall.
  const needed = worstDpi >= DPI_FLOOR ? 1 : (DPI_FLOOR / worstDpi) * 1.02;
  const scale = Math.min(needed, MAX_SCALE);

  // ICC profile from the ORIGINAL source: the AI stage works in raw pixel
  // buffers, which carry no colour metadata, so it has to be reattached here
  // rather than relying on withMetadata() to carry it through automatically.
  // sharp only accepts an ICC profile as a filesystem path, never as bytes,
  // so a source with an embedded profile is written out to a sidecar file.
  const iccBytes = (await sharp(source).metadata()).icc;
  const iccPath = iccBytes ? `${master}.icc` : null;
  if (iccPath && iccBytes) await writeFile(iccPath, iccBytes);

  if (scale <= 1.001) {
    // Source is already dense enough — no need to invent anything. Still
    // route through sharp once to apply EXIF rotation, so every downstream
    // stage can treat the master's dimensions as the truth without
    // re-checking orientation.
    await sharp(source)
      .autoOrient()
      .withMetadata()
      .png({ compressionLevel: 6 })
      .toFile(master);
  } else {
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    // Orient first: the AI model must see the image the way it will actually
    // display, not however EXIF says to rotate it later.
    //
    // When the target is under 4x, feed the model a copy shrunk to a quarter
    // of the target instead of the full source. Its 4x output then lands on
    // the target itself, rather than at 4x the source only to be thrown away
    // by a Lanczos shrink — a 2000x3000 source headed for ~3600x5400 would
    // otherwise run as 8000x12000, six times the tiles for pixels nobody
    // keeps. Model cost scales with input pixels, so this is where the time
    // goes. The model regenerates its detail from the shrunk copy, which
    // sharpens soft artwork rather than preserving every source pixel. A
    // target at or over 4x needs the whole source, so is left as it was.
    const modelWidth = Math.ceil(targetWidth / MODEL_SCALE);
    const modelHeight = Math.ceil(targetHeight / MODEL_SCALE);
    const orientedPath = `${master}.oriented.png`;
    let oriented = sharp(source).autoOrient();
    if (modelWidth < width && modelHeight < height) {
      oriented = oriented.resize(modelWidth, modelHeight, {
        kernel: "lanczos3",
        fit: "fill",
      });
    }
    await oriented.png().toFile(orientedPath);

    // The model is fixed at 4x. Run it once, then Lanczos to exactly the
    // scale this job needs: DOWN by at most a few rounding pixels when the
    // target is under 4x (see above), or UP when the target exceeds 4x (the
    // AI pass supplies real detail for the first 4x, and Lanczos stretches
    // the remainder rather than running the model twice — a second AI pass
    // would compound its own artifacts on invented pixels, which is worse
    // than an honest, smooth stretch on top of real detail).
    const aiPath = `${master}.ai4x.png`;
    const ai = await aiUpscale4x(orientedPath, aiPath);

    let finalPipeline = sharp(aiPath);
    if (ai.width !== targetWidth || ai.height !== targetHeight) {
      finalPipeline = finalPipeline.resize(targetWidth, targetHeight, {
        kernel: "lanczos3",
        fit: "fill",
      });
    }

    if (iccPath) finalPipeline = finalPipeline.withIccProfile(iccPath);

    await finalPipeline
      .withMetadata()
      .png({ compressionLevel: 6 })
      .toFile(master);

    await Promise.all([
      rm(orientedPath, { force: true }),
      rm(aiPath, { force: true }),
      iccPath ? rm(iccPath, { force: true }) : Promise.resolve(),
    ]);
  }

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
