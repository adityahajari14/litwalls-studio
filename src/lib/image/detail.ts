import "server-only";

import sharp from "sharp";

/**
 * How much bigger an image is than the detail it actually holds.
 *
 * A poster saved from the web and blown up to 3000px wide has 3000 pixels but
 * the detail of the 750px file it started as — every edge is four pixels of
 * blur. Its pixel count says it prints at 210dpi; what is on it prints like
 * 50dpi. This measures the gap: 4 for that file, 1 for an image that is as
 * sharp as its size allows.
 *
 * The test is whether shrinking loses anything. Shrink the image by `k`,
 * stretch it back, and what differs from the original is the detail that only
 * existed above 1/k of its resolution. For a genuinely sharp image that loss
 * is large from the first step. For an oversized one it stays at nothing until
 * `k` reaches the size the image really is, and only then starts to climb.
 *
 * "Nothing" is judged against the image itself, not an absolute level: the
 * detail lost by shrinking to 1/k is compared with the detail in the next
 * octave down, between 1/k and 1/2k. That makes the answer independent of how
 * busy or how contrasty the artwork is — a flat graphic with three hard edges
 * and a dense photograph are both sharp if their fine detail is in proportion
 * to their coarse detail.
 */

/**
 * Shrink factors tested. Starting at 2.5 rather than 2 is deliberate: a sharp
 * image loses 7-15% at k=2 against a threshold of 6.5%, which is too close to
 * call, while at 2.5 it loses 20% or more. An image only 2x oversized is
 * therefore reported as sharp, which errs towards leaving a source alone.
 */
const CANDIDATES = [2.5, 3, 3.5, 4, 5, 6] as const;

/**
 * The smallest shrink measured, used as the baseline. Any resample loses a
 * little to the filter itself, and a JPEG's compression noise lives almost
 * entirely up here — neither is detail worth keeping, so both are subtracted
 * from every other measurement.
 */
const BASELINE = 1.25;

/**
 * Detail below a shrink factor counts as absent when it is under this
 * fraction of the detail in the next octave.
 *
 * Calibrated on real posters at known factors: files resampled up by 3x, 4x
 * and 6x come in under it at their true factor or the step below, and files
 * at their native size at 0.22 or more at every candidate. The largest factor
 * that passes is the answer, so the estimate lands on or just short of the
 * truth — short meaning a little less shrinking than was possible, never more.
 */
const ABSENT = 0.065;

/**
 * Measured on a centred window rather than the whole frame: the round trips
 * cost time in proportion to pixels, sharpness does not change with how much
 * of the picture is looked at, and the middle is where a poster's subject is.
 */
const WINDOW = 2400;

export async function measureOversize(path: string): Promise<number> {
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) return 1;

  const width = Math.min(meta.width, WINDOW);
  const height = Math.min(meta.height, WINDOW);
  // Too small for the deepest shrink to leave anything to measure.
  if (Math.min(width, height) < 256) return 1;

  const luma = await sharp(path)
    .extract({
      left: (meta.width - width) >> 1,
      top: (meta.height - height) >> 1,
      width,
      height,
    })
    .removeAlpha()
    .greyscale()
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  const raw = (w: number, h: number) =>
    ({ raw: { width: w, height: h, channels: 1 } }) as const;
  const resample = { fit: "fill", kernel: "lanczos3" } as const;

  const losses = new Map<number, Promise<number>>();
  /** Mean squared difference after shrinking by `k` and stretching back. */
  const lossAt = (k: number): Promise<number> => {
    const cached = losses.get(k);
    if (cached) return cached;

    const measured = (async () => {
      const w = Math.round(width / k);
      const h = Math.round(height / k);
      // `toColourspace` on each step: sharp widens single-channel raw input
      // back to three channels on output unless told otherwise.
      const small = await sharp(luma, raw(width, height))
        .resize(w, h, resample)
        .toColourspace("b-w")
        .raw()
        .toBuffer();
      const back = await sharp(small, raw(w, h))
        .resize(width, height, resample)
        .toColourspace("b-w")
        .raw()
        .toBuffer();

      let sum = 0;
      for (let i = 0; i < luma.length; i++) {
        const diff = luma[i] - back[i];
        sum += diff * diff;
      }
      return sum / luma.length;
    })();

    losses.set(k, measured);
    return measured;
  };

  const baseline = await lossAt(BASELINE);

  let oversize = 1;
  for (const k of CANDIDATES) {
    const below = Math.max(0, (await lossAt(k)) - baseline);
    const nextOctave = (await lossAt(2 * k)) - (await lossAt(k));
    // No detail in the next octave either means a blank or near-blank window,
    // which says nothing about sharpness.
    if (nextOctave > 1e-3 && below <= ABSENT * nextOctave) oversize = k;
  }
  return oversize;
}
