import type { PosterJob, PosterKind, ProbeResult } from "@/lib/print/types";

/**
 * Which way round a poster is.
 *
 * PURE — the crop stage, the probe, the mockup renderer and the review UI all
 * ask this question, and they used to each answer it inline with their own
 * comparison. Two of them used `>` and one used `>=`, so a perfectly square
 * source was landscape to the cropper and portrait to the mockup renderer —
 * which meant the print file and the mockup of it disagreed about what shape
 * the poster was.
 */

export type Orientation = "portrait" | "landscape";

/**
 * The orientation of an image, from its pixels.
 *
 * A square counts as PORTRAIT. Something has to break the tie, and portrait is
 * the house default: every print size is portrait, and a square artwork
 * printed on a portrait sheet is what the catalogue already does.
 */
export function orientationOf(px: { width: number; height: number }): Orientation {
  return px.width > px.height ? "landscape" : "portrait";
}

/** The other one. */
export function flipOrientation(orientation: Orientation): Orientation {
  return orientation === "portrait" ? "landscape" : "portrait";
}

/**
 * The orientation the PRINT FILES for a job are cut in.
 *
 * A split-3 is always portrait here regardless of its source: a panel is a
 * full portrait sheet by construction (see `targetPanelPixels`), so three
 * portrait sheets is what gets printed whichever way round the artwork is.
 * The set as a whole hangs landscape — that is `productOrientation`, a
 * different question.
 *
 * Falls back to portrait for a job that has not been probed yet, which is the
 * same shape the catalogue defaults to.
 */
export function printOrientation(
  job: Pick<PosterJob, "kind" | "probe">,
): Orientation {
  if (job.kind === "split3") return "portrait";
  return job.probe ? orientationOf(job.probe) : "portrait";
}

/**
 * The orientation of the finished PRODUCT — what the customer hangs on a
 * wall, and what the orientation tag and badge report.
 *
 * A split-3 set is three portrait sheets side by side: roughly 2.12:1, so it
 * hangs landscape even though every sheet in the box is portrait. Tagging it
 * "Portrait" because of the sheets would tell a shopper filtering for wide
 * artwork exactly the wrong thing.
 */
export function productOrientation(
  job: Pick<PosterJob, "kind" | "probe">,
): Orientation {
  if (job.kind === "split3") return "landscape";
  return job.probe ? orientationOf(job.probe) : "portrait";
}

/** Same question, for a bare probe result and kind — for callers that have
 *  the probe but not a whole job (the ingest path builds one). */
export function productOrientationOf(
  kind: PosterKind,
  probe: Pick<ProbeResult, "width" | "height"> | null,
): Orientation {
  if (kind === "split3") return "landscape";
  return probe ? orientationOf(probe) : "portrait";
}
