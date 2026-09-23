import "server-only";

import { askGemini, geminiConfigured, prepareImage } from "@/lib/gemini/client";
import { printSize } from "@/lib/print/sizes";
import { trueAspectRatio } from "@/lib/templates/placement";
import type { PlacementRect, SizeId } from "@/lib/print/types";

/**
 * Ask Gemini where a poster of a given real size hangs on a wall photo, and
 * how big it looks.
 *
 * A mockup template's placement box is otherwise drawn entirely by eye. The
 * derived sizes are honest relative to each other (`physicalScale`), but
 * whether the reference box is life-size-correct on THIS wall is a guess. This
 * turns that guess into a model estimate that reads scale cues in the photo —
 * a door is about 2000mm, a light switch about 1200mm off the floor, a sofa
 * back about 850mm.
 *
 * Only the single-sheet portrait `sizing.base` is produced. The split and
 * landscape boxes, and per-size overrides, stay the author's job.
 */

const DEFAULT_REFERENCE_SIZE: SizeId = "A3";

const SCHEMA = {
  type: "object",
  properties: {
    box_2d: {
      type: "array",
      items: { type: "integer" },
      minItems: 4,
      maxItems: 4,
    },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["box_2d", "confidence"],
} as const;

type RawPlacement = {
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  reason: string;
};

function buildPrompt(size: { widthMm: number; heightMm: number }): string {
  return [
    "This is a photo of a room. A poster is going to be composited onto the",
    "main, most face-on wall in the frame.",
    "",
    `The poster's real printed size is ${size.widthMm}mm wide by ${size.heightMm}mm`,
    "tall (portrait). Work out where it should hang and how large it should",
    "appear, at true scale, using visible size cues: an interior door is about",
    "2000mm tall and 800mm wide, a light switch sits about 1200mm above the",
    "floor, a sofa back is about 850mm high, skirting is about 100mm.",
    "",
    "Return JSON with:",
    '- "box_2d": [ymin, xmin, ymax, xmax] as integers 0..1000, normalized to',
    "  the image, for the rectangle the poster (its paper edge, no frame)",
    "  should occupy. Hang it at a natural height — roughly eye level, its",
    "  centre a little above the vertical middle of the wall.",
    '- "confidence": 0 to 1. Low if the wall is cropped, angled, or has no',
    "  usable scale cue.",
    '- "reason": one short sentence naming the cue you scaled from.',
    "",
    "If you cannot find the wall or any scale reference, return",
    "[350, 380, 650, 620] with confidence 0.15.",
  ].join("\n");
}

export function parsePlacementReply(value: unknown): RawPlacement | null {
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

  // A degenerate or off-canvas box means the model misread the format — better
  // to fall back than to build a sub-pixel placement.
  if (width < 0.03 || height < 0.03) return null;
  if (x < -0.02 || y < -0.02 || x + width > 1.02 || y + height > 1.02) {
    return null;
  }

  return {
    box: {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(width, 1),
      height: Math.min(height, 1),
    },
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : 0.5,
    reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 160) : "",
  };
}

export type WallPlacement = {
  base: PlacementRect;
  referenceSize: SizeId;
  source: "gemini" | "fallback";
  confidence: number;
  reason: string;
};

/**
 * Reshape a pixel rect to a target width:height ratio without growing it, keep
 * its centre, and pull it back inside the canvas.
 *
 * The model's box is only approximately A-series shaped; the renderer needs it
 * exact or the poster is letterboxed inside its own placement area.
 */
export function conformToCanvas(
  rect: PlacementRect,
  aspect: number,
  canvas: { width: number; height: number },
): PlacementRect {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  let width = rect.width;
  let height = rect.height;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;

  // Never wider or taller than the canvas itself.
  if (width > canvas.width) {
    width = canvas.width;
    height = width / aspect;
  }
  if (height > canvas.height) {
    height = canvas.height;
    width = height * aspect;
  }

  const x = Math.min(Math.max(cx - width / 2, 0), canvas.width - width);
  const y = Math.min(Math.max(cy - height / 2, 0), canvas.height - height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** The centred half-height default — the same shape `createTemplate` writes,
 *  but conformed to the true print ratio. */
export function fallbackPlacement(
  canvas: { width: number; height: number },
  referenceSize: SizeId,
): WallPlacement {
  const aspect = trueAspectRatio(referenceSize, false, 0);
  const height = Math.round(canvas.height * 0.5);
  const width = Math.round(height * aspect);
  return {
    base: conformToCanvas(
      {
        x: Math.round((canvas.width - width) / 2),
        y: Math.round((canvas.height - height) / 2),
        width,
        height,
      },
      aspect,
      canvas,
    ),
    referenceSize,
    source: "fallback",
    confidence: 0,
    reason: "",
  };
}

export async function analyzeWallPlacement(options: {
  image: string | Buffer;
  canvas: { width: number; height: number };
  referenceSize?: SizeId;
  /** Kept for symmetry with `trueAspectRatio`; a single sheet ignores it. */
  panelGap?: number;
}): Promise<WallPlacement> {
  const referenceSize = options.referenceSize ?? DEFAULT_REFERENCE_SIZE;
  const aspect = trueAspectRatio(referenceSize, false, options.panelGap ?? 0);

  if (!geminiConfigured()) return fallbackPlacement(options.canvas, referenceSize);

  try {
    const size = printSize(referenceSize);
    const image = await prepareImage(options.image);
    const result = await askGemini<RawPlacement>({
      prompt: buildPrompt(size),
      image,
      schema: SCHEMA as unknown as Record<string, unknown>,
      parse: parsePlacementReply,
    });

    if (!result.ok) {
      console.warn(`gemini placement: ${result.error}`);
      return fallbackPlacement(options.canvas, referenceSize);
    }

    const pixels: PlacementRect = {
      x: result.value.box.x * options.canvas.width,
      y: result.value.box.y * options.canvas.height,
      width: result.value.box.width * options.canvas.width,
      height: result.value.box.height * options.canvas.height,
    };

    return {
      base: conformToCanvas(pixels, aspect, options.canvas),
      referenceSize,
      source: "gemini",
      confidence: result.value.confidence,
      reason: result.value.reason,
    };
  } catch (cause) {
    console.warn(
      `gemini placement threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return fallbackPlacement(options.canvas, referenceSize);
  }
}
