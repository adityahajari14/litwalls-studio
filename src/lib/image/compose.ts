import "server-only";

import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";

import { warpPerspective } from "@/lib/image/warp";
import { TEMPLATES_DIR } from "@/lib/pipeline/paths";
import {
  quadForSize,
  rectForSize,
  referenceSizeOf,
} from "@/lib/templates/placement";
import { printSize } from "@/lib/print/sizes";
import type { MockupTemplate, Pt, SizeId } from "@/lib/print/types";

/**
 * Place a poster into a room photo.
 *
 * Two geometries, one entry point. Flat templates are an axis-aligned rect and
 * need only a resize; perspective templates go through the homography warp.
 * Callers never branch on which — a template is chosen for how it looks, not
 * for how it is implemented.
 */

/**
 * Assemble split panels into one image, with a gap between them.
 *
 * `gapPercent` is a PERCENTAGE OF PANEL WIDTH, not a pixel count, and that is
 * the whole point. A fixed pixel gap is specified at print resolution — an A3
 * panel is 3508px wide — and the assembled strip is then scaled down by
 * roughly twelve times to sit on a mockup wall. A 12px gap arrives as 0.8px
 * and disappears into the JPEG, which is why split mockups looked like one
 * wide poster rather than three.
 *
 * As a fraction of panel width it survives any scaling, so what is set here is
 * what shows up on the wall.
 */
export async function assemblePanels(
  panelPaths: string[],
  gapPercent: number,
  border?: { mm: number; sizeId: SizeId },
): Promise<Buffer> {
  // The border goes on EACH PANEL, not around the assembled strip. Three
  // panels are three sheets of paper, and the printer borders every one of
  // them — a single border around the outside would depict a product that
  // does not exist.
  const sources = border
    ? await Promise.all(
        panelPaths.map((path) => addWhiteBorder(path, border.mm, border.sizeId)),
      )
    : panelPaths;

  const metas = await Promise.all(
    sources.map((source) => sharp(source).metadata()),
  );

  const widths = metas.map((m) => m.width ?? 0);
  const height = Math.max(...metas.map((m) => m.height ?? 0));

  // At least 1px so a non-zero setting never rounds away to nothing on a
  // small panel, and 0 still means genuinely no gap.
  const gap =
    gapPercent > 0
      ? Math.max(1, Math.round((widths[0] * gapPercent) / 100))
      : 0;

  const totalWidth =
    widths.reduce((a, b) => a + b, 0) + gap * (sources.length - 1);

  let left = 0;
  const layers = [];
  for (let i = 0; i < sources.length; i++) {
    layers.push({ input: sources[i], left, top: 0 });
    left += widths[i] + gap;
  }

  // White between panels rather than transparent: this is how the set looks on
  // a wall, and a transparent gap would show the room through the poster.
  return sharp({
    create: {
      width: totalWidth,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/**
 * Add the white border the printer puts on every poster.
 *
 * Specified in MILLIMETRES and converted against the size's real physical
 * dimensions, so 0.5mm means 0.5mm whether the sheet is an A5 or a 13x19. A
 * percentage would silently mean a wider border on a larger print, which is
 * not what the printer does.
 *
 * The border is added OUTSIDE the artwork, growing the sheet — that is the
 * right way round, because the trimmed paper is the artwork plus its margin.
 * The placement code then fits the whole sheet into the template's rect, so
 * the paper fills the wall area exactly as it would in life.
 */
export async function addWhiteBorder(
  source: string | Buffer,
  mm: number,
  sizeId: SizeId,
): Promise<Buffer> {
  if (mm <= 0) return sharp(source).toBuffer();

  const metadata = await sharp(source).metadata();
  if (!metadata.width) return sharp(source).toBuffer();

  // At least 1px: below that the border rounds away and the setting appears
  // to do nothing, which reads as a bug rather than as a subtle border.
  const size = printSize(sizeId);
  const border = Math.max(
    1,
    Math.round((mm / size.widthMm) * metadata.width),
  );

  return sharp(source)
    .extend({
      top: border,
      bottom: border,
      left: border,
      right: border,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

/**
 * A drop shadow for a flat-mounted poster.
 *
 * Offset down-right and blurred, matching the usual convention of a light
 * source above and to the left. Subtle by design — the point is to lift the
 * poster off the wall, not to announce itself.
 */
function shadowLayer(
  rect: { x: number; y: number; width: number; height: number },
  strength: number,
) {
  const offset = Math.round(Math.max(rect.width, rect.height) * 0.012);
  const blur = Math.max(2, offset * 1.5);
  return {
    input: {
      create: {
        width: rect.width,
        height: rect.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: Math.min(1, strength) },
      },
    },
    left: rect.x + offset,
    top: rect.y + offset,
    blur,
  };
}

/**
 * Fit a poster inside a template's rect without distorting it.
 *
 * The rect is the maximum footprint on the wall, and the poster is scaled to
 * touch whichever edge binds first, then centred. This is what lets one flat
 * template serve both a portrait poster and a wide three-panel set — the
 * alternative is a separate template per format, which nobody will maintain.
 */
async function fitRect(
  poster: string | Buffer,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ x: number; y: number; width: number; height: number }> {
  const metadata = await sharp(poster).metadata();
  if (!metadata.width || !metadata.height) return rect;

  const scale = Math.min(
    rect.width / metadata.width,
    rect.height / metadata.height,
  );
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  return {
    // Rounded because sharp's composite rejects a fractional left/top with an
    // error that names the number but not the layer — and a hand-dragged or
    // scale-derived rect is fractional more often than not.
    x: Math.round(rect.x + (rect.width - width) / 2),
    // Bottom-aligned rather than centred: a poster that hangs lower than the
    // template intended looks placed, while one floating above its own shadow
    // looks like a compositing bug.
    y: Math.round(rect.y + (rect.height - height)),
    width,
    height,
  };
}

/**
 * Shrink a destination quad so the poster keeps its aspect ratio.
 *
 * The quad's own proportions are estimated from its edge lengths, then the
 * poster is inset within it in the quad's own coordinate space via bilinear
 * interpolation of the corners. Working in quad space rather than screen space
 * matters: the result stays on the wall plane, so the inset poster still looks
 * like it is hanging there rather than floating in front.
 *
 * Bottom-aligned, matching the flat path.
 */
async function fitQuad(
  poster: string | Buffer,
  corners: readonly Pt[],
): Promise<[Pt, Pt, Pt, Pt]> {
  const metadata = await sharp(poster).metadata();
  const quad = corners as [Pt, Pt, Pt, Pt];
  if (!metadata.width || !metadata.height) return quad;

  const [tl, tr, br, bl] = quad;
  const quadWidth = (dist(tl, tr) + dist(bl, br)) / 2;
  const quadHeight = (dist(tl, bl) + dist(tr, br)) / 2;
  if (quadWidth <= 0 || quadHeight <= 0) return quad;

  const posterAspect = metadata.width / metadata.height;
  const quadAspect = quadWidth / quadHeight;

  // Fractions of the quad the poster should occupy.
  let u = 1;
  let v = 1;
  if (posterAspect > quadAspect) {
    v = quadAspect / posterAspect; // poster is wider — lose height
  } else {
    u = posterAspect / quadAspect; // poster is taller — lose width
  }

  if (u > 0.999 && v > 0.999) return quad;

  const u0 = (1 - u) / 2;
  const u1 = u0 + u;
  // Bottom-aligned: keep v1 at 1 so the poster sits on the same baseline.
  const v0 = 1 - v;
  const v1 = 1;

  const at = (s: number, t: number): Pt => ({
    x:
      tl.x * (1 - s) * (1 - t) +
      tr.x * s * (1 - t) +
      bl.x * (1 - s) * t +
      br.x * s * t,
    y:
      tl.y * (1 - s) * (1 - t) +
      tr.y * s * (1 - t) +
      bl.y * (1 - s) * t +
      br.y * s * t,
  });

  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export type ComposeInput = {
  /** Which print size this mockup represents. Selects the placement area, so
   *  an A5 shows as a physically smaller poster on the same wall. */
  sizeId?: SizeId;
  /** The white border the printer adds, in mm. Omit for none. */
  borderMm?: number;
  /** Set when the border was already applied per panel during assembly. */
  preBordered?: boolean;
  template: MockupTemplate;
  /** The poster to place: a path, or a buffer for an assembled split set. */
  poster: string | Buffer;
  outPath: string;
};

export async function composeMockup(
  input: ComposeInput,
): Promise<{ width: number; height: number }> {
  const { template, outPath } = input;
  const sizeId = input.sizeId ?? referenceSizeOf(template);

  // A split set has already had the border applied per panel during assembly,
  // so it must not be bordered again around the whole strip.
  const poster =
    input.borderMm && input.borderMm > 0 && !input.preBordered
      ? await addWhiteBorder(input.poster, input.borderMm, sizeId)
      : input.poster;
  const dir = join(TEMPLATES_DIR, template.id);
  const background = join(dir, template.background);
  const canvas = template.canvas;

  const layers: OverlayOptions[] = [];

  if (template.kind === "flat") {
    // The template's rect declares WHERE the poster hangs and how big it may
    // be — not what shape it is. A 3-panel set is wide and a normal poster is
    // tall, and forcing either into the other's rect stretches the artwork:
    // circles become ellipses and faces get squashed. So the poster is fitted
    // inside the rect at its true aspect ratio, then centred.
    const rect = await fitRect(
      poster,
      rectForSize(template, sizeId),
    );

    if (template.shadow && template.shadow > 0) {
      const shadow = shadowLayer(rect, template.shadow);
      // sharp has no per-layer blur, so the shadow is pre-blurred separately
      // and composited as an ordinary image.
      const blurred = await sharp({
        create: {
          width: rect.width + shadow.blur * 4,
          height: rect.height + shadow.blur * 4,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: {
              create: {
                width: rect.width,
                height: rect.height,
                channels: 4,
                background: {
                  r: 0,
                  g: 0,
                  b: 0,
                  alpha: Math.min(1, template.shadow),
                },
              },
            },
            left: shadow.blur * 2,
            top: shadow.blur * 2,
          },
        ])
        .blur(shadow.blur)
        .png()
        .toBuffer();

      layers.push({
        input: blurred,
        left: shadow.left - shadow.blur * 2,
        top: shadow.top - shadow.blur * 2,
      });
    }

    const resized = await sharp(poster)
      .resize(rect.width, rect.height, { kernel: "lanczos3", fit: "fill" })
      .png()
      .toBuffer();

    layers.push({ input: resized, left: rect.x, top: rect.y });
  } else {
    const warped = await warpPerspective({
      source: poster,
      // Same reasoning as the flat path: the quad is the wall area, not the
      // poster's shape. Shrinking it to the poster's aspect keeps a wide split
      // set from being stretched to fill a portrait wall panel.
      corners: await fitQuad(
        poster,
        quadForSize(template, sizeId),
      ),
      canvas,
    });
    if (!warped) {
      throw new Error(
        `Template "${template.id}" has an unusable corner quad. ` +
          "Corners must be convex and in TL, TR, BR, BL order.",
      );
    }

    layers.push({
      input: warped.data,
      raw: { width: warped.width, height: warped.height, channels: 4 },
      left: 0,
      top: 0,
    });
  }

  if (template.overlay) {
    // The overlay carries glass glare and frame shadow, so it sits ON TOP and
    // is multiplied — it should darken what is beneath, not replace it.
    layers.push({
      input: join(dir, template.overlay),
      blend: "multiply",
    });
  }

  await sharp(background)
    .resize(canvas.width, canvas.height, { fit: "cover" })
    .composite(layers)
    .jpeg({ quality: 88 })
    .toFile(outPath);

  return { width: canvas.width, height: canvas.height };
}
