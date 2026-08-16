import "server-only";

import { askGemini, geminiConfigured, prepareImage } from "@/lib/gemini/client";
import type { NormRect } from "@/lib/print/types";

/**
 * Ask the model where to crop for one specific aspect ratio.
 *
 * The normal path uses a single subject box and slides a window over it, which
 * is right when the source and the target are roughly the same shape. It falls
 * apart when they are not — a tall poster cut to a wide three-panel band, or a
 * wide artwork cut to A5 portrait. There the question is not "keep the subject
 * in frame" but "which part of this picture is a good picture at this shape",
 * and that is a judgement about composition rather than geometry.
 *
 * Only used when the shapes genuinely disagree, because it costs an API call
 * per size and the geometric answer is fine the rest of the time.
 */

const SCHEMA = {
  type: "object",
  properties: {
    box_2d: {
      type: "array",
      items: { type: "integer" },
      minItems: 4,
      maxItems: 4,
    },
    reason: { type: "string" },
  },
  required: ["box_2d"],
} as const;

/**
 * How far the shapes must diverge before it is worth asking.
 *
 * 1.35 means one is a third again as elongated as the other — around where a
 * centred window starts cutting things a person would have kept. Below that
 * the geometric crop and the model tend to agree, so the call is wasted.
 */
export const REFRAME_THRESHOLD = 1.35;

export function needsReframe(
  sourceAspect: number,
  targetAspect: number,
): boolean {
  const ratio =
    sourceAspect > targetAspect
      ? sourceAspect / targetAspect
      : targetAspect / sourceAspect;
  return ratio >= REFRAME_THRESHOLD;
}

type RawReframe = { rect: NormRect; reason: string };

function parse(value: unknown): RawReframe | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const box = raw.box_2d;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;

  // Gemini returns [ymin, xmin, ymax, xmax] normalized 0-1000, y first.
  const x = Math.min(xmin, xmax) / 1000;
  const y = Math.min(ymin, ymax) / 1000;
  const width = Math.abs(xmax - xmin) / 1000;
  const height = Math.abs(ymax - ymin) / 1000;

  if (width < 0.05 || height < 0.05) return null;
  if (x < -0.01 || y < -0.01 || x + width > 1.01 || y + height > 1.01) {
    return null;
  }

  return {
    rect: {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(width, 1 - Math.max(0, x)),
      height: Math.min(height, 1 - Math.max(0, y)),
    },
    reason: typeof raw.reason === "string" ? raw.reason : "",
  };
}

/**
 * The best crop of `targetAspect` from this artwork.
 *
 * Returns null on any failure, and the caller falls back to the geometric
 * crop — a worse crop is a far better outcome than a dead batch.
 */
export async function reframeForAspect(options: {
  image: string | Buffer;
  sourceName: string;
  targetAspect: number;
  label: string;
}): Promise<{ rect: NormRect; reason: string } | null> {
  if (!geminiConfigured()) return null;

  const shape =
    options.targetAspect >= 1
      ? `${options.targetAspect.toFixed(2)}:1 (wider than tall)`
      : `1:${(1 / options.targetAspect).toFixed(2)} (taller than wide)`;

  const prompt = [
    `This poster artwork has to be cropped to ${shape} for a ${options.label} print.`,
    "That is a very different shape from the original, so a centred crop would",
    "cut badly. Choose the crop that makes the best PICTURE at that shape.",
    "",
    "Judge it as a composition, not as a bounding box:",
    "- keep the subject whole, and keep its eyes and face if there are any",
    "- keep any text or logo fully inside the crop, or leave it out entirely —",
    "  half a word is worse than none",
    "- prefer a crop that still reads as deliberate framing rather than an",
    "  arbitrary slice",
    "",
    "Return JSON:",
    '- "box_2d": [ymin, xmin, ymax, xmax] as integers 0-1000, normalized to the',
    `  image. It MUST have an aspect ratio of about ${options.targetAspect.toFixed(3)}`,
    "  (width divided by height) and be as large as possible within the image.",
    '- "reason": under 12 words, what you kept and why.',
  ].join("\n");

  try {
    const image = await prepareImage(options.image);
    const result = await askGemini<RawReframe>({
      prompt,
      image,
      schema: SCHEMA as unknown as Record<string, unknown>,
      parse,
    });

    if (!result.ok) {
      console.warn(`gemini reframe (${options.sourceName}): ${result.error}`);
      return null;
    }
    return result.value;
  } catch (cause) {
    console.warn(
      `gemini reframe (${options.sourceName}) threw: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

/**
 * Force a rect to an exact aspect ratio, keeping its centre.
 *
 * The model returns a box that is approximately the right shape; the renderer
 * needs it exact, or the output is letterboxed or stretched. Shrinking to fit
 * rather than growing guarantees the result still lies inside the image.
 */
export function conformToAspect(
  rect: NormRect,
  targetAspect: number,
  source: { width: number; height: number },
): NormRect {
  // Aspect is measured in PIXELS, so a rect in normalized space has to be
  // scaled by the source dimensions before comparing.
  const pxWidth = rect.width * source.width;
  const pxHeight = rect.height * source.height;
  const current = pxWidth / pxHeight;

  let width = rect.width;
  let height = rect.height;

  if (current > targetAspect) {
    width = (pxHeight * targetAspect) / source.width;
  } else {
    height = pxWidth / targetAspect / source.height;
  }

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  let x = cx - width / 2;
  let y = cy - height / 2;

  // Slide back inside the frame rather than shrinking further — a crop that
  // hangs off the edge would make sharp's extract throw.
  x = Math.min(Math.max(x, 0), Math.max(0, 1 - width));
  y = Math.min(Math.max(y, 0), Math.max(0, 1 - height));

  return { x, y, width: Math.min(width, 1), height: Math.min(height, 1) };
}
