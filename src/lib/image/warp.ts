import "server-only";

import sharp from "sharp";

import {
  boundsOf,
  invertHomography,
  isUsableQuad,
  solveHomography,
  UNIT_QUAD,
} from "@/lib/image/homography";
import type { Pt } from "@/lib/print/types";

export type RawImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
};

/**
 * Perspective-warp an image so its corners land on `corners`.
 *
 * INVERSE MAPPING, not forward. We iterate over destination pixels and pull
 * from the source, rather than iterating the source and scattering. Forward
 * mapping leaves unfilled holes wherever the transform stretches — every real
 * implementation goes backwards for this reason.
 *
 * Only the destination quad's bounding box is visited. A poster usually
 * occupies a fraction of a room photo, and skipping the rest is the difference
 * between ~170ms and ~40ms.
 *
 * Returns a raw RGBA buffer with alpha 0 outside the quad, so it composites
 * over the background with no rectangular halo.
 */
export async function warpPerspective(options: {
  source: string | Buffer;
  corners: readonly [Pt, Pt, Pt, Pt];
  canvas: { width: number; height: number };
}): Promise<RawImage | null> {
  const { corners, canvas } = options;

  if (!isUsableQuad(corners)) return null;

  const forward = solveHomography(UNIT_QUAD, corners);
  if (!forward) return null;
  const inverse = invertHomography(forward);
  if (!inverse) return null;

  const bounds = boundsOf(corners, canvas);
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return null;

  /**
   * Pre-downscale before sampling. THIS IS THE ONE NON-OBVIOUS QUALITY FIX.
   *
   * Inverse bilinear sampling minifies badly: a 4000px poster landing in a
   * 600px quad is effectively point-sampled, and the result aliases and
   * shimmers along every edge. Letting sharp do a proper area-averaged Lanczos
   * reduction first removes the artifact completely. Without this the mockups
   * look subtly broken in a way that is hard to attribute.
   */
  const quadWidth = Math.max(
    distance(corners[0], corners[1]),
    distance(corners[3], corners[2]),
  );
  const quadHeight = Math.max(
    distance(corners[0], corners[3]),
    distance(corners[1], corners[2]),
  );

  const prepared = sharp(options.source).ensureAlpha();
  const metadata = await prepared.metadata();
  if (!metadata.width || !metadata.height) return null;

  // A little headroom above the quad size keeps edges crisp without paying for
  // the full-resolution sample.
  const targetWidth = Math.min(
    metadata.width,
    Math.max(1, Math.ceil(quadWidth * 1.5)),
  );
  const targetHeight = Math.min(
    metadata.height,
    Math.max(1, Math.ceil(quadHeight * 1.5)),
  );

  const { data: src, info } = await prepared
    .resize(targetWidth, targetHeight, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sw = info.width;
  const sh = info.height;
  const sc = info.channels;

  // Zero-filled, so everything outside the quad is transparent by default.
  const out = Buffer.alloc(canvas.width * canvas.height * 4);

  const [i0, i1, i2, i3, i4, i5, i6, i7, i8] = inverse;
  const maxU = sw - 1;
  const maxV = sh - 1;

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      // Sample at the pixel centre; sampling at the corner shifts the whole
      // poster half a pixel up and left, which shows as a seam against a frame.
      const px = x + 0.5;
      const py = y + 0.5;

      const w = i6 * px + i7 * py + i8;
      if (w === 0) continue;

      // Unit-space coordinates, then scaled to source pixels. Working in unit
      // space is what lets one template serve any poster resolution.
      const u = ((i0 * px + i1 * py + i2) / w) * maxU;
      const v = ((i3 * px + i4 * py + i5) / w) * maxV;

      if (u < 0 || v < 0 || u > maxU || v > maxV) continue;

      // Bilinear sample. Nearest-neighbour aliases badly along the near edge
      // of a steep angle; bicubic costs roughly 3x for a difference nobody
      // sees at mockup size.
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, maxU);
      const y1 = Math.min(y0 + 1, maxV);
      const fx = u - x0;
      const fy = v - y0;

      const i00 = (y0 * sw + x0) * sc;
      const i10 = (y0 * sw + x1) * sc;
      const i01 = (y1 * sw + x0) * sc;
      const i11 = (y1 * sw + x1) * sc;

      const o = (y * canvas.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = (top * (1 - fy) + bottom * fy + 0.5) | 0;
      }
    }
  }

  return { data: out, width: canvas.width, height: canvas.height, channels: 4 };
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
