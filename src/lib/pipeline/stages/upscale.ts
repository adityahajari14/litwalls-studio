import "server-only";

import { access, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

import { measureOversize } from "@/lib/image/detail";
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
 * How far the model's output may be stretched to reach the target when its
 * input was shrunk further than a quarter of the target on purpose (see
 * `planUpscale`). Up to here the stretch is hard to find even at 100%; past
 * it the softness it adds starts to cost more than the cleaner input gained.
 */
const MAX_POST_STRETCH = 1.5;

/**
 * A source with enough pixels is still regenerated when it is oversized, but
 * only if the model would be fed at least this fraction of the detail the
 * source really holds. Regenerating from less would trade real detail for
 * invented detail, which is the wrong way round for a file that has it.
 */
const MIN_DETAIL_KEPT = 1 / 1.5;

/**
 * Gaussian blur, in pixels, applied to what the model is fed.
 *
 * The model sharpens every edge it is shown, and a compressed source is full
 * of edges that are not in the artwork: the outlines of JPEG blocks. Fed
 * those as they are, it draws them — a face a hundred pixels tall comes out
 * with a rectangle for a nose. Softened by this much, the block outlines drop
 * below what it treats as an edge while lettering and real contours, which
 * are far stronger, come back exactly as crisp. Measured on the same crops:
 * 0.4 leaves the rectangles, 0.6 most of the way there, 0.8 clean, and text
 * is indistinguishable from unblurred at all three.
 */
const MODEL_INPUT_BLUR = 0.8;

type Size = { width: number; height: number };

export type UpscalePlan =
  /** Dense enough as it stands: re-encode, change nothing. */
  | { kind: "keep" }
  /** Shrink to `modelInput`, run the 4x model, resample to `target`. */
  | { kind: "model"; target: Size; modelInput: Size };

/**
 * Decide what to feed the model and what size to finish at.
 *
 * PURE. `worstDpi` is the density at the most demanding size, from the
 * source's pixel count; `oversize` is how many times bigger the source is
 * than the detail on it (see `measureOversize`), 1 for a sharp one.
 *
 * The model's cost scales with its input pixels and its output is always 4x
 * its input, so the input is never larger than a quarter of the target: a
 * 2000x3000 source headed for ~3600x5400 would otherwise run as 8000x12000,
 * six times the tiles for pixels a Lanczos shrink then throws away. The model
 * regenerates its detail from the shrunk copy, which sharpens soft artwork
 * rather than preserving every source pixel.
 *
 * An oversized source goes further and is shrunk to the size its detail
 * really is. Blown-up artwork is blurred edges and enlarged JPEG blocks, and
 * the model was trained on sharp-but-small input: handed the blur it sharpens
 * the blur, and handed the blocks it draws them as texture. At its true size
 * the same file is a clean, crisp, small image, which is exactly what the
 * model is good at — and fewer pixels, so it is also quicker.
 *
 * The same reasoning catches a source that has the pixels but not the
 * detail. Its pixel count clears the floor, so it used to pass straight
 * through to print as soft as it arrived.
 */
export function planUpscale(source: {
  width: number;
  height: number;
  worstDpi: number;
  oversize: number;
}): UpscalePlan {
  const { width, height, worstDpi, oversize } = source;

  // 2% headroom: rounding the scale factor to integer target pixels, then
  // integer pixels again to a DPI ratio, can land a scale that was computed
  // to clear the floor EXACTLY a couple of DPI under it once both roundings
  // are through — verified against a wide sweep of source dimensions to be
  // the smallest margin that never leaves a shortfall.
  const toFloor = (DPI_FLOOR / worstDpi) * 1.02;

  if (worstDpi >= DPI_FLOOR) {
    // Enough pixels. Left alone unless they are mostly empty AND a quarter of
    // the target is still about all the detail there is to feed the model.
    const detailKept = (toFloor / MODEL_SCALE) * oversize;
    if (worstDpi / oversize >= DPI_FLOOR || detailKept < MIN_DETAIL_KEPT) {
      return { kind: "keep" };
    }
  }

  // Under 1 for an oversized source that already clears the floor: its
  // master is cut down to what print needs rather than kept at a size that
  // holds nothing extra.
  const scale = Math.min(toFloor, MAX_SCALE);
  const target = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };

  // A quarter of the target lands the model's output on the target itself.
  // Smaller than that only for an oversized source, and only so far that the
  // stretch back up stays within MAX_POST_STRETCH.
  const fraction = Math.min(
    1,
    Math.max((MODEL_SCALE / scale) / oversize, 1 / MAX_POST_STRETCH),
  );
  // Never larger than the source: a target at or over 4x needs all of it,
  // and anything past that is the Lanczos stretch MAX_SCALE describes.
  const modelInput = {
    width: Math.min(width, Math.ceil((target.width / MODEL_SCALE) * fraction)),
    height: Math.min(height, Math.ceil((target.height / MODEL_SCALE) * fraction)),
  };

  return { kind: "model", target, modelInput };
}

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

  const started = Date.now();
  const { width, height } = job.probe;

  // The weakest size decides. Split posters measure per-panel, which
  // dpiBySize already accounts for.
  const worstDpi = Math.min(
    ...sizeIdsFor(job.kind).map((id) => job.probe!.dpiBySize[id]),
  );
  const oversize = await measureOversize(source);
  const plan = planUpscale({ width, height, worstDpi, oversize });

  // ICC profile from the ORIGINAL source: the AI stage works in raw pixel
  // buffers, which carry no colour metadata, so it has to be reattached here
  // rather than relying on withMetadata() to carry it through automatically.
  // sharp only accepts an ICC profile as a filesystem path, never as bytes,
  // so a source with an embedded profile is written out to a sidecar file.
  const iccBytes = (await sharp(source).metadata()).icc;
  const iccPath = iccBytes ? `${master}.icc` : null;
  if (iccPath && iccBytes) await writeFile(iccPath, iccBytes);

  if (plan.kind === "keep") {
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
    const { width: targetWidth, height: targetHeight } = plan.target;
    const { width: modelWidth, height: modelHeight } = plan.modelInput;

    // Orient first: the AI model must see the image the way it will actually
    // display, not however EXIF says to rotate it later. The shrink to the
    // size the plan chose happens in the same pass.
    const orientedPath = `${master}.oriented.png`;
    let oriented = sharp(source).autoOrient();
    if (modelWidth < width && modelHeight < height) {
      oriented = oriented.resize(modelWidth, modelHeight, {
        kernel: "lanczos3",
        fit: "fill",
      });
    }
    // Barely compressed, like the model's own output below: both are read
    // once and deleted. sharp applies the blur after the resize whatever
    // order they are chained in, which is the order wanted.
    await oriented
      .blur(MODEL_INPUT_BLUR)
      .png({ compressionLevel: 1 })
      .toFile(orientedPath);

    // The model is fixed at 4x. Run it once, then Lanczos to exactly the
    // size this job needs: DOWN by at most a few rounding pixels when its
    // input was a quarter of the target, or UP when the input was smaller —
    // an oversized source shrunk to its true size, or a target over 4x (the
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

    console.log(
      `upscale: ${job.sourceName} ${width}x${height}${
        oversize > 1 ? ` (${oversize}x oversized)` : ""
      } -> model ${modelWidth}x${modelHeight} -> ${targetWidth}x${targetHeight} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  const metadata = await sharp(master).metadata();
  const size = {
    width: metadata.width ?? width,
    height: metadata.height ?? height,
  };

  return {
    ...job.probe,
    ...size,
    upscaled: plan.kind === "model",
    dpiBySize: dpiBySize(size, job.kind),
    // Recomputed rather than carried over: a resample can change the aspect
    // ratio slightly through rounding, and coverage is derived from it.
    coverage: coverageFor(size, job.kind),
  };
}
