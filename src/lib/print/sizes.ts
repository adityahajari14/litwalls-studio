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
  { id: "A5", label: "A5", mm: "148 × 210 mm", minWidth: 1748, minHeight: 2480 },
  { id: "A4", label: "A4", mm: "210 × 297 mm", minWidth: 2480, minHeight: 3508 },
  { id: "A3", label: "A3", mm: "297 × 420 mm", minWidth: 3508, minHeight: 4961 },
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
  minWidth: 3250,
  minHeight: 4750,
} as const;

export const SIZES = [...MIRRORED_SIZES, SUPER_B] as const;

export type PrintSize = (typeof SIZES)[number];

export const SIZE_IDS = SIZES.map((s) => s.id) as readonly SizeId[];

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
  orientation: "portrait" | "landscape",
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
 * A split product is one image across three sheets, so each panel is a third
 * of the width at full height. That means a split A3 needs three times the
 * horizontal resolution of a normal A3 to hit the same density — which is why
 * split jobs flag `lowRes` far sooner, and why that is correct rather than a
 * bug to tune away.
 */
export function targetPanelPixels(
  sizeId: SizeId,
  orientation: "portrait" | "landscape",
): { width: number; height: number } {
  const full = targetPixels(sizeId, orientation);
  return { width: Math.round(full.width / 3), height: full.height };
}

/**
 * The aspect ratio the source must be cropped to before slicing.
 *
 * For a normal poster this is just the size's aspect. For a split poster the
 * three panels are laid side by side, so the artwork as a whole is three
 * panels wide — the crop is three times as wide as a single sheet.
 */
export function cropAspectFor(sizeId: SizeId, kind: PosterKind): number {
  const aspect = aspectFor(sizeId);
  return kind === "split3" ? aspect * 3 : aspect;
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
