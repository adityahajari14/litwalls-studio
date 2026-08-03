import "server-only";

import { stat } from "node:fs/promises";
import sharp from "sharp";

import { jobAsset } from "@/lib/pipeline/paths";
import {
  cropAspectFor,
  DPI_FLOOR,
  dpiFor,
  SIZE_IDS,
  targetPanelPixels,
} from "@/lib/print/sizes";
import type { PosterJob, ProbeResult, SizeId } from "@/lib/print/types";

/**
 * Read the source image's real dimensions and work out what it can print at.
 *
 * Cheap and side-effect free — `sharp().metadata()` reads the header, not the
 * pixels — so it is always safe to re-run. That matters because every other
 * stage depends on these numbers.
 */
export async function probe(job: PosterJob): Promise<ProbeResult> {
  const path = jobAsset(job.batchId, job.id, job.sourceRelPath);

  const [metadata, stats] = await Promise.all([
    sharp(path).metadata(),
    stat(path),
  ]);

  // `autoOrient` is not used here, but EXIF orientation 5-8 means the stored
  // dimensions are transposed relative to how the image displays. Getting this
  // wrong would judge a portrait poster against landscape requirements and
  // reject perfectly good artwork.
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;

  if (!width || !height) {
    throw new Error(`Could not read image dimensions from ${job.sourceName}`);
  }

  return {
    width,
    height,
    format: metadata.format ?? "unknown",
    bytes: stats.size,
    upscaled: false,
    dpiBySize: dpiBySize({ width, height }, job.kind),
    coverage: coverageFor({ width, height }, job.kind),
  };
}

/**
 * How much of the source survives the most demanding crop.
 *
 * The binding case is whichever size needs the most extreme aspect ratio. For
 * a split poster that is very wide indeed, so a portrait source loses most of
 * its height — worth telling the user about before they publish.
 */
export function coverageFor(
  px: { width: number; height: number },
  kind: PosterJob["kind"],
): number {
  const sourceAspect = px.width / px.height;
  let worst = 1;

  for (const sizeId of SIZE_IDS) {
    const target = cropAspectFor(sizeId, kind);
    // The largest rect of `target` aspect inside the source keeps this
    // fraction of the total area — one edge is always fully used.
    const kept =
      target > sourceAspect ? sourceAspect / target : target / sourceAspect;
    worst = Math.min(worst, kept);
  }

  return worst;
}

/**
 * Effective print density at each size.
 *
 * For a split poster the density is measured against ONE PANEL, because that
 * is what actually gets printed on a sheet. A split A3 needs roughly three
 * times the horizontal pixels of a normal A3 to look the same on the wall,
 * which is why split jobs flag low-res far sooner — correct, not a bug.
 */
export function dpiBySize(
  px: { width: number; height: number },
  kind: PosterJob["kind"],
): Record<SizeId, number> {
  const out = {} as Record<SizeId, number>;
  const orientation = px.width >= px.height ? "landscape" : "portrait";

  for (const sizeId of SIZE_IDS) {
    if (kind === "split3") {
      // The source is divided across three panels, so each panel receives a
      // third of the width.
      const panel = targetPanelPixels(sizeId, orientation);
      const perPanel = { width: px.width / 3, height: px.height };
      out[sizeId] = dpiForTarget(perPanel, panel);
    } else {
      out[sizeId] = dpiFor(sizeId, px);
    }
  }
  return out;
}

/**
 * Density of `have` pixels against a `need` target.
 *
 * `need` is expressed at exactly DPI_FLOOR, so the ratio scales directly:
 * hitting the target dimensions means hitting the floor.
 */
function dpiForTarget(
  have: { width: number; height: number },
  need: { width: number; height: number },
): number {
  const ratio = Math.min(have.width / need.width, have.height / need.height);
  return Math.round(ratio * DPI_FLOOR);
}
