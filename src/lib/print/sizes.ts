import type { Orientation } from "@/lib/print/orientation";
import type { NormRect, PosterKind, SizeId } from "@/lib/print/types";

/**
 * The print catalogue: physical sizes, the resolution floor, and prices.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MIRRORED CONSTANTS — see `scripts/check-drift.mjs`
 *
 * `MIRRORED_SIZES` is a copy of `PRINT_SIZES` in
 * litwalls/src/lib/custom-poster.ts. Those numbers are not Studio's to choose:
 * they are the resolution promise the storefront already makes to customers on
 * the custom-poster page. If Studio's floor were laxer, it would publish a
 * poster the storefront would have refused to sell — the same artwork judged
 * acceptable or not depending on which door it came through.
 *
 * To change them: edit the storefront FIRST, then here. `npm run check:drift`
 * runs before `next dev` and fails the moment the two disagree.
 * ─────────────────────────────────────────────────────────────────────────
 */
const MIRRORED_SIZES = [
  { id: "A5", label: "A5", mm: "148 × 210 mm", widthMm: 148, heightMm: 210, minWidth: 1748, minHeight: 2480 },
  { id: "A4", label: "A4", mm: "210 × 297 mm", widthMm: 210, heightMm: 297, minWidth: 2480, minHeight: 3508 },
  { id: "A3", label: "A3", mm: "297 × 420 mm", widthMm: 297, heightMm: 420, minWidth: 3508, minHeight: 4961 },
] as const;

/**
 * Studio-only. An inch-based "Super B" that the storefront's custom-poster
 * flow does not offer, which is exactly why it lives outside the mirrored set:
 * adding it there would put it on the custom page too, offering customers a
 * size we only stock for our own catalogue.
 *
 * 13" × 19" at 250dpi = 3250 × 4750.
 */
const SUPER_B = {
  id: "13x19",
  label: '13" × 19"',
  mm: "330 × 483 mm",
  widthMm: 330,
  heightMm: 483,
  minWidth: 3250,
  minHeight: 4750,
} as const;

export const SIZES = [...MIRRORED_SIZES, SUPER_B] as const;

export type PrintSize = (typeof SIZES)[number];

export const SIZE_IDS = SIZES.map((s) => s.id) as readonly SizeId[];

/**
 * Split-3 posters are not sold at A5. A panel is a full sheet (see
 * `targetPanelPixels`), so a "split A5" would be three 148mm-wide panels —
 * a size nobody would print as a poster set. A5 is the one size split-3
 * genuinely does not offer, not merely a size we discourage.
 */
export const SPLIT_SIZE_IDS: readonly SizeId[] = SIZE_IDS.filter(
  (id) => id !== "A5",
);
export const SPLIT_SIZES: readonly PrintSize[] = SIZES.filter((size) =>
  (SPLIT_SIZE_IDS as readonly string[]).includes(size.id),
);

/** The sizes actually offered for a poster of this format. */
export function sizeIdsFor(kind: PosterKind): readonly SizeId[] {
  return kind === "split3" ? SPLIT_SIZE_IDS : SIZE_IDS;
}

/** Same, as full size records — for anywhere a label or mm string is needed. */
export function sizesFor(kind: PosterKind): readonly PrintSize[] {
  return kind === "split3" ? SPLIT_SIZES : SIZES;
}

export function printSize(id: SizeId): PrintSize {
  const size = SIZES.find((s) => s.id === id);
  // A missing size is a programmer error, not a user-facing failure: SizeId is
  // a closed union, so this can only fire if SIZES and SizeId drift apart.
  if (!size) throw new Error(`Unknown print size: ${id}`);
  return size;
}

/** Below this a print is visibly soft. Drives the warning badge. */
export const DPI_FLOOR = 250;

/**
 * Below this we refuse to publish outright. A print at 150dpi is mush, and no
 * amount of resampling changes that — the pixels were never captured.
 */
export const DPI_HARD_FLOOR = 150;

/**
 * Prices live in `print/pricing.ts`, not here.
 *
 * They resolve through three levels of override (poster → batch → dashboard
 * settings) and are user-editable at every one, so they are state rather than
 * a constant. Keeping them out of this file also keeps the mirrored size table
 * free of anything the drift check has no business comparing.
 */

/**
 * The target aspect ratio (short edge / long edge) for a size.
 *
 * Derived from the pixel floor rather than the millimetre string because the
 * pixels are what the cropper actually works in, and deriving both from one
 * source means they cannot disagree.
 */
export function aspectFor(sizeId: SizeId): number {
  const { minWidth, minHeight } = printSize(sizeId);
  return Math.min(minWidth, minHeight) / Math.max(minWidth, minHeight);
}

/**
 * Effective print density for an image at a given size.
 *
 * Orientation-agnostic — a landscape poster is the same sheet rotated, so we
 * compare long edge to long edge. Judging a perfectly good landscape image
 * against a portrait size would reject it for being "too short", which reads
 * to the user as the tool being broken.
 */
export function dpiFor(
  sizeId: SizeId,
  px: { width: number; height: number },
): number {
  const size = printSize(sizeId);
  const needLong = Math.max(size.minWidth, size.minHeight);
  const needShort = Math.min(size.minWidth, size.minHeight);
  const haveLong = Math.max(px.width, px.height);
  const haveShort = Math.min(px.width, px.height);

  // The binding constraint is whichever edge falls furthest short.
  const ratio = Math.min(haveLong / needLong, haveShort / needShort);
  return Math.round(ratio * DPI_FLOOR);
}

/**
 * Pixel dimensions to render for a size, in the orientation the artwork is in.
 *
 * A portrait poster gets portrait pixels and a landscape poster gets landscape
 * pixels; the sheet is the same either way.
 */
export function targetPixels(
  sizeId: SizeId,
  orientation: Orientation,
): { width: number; height: number } {
  const size = printSize(sizeId);
  const long = Math.max(size.minWidth, size.minHeight);
  const short = Math.min(size.minWidth, size.minHeight);
  return orientation === "portrait"
    ? { width: short, height: long }
    : { width: long, height: short };
}

/**
 * The pixels one PANEL of a split poster needs.
 *
 * A panel is a FULL SHEET, not a fraction of one. Buying "split A3" means
 * receiving three A3 sheets that hang side by side — so each panel is rendered
 * at the same dimensions as a normal A3, and the set as a whole is three
 * sheets wide.
 *
 * Panels are portrait by convention regardless of the source's orientation:
 * three tall sheets in a row is what a triptych looks like on a wall, and it
 * is the only arrangement where a landscape artwork reads correctly across
 * them.
 */
export function targetPanelPixels(sizeId: SizeId): {
  width: number;
  height: number;
} {
  return targetPixels(sizeId, "portrait");
}

/**
 * The aspect ratio the source must be cropped to before slicing.
 *
 * MUST agree with `targetPixels`, and this is the whole reason `orientation`
 * is a parameter rather than assumed. `renderOne` extracts a region of this
 * aspect and resizes it into `targetPixels` with `fit: "fill"` — no
 * letterboxing, no further cropping — so if this returns a portrait ratio
 * while `targetPixels` hands back landscape dimensions, the artwork is
 * squashed to half its width and nothing anywhere reports an error. That is
 * exactly what happened to every landscape poster before this took an
 * orientation.
 *
 * For a normal poster this is the size's own aspect, the right way round for
 * the artwork. For a split poster the three sheets sit side by side, so the
 * artwork spans three PORTRAIT sheets: three times as wide, one sheet tall.
 * For A-series that is 3 x 0.707 = 2.121.
 *
 * `orientation` is deliberately ignored for a split poster — the panels are
 * always portrait sheets (see `targetPanelPixels`), so the crop always has to
 * be this shape whichever way round the source is.
 */
export function cropAspectFor(
  sizeId: SizeId,
  kind: PosterKind,
  orientation: Orientation,
): number {
  const aspect = aspectFor(sizeId);
  if (kind === "split3") return aspect * 3;
  return orientation === "landscape" ? 1 / aspect : aspect;
}

/**
 * The density a rendered file for this size ACTUALLY has.
 *
 * Computed from its pixel dimensions against its real physical size, not from
 * DPI_FLOOR. Those are different numbers: the A-series pixel dimensions work
 * out to 300dpi while DPI_FLOOR is 250, and 13x19 genuinely is 250.
 *
 * Tagging every file with a flat 250 — which an earlier version of this did —
 * tells a printer that a 3508px A3 is 356mm wide instead of 297mm. It would
 * print 20% oversized, and unlike an obviously-wrong 72dpi tag, 250 looks
 * plausible enough to slip through.
 */
export function printDpi(sizeId: SizeId): number {
  const size = printSize(sizeId);
  return Math.round(size.minWidth / (size.widthMm / 25.4));
}

/** Millimetres converted to pixels at a size's real print density. */
export function mmToPixels(sizeId: SizeId, mm: number): number {
  const size = printSize(sizeId);
  return Math.round((mm / size.widthMm) * size.minWidth);
}

/** Whether a rendered asset is below the soft floor. */
export function isLowRes(dpi: number): boolean {
  return dpi < DPI_FLOOR;
}

/** Whether an asset is too poor to publish at all. */
export function isUnprintable(dpi: number): boolean {
  return dpi < DPI_HARD_FLOOR;
}

/** A crop covering the whole frame — the neutral default. */
export const FULL_FRAME: NormRect = { x: 0, y: 0, width: 1, height: 1 };
