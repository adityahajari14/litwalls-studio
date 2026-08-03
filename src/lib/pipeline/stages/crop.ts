import "server-only";

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";

import { cropRectFor, toPixelRect } from "@/lib/image/crop-rect";
import { ensureDir, jobAsset, jobDir } from "@/lib/pipeline/paths";
import { MASTER_FILE } from "@/lib/pipeline/stages/upscale";
import {
  cropAspectFor,
  DPI_FLOOR,
  isLowRes,
  SIZE_IDS,
  targetPanelPixels,
  targetPixels,
} from "@/lib/print/sizes";
import { panelFileStem, panelRects, PANEL_INDICES } from "@/lib/print/split";
import type {
  NormRect,
  PosterJob,
  RenderedAsset,
  SizeId,
} from "@/lib/print/types";

/**
 * Cut print-ready files for every size, and for every panel of a split poster.
 *
 * Order of operations is load-bearing for splits: the master is cropped to the
 * SIZE's aspect first, and only then sliced into three strips. Cropping each
 * panel independently would let them drift apart by a pixel or two, and a
 * triptych whose seams do not line up on the wall is scrap paper.
 */

/** The crop to use for a size — a human's override wins over the computed one. */
export function cropForSize(
  job: PosterJob,
  sizeId: SizeId,
  source: { width: number; height: number },
): NormRect {
  const override = job.cropOverrides[sizeId];
  if (override) return override;

  return cropRectFor({
    source,
    targetAspect: cropAspectFor(sizeId, job.kind),
    subject: job.focal?.subject,
    anchor: job.focal?.anchor,
  });
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/**
 * Render one file: extract a region of the master and resize it to the target.
 *
 * `fit: "fill"` is deliberate — the region was computed to the exact target
 * aspect, so there is nothing to letterbox or crop further, and "fill" avoids
 * sharp silently adjusting dimensions by a pixel.
 */
async function renderOne(options: {
  masterPath: string;
  outPath: string;
  region: NormRect;
  source: { width: number; height: number };
  target: { width: number; height: number };
}): Promise<{ width: number; height: number; bytes: number }> {
  const px = toPixelRect(options.region, options.source);

  await sharp(options.masterPath)
    .extract({
      left: px.left,
      top: px.top,
      width: px.width,
      height: px.height,
    })
    .resize(options.target.width, options.target.height, {
      kernel: "lanczos3",
      fit: "fill",
    })
    // 92 is high enough that print output shows no visible artifacts, while
    // keeping a 13x19 well under the size where Drive uploads get tedious.
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(options.outPath);

  const [meta, stats] = await Promise.all([
    sharp(options.outPath).metadata(),
    stat(options.outPath),
  ]);

  return {
    width: meta.width ?? options.target.width,
    height: meta.height ?? options.target.height,
    bytes: stats.size,
  };
}

export async function cropAll(job: PosterJob): Promise<RenderedAsset[]> {
  if (!job.probe) throw new Error("crop requires a completed probe");

  const masterPath = jobAsset(job.batchId, job.id, MASTER_FILE);
  const source = { width: job.probe.width, height: job.probe.height };
  const orientation = source.width >= source.height ? "landscape" : "portrait";

  await ensureDir(`${jobDir(job.batchId, job.id)}/sizes`);

  const assets: RenderedAsset[] = [];

  for (const sizeId of SIZE_IDS) {
    const region = cropForSize(job, sizeId, source);

    if (job.kind === "split3") {
      const target = targetPanelPixels(sizeId, orientation);
      // All three panels derive from ONE parent rect, so their seams cannot
      // drift. See print/split.ts.
      const panels = panelRects(region);

      for (const panel of PANEL_INDICES) {
        const relPath = `sizes/${panelFileStem(sizeId, panel)}.jpg`;
        const outPath = jobAsset(job.batchId, job.id, relPath);
        const rect = panels[panel - 1];

        const result = await renderOne({
          masterPath,
          outPath,
          region: rect,
          source,
          target,
        });

        assets.push({
          sizeId,
          panel,
          relPath,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          dpi: job.probe.dpiBySize[sizeId],
          lowRes: isLowRes(job.probe.dpiBySize[sizeId]),
          crop: rect,
          sha256: await sha256(outPath),
        });
      }
    } else {
      const target = targetPixels(sizeId, orientation);
      const relPath = `sizes/${sizeId}.jpg`;
      const outPath = jobAsset(job.batchId, job.id, relPath);

      const result = await renderOne({
        masterPath,
        outPath,
        region,
        source,
        target,
      });

      assets.push({
        sizeId,
        panel: null,
        relPath,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        dpi: job.probe.dpiBySize[sizeId],
        lowRes: isLowRes(job.probe.dpiBySize[sizeId]),
        crop: region,
        sha256: await sha256(outPath),
      });
    }
  }

  return assets;
}

/** Sizes whose rendered files are stale because the crop changed. */
export function staleSizes(job: PosterJob): SizeId[] {
  return SIZE_IDS.filter((sizeId) => {
    const rendered = job.assets.filter((a) => a.sizeId === sizeId);
    if (rendered.length === 0) return true;

    const override = job.cropOverrides[sizeId];
    if (!override) return false;

    // A split's first panel starts at the parent crop's origin, so comparing
    // against the override's x works for both kinds.
    const first = rendered[0];
    return (
      Math.abs(first.crop.x - override.x) > 1e-9 ||
      Math.abs(first.crop.y - override.y) > 1e-9
    );
  });
}
