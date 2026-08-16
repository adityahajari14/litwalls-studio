import "server-only";

import type { Sharp } from "sharp";


/**
 * How a print-ready file is finished.
 *
 * Three things the pipeline was getting wrong, all verified by pushing a
 * source with a 300dpi tag and an ICC profile through the old code:
 *
 *   1. The DPI tag came out as 72. Pixel dimensions were right, so a printer
 *      sizing by dimensions was fine — but any workflow that reads density
 *      (most "place image" dialogs, and every automated preflight) saw a
 *      72dpi file and either warned or scaled it four times too large.
 *
 *   2. The ICC profile was stripped. A source exported in Adobe RGB or
 *      Display P3 then loses its meaning: the printer assumes sRGB, and
 *      saturated reds and cyans shift visibly. This is the difference that
 *      shows up as "the print doesn't match my screen".
 *
 *   3. No output sharpening. Every one of these files is resampled — usually
 *      DOWN, from a large master to a smaller sheet — and resampling always
 *      softens. Print softens it again, because ink spreads slightly on
 *      paper. Standard practice is a light sharpen as the last step.
 */

/**
 * Output sharpening, tuned for print rather than screen.
 *
 * Deliberately gentle. Over-sharpening produces halos along high-contrast
 * edges that look worse on paper than the softness it was meant to fix, and
 * unlike a screen there is no undoing it once printed.
 */
const SHARPEN = { sigma: 0.7, m1: 0.4, m2: 0.9 } as const;

/**
 * Finish a print file: sharpen, tag the real print density, keep the colour
 * profile.
 *
 * `withMetadata` is what carries the ICC profile through — sharp discards it
 * by default, which is the right default for web images and exactly wrong
 * here.
 */
export function finishPrintFile(
  pipeline: Sharp,
  options: { density: number; sharpen?: boolean },
): Sharp {
  const sharpened =
    options.sharpen === false ? pipeline : pipeline.sharpen(SHARPEN);

  // The density MUST be the file's real one, computed from its pixels against
  // its physical size — see printDpi(). A flat constant tells the printer the
  // wrong physical size, and being plausibly wrong is worse than obviously
  // wrong because nothing flags it.
  return sharpened.withMetadata({ density: options.density });
}

/**
 * JPEG settings for a print file.
 *
 * Quality 95 rather than the 92 used before: these are the files that get
 * printed, and the extra few hundred kilobytes cost nothing next to a visible
 * artifact on a wall.
 *
 * 4:4:4 chroma keeps full colour resolution. The default 4:2:0 halves it,
 * which shows as soft or fringed edges wherever saturated colour meets a hard
 * line — exactly what poster art is made of.
 *
 * `mozjpeg` gets better quality per byte from the same settings.
 */
export const PRINT_JPEG = {
  quality: 95,
  chromaSubsampling: "4:4:4",
  mozjpeg: true,
} as const;
