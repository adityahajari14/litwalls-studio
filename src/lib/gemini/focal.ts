import "server-only";

import { askGemini, geminiConfigured, prepareImage } from "@/lib/gemini/client";
import type { FocalPoint, NormRect } from "@/lib/print/types";

/**
 * Find the region of a poster that must survive cropping.
 *
 * Four print sizes plus a split format means the same artwork is cut to five
 * different shapes. Without a focal point every crop is centred, which
 * beheads any subject that is not dead centre — the most visible failure this
 * pipeline can produce.
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
    anchor: {
      type: "array",
      items: { type: "integer" },
      minItems: 2,
      maxItems: 2,
    },
    confidence: { type: "number" },
  },
  required: ["box_2d", "confidence"],
} as const;

const PROMPT = [
  "Look at this poster artwork.",
  "",
  "Identify the single region that MUST NOT be cropped away — the face, the",
  "character, the main figure, or the focal graphic. This artwork will be cut",
  "to several different aspect ratios, and anything outside this region may be",
  "discarded.",
  "",
  "Return JSON with:",
  '- "box_2d": [ymin, xmin, ymax, xmax] as integers from 0 to 1000,',
  "  normalized to the image dimensions.",
  '- "anchor": [y, x] from 0 to 1000 — the single point the eye should land on,',
  "  used when the region cannot fully fit a narrow crop.",
  '- "confidence": 0 to 1.',
  "",
  "If the poster is an all-over pattern, texture or landscape with no single",
  "subject, return the full frame [0, 0, 1000, 1000] and confidence 0.2.",
].join("\n");

export type RawFocal = {
  box: NormRect;
  anchor: { x: number; y: number };
  confidence: number;
};

/**
 * Gemini returns box_2d as [ymin, xmin, ymax, xmax] normalized 0-1000.
 *
 * NOT 0-1, and the axis order is y-first. Getting either wrong yields a rect
 * of essentially zero area, which sharp's extract() then rejects with an error
 * mentioning neither the rect nor the image. Converting at this single
 * boundary keeps the rest of the codebase in ordinary 0..1 x-first space.
 */
export function parseFocalReply(value: unknown): RawFocal | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const box = raw.box_2d;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;

  const x = Math.min(xmin, xmax) / 1000;
  const y = Math.min(ymin, ymax) / 1000;
  const width = Math.abs(xmax - xmin) / 1000;
  const height = Math.abs(ymax - ymin) / 1000;

  // A degenerate box means the model misunderstood the format. Better to fall
  // back to a centre crop than to extract a one-pixel sliver.
  if (width < 0.02 || height < 0.02) return null;
  if (x < -0.01 || y < -0.01 || x + width > 1.01 || y + height > 1.01) return null;

  const clamped: NormRect = {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(width, 1 - Math.max(0, x)),
    height: Math.min(height, 1 - Math.max(0, y)),
  };

  const anchorRaw = raw.anchor;
  const anchor =
    Array.isArray(anchorRaw) && anchorRaw.length === 2
      ? { x: Number(anchorRaw[1]) / 1000, y: Number(anchorRaw[0]) / 1000 }
      : { x: clamped.x + clamped.width / 2, y: clamped.y + clamped.height / 2 };

  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;

  return {
    box: clamped,
    anchor: {
      x: Math.min(1, Math.max(0, anchor.x)),
      y: Math.min(1, Math.max(0, anchor.y)),
    },
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : 0.5,
  };
}

/**
 * The neutral fallback: the whole frame.
 *
 * This makes cropRectFor degrade to a plain centre crop, which is the correct
 * behaviour when nothing is known — not a guess dressed up as knowledge.
 */
export const FALLBACK_FOCAL: FocalPoint = {
  subject: { x: 0, y: 0, width: 1, height: 1 },
  anchor: { x: 0.5, y: 0.5 },
  confidence: 0,
  source: "fallback",
};

export async function findFocalPoint(options: {
  image: string | Buffer;
  sourceName: string;
}): Promise<FocalPoint> {
  if (!geminiConfigured()) return FALLBACK_FOCAL;

  try {
    const image = await prepareImage(options.image);
    const result = await askGemini<RawFocal>({
      prompt: PROMPT,
      image,
      schema: SCHEMA as unknown as Record<string, unknown>,
      parse: parseFocalReply,
    });

    if (!result.ok) {
      console.warn(`gemini focal (${options.sourceName}): ${result.error}`);
      return FALLBACK_FOCAL;
    }

    return {
      subject: result.value.box,
      anchor: result.value.anchor,
      confidence: result.value.confidence,
      source: "gemini",
    };
  } catch (cause) {
    console.warn(
      `gemini focal (${options.sourceName}) threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return FALLBACK_FOCAL;
  }
}
