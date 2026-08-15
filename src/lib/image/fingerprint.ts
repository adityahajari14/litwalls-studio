import "server-only";

import sharp from "sharp";

/**
 * Perceptual fingerprints, for spotting artwork already in the catalogue.
 *
 * At 154 products and growing, re-uploading something already published is
 * easy to do and currently only discovered after it is live. A cryptographic
 * hash would not help — a re-export at different JPEG quality has entirely
 * different bytes and is visibly the same poster.
 *
 * dHash: reduce to a tiny greyscale image and record whether each pixel is
 * brighter than the one to its right. Gradients survive rescaling, re-encoding
 * and mild colour shifts, which is exactly the set of changes that produce a
 * "different file, same poster".
 */

const WIDTH = 9;
const HEIGHT = 8;

/** A 64-bit fingerprint as 16 hex characters. */
export async function fingerprint(source: string | Buffer): Promise<string> {
  const { data } = await sharp(source)
    // Flattened onto grey, so a transparent PNG and the same art on white do
    // not fingerprint differently.
    .flatten({ background: { r: 128, g: 128, b: 128 } })
    .greyscale()
    .resize(WIDTH, HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
      const left = data[y * WIDTH + x];
      const right = data[y * WIDTH + x + 1];
      bits += left > right ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Differing bits between two fingerprints. 0 means identical. */
export function distance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;

  let total = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      total += xor & 1;
      xor >>= 1;
    }
  }
  return total;
}

/**
 * Distance below which two images are treated as the same artwork.
 *
 * Chosen to catch re-encodes and rescales while leaving room for genuinely
 * different posters of the same subject — two Spider-Man posters share a
 * palette and a silhouette and can land surprisingly close. This flags for a
 * human rather than blocking, so a false positive costs a glance and a false
 * negative costs a duplicate product.
 */
export const DUPLICATE_THRESHOLD = 6;

export function isProbableDuplicate(a: string, b: string): boolean {
  return distance(a, b) <= DUPLICATE_THRESHOLD;
}
