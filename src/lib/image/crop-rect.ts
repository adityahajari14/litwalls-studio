import type { NormRect, Pt } from "@/lib/print/types";

/**
 * Working out where to crop.
 *
 * PURE — no sharp, no filesystem. The review UI imports this to draw the crop
 * box, and the crop stage imports it to actually cut the pixels. Sharing one
 * implementation is what makes the on-screen preview exact rather than
 * approximate; two implementations would agree until one was edited.
 *
 * All rects are normalized 0..1 against the source image, so a crop chosen
 * before the upscale stage is still correct after it.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The largest rect of `targetAspect` (width/height) that fits inside an image
 * of `sourceAspect`, expressed in normalized coordinates.
 *
 * One of the two dimensions is always 1 — you can never do better than using
 * the whole of the constraining edge.
 */
function maxRectSize(
  sourceAspect: number,
  targetAspect: number,
): { width: number; height: number } {
  if (targetAspect > sourceAspect) {
    // Target is wider than the source: width is the constraint.
    return { width: 1, height: sourceAspect / targetAspect };
  }
  // Target is taller: height is the constraint.
  return { width: targetAspect / sourceAspect, height: 1 };
}

/**
 * Choose a crop of the requested aspect ratio that keeps the subject.
 *
 * The rules, in order:
 *
 *   1. Take the largest rect of the target aspect that fits. Cropping smaller
 *      than necessary throws away resolution we may need for a big print.
 *   2. If the subject fits inside that rect, slide the rect so it contains the
 *      whole subject — nudging the window is free, and beheading the character
 *      is the single most visible failure this pipeline can produce.
 *   3. If the subject does NOT fit (a wide subject in a tall crop, say), centre
 *      the rect on the anchor instead. Something has to be cut; the anchor says
 *      what to cut around.
 *   4. Clamp to the image. A rect that hangs off the edge would make sharp's
 *      extract() throw with a message that says nothing about why.
 *
 * `subject` and `anchor` come from Gemini, or from the neutral fallback of
 * "the whole frame, centred", which reduces this to a plain centre crop.
 */
export function cropRectFor(options: {
  /** Source pixel dimensions. */
  source: { width: number; height: number };
  /** Desired width/height ratio of the crop. */
  targetAspect: number;
  /** Region that should survive, normalized. Defaults to the whole frame. */
  subject?: NormRect;
  /** Where the eye should land when the subject cannot fit. */
  anchor?: Pt;
}): NormRect {
  const sourceAspect = options.source.width / options.source.height;
  const { width, height } = maxRectSize(sourceAspect, options.targetAspect);

  const subject = options.subject ?? { x: 0, y: 0, width: 1, height: 1 };
  const anchor = options.anchor ?? {
    x: subject.x + subject.width / 2,
    y: subject.y + subject.height / 2,
  };

  // Start centred on the anchor, then correct.
  let x = anchor.x - width / 2;
  let y = anchor.y - height / 2;

  // Rule 2: if the subject fits, make sure we actually contain it. Pulling the
  // window right to reveal a subject's left edge, and vice versa.
  if (subject.width <= width) {
    if (subject.x < x) x = subject.x;
    if (subject.x + subject.width > x + width) {
      x = subject.x + subject.width - width;
    }
  }
  if (subject.height <= height) {
    if (subject.y < y) y = subject.y;
    if (subject.y + subject.height > y + height) {
      y = subject.y + subject.height - height;
    }
  }

  // Rule 4: never hang off the edge.
  x = clamp(x, 0, 1 - width);
  y = clamp(y, 0, 1 - height);

  return { x, y, width, height };
}

/**
 * Convert a normalized rect to whole pixels for sharp's `extract`.
 *
 * Rounded, then clamped so rounding can never push the region past the last
 * row or column — sharp rejects an out-of-bounds extract with an error that
 * mentions neither the rect nor the image, and it is an infuriating half hour
 * to track down.
 *
 * Width and height are floored to at least 1: a degenerate rect from a
 * mis-parsed focal box should produce a bad-looking crop, not a hard failure
 * that stops a batch.
 */
export function toPixelRect(
  rect: NormRect,
  source: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const width = Math.max(1, Math.round(rect.width * source.width));
  const height = Math.max(1, Math.round(rect.height * source.height));
  const left = clamp(
    Math.round(rect.x * source.width),
    0,
    Math.max(0, source.width - width),
  );
  const top = clamp(
    Math.round(rect.y * source.height),
    0,
    Math.max(0, source.height - height),
  );
  return { left, top, width, height };
}

/** Whether a rect is inside the unit square and has real area. */
export function isValidRect(rect: NormRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x >= -1e-9 &&
    rect.y >= -1e-9 &&
    rect.x + rect.width <= 1 + 1e-9 &&
    rect.y + rect.height <= 1 + 1e-9
  );
}
