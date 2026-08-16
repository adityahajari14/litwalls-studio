import { printSize } from "@/lib/print/sizes";
import type {
  MockupTemplate,
  PlacementRect,
  Pt,
  SizeId,
} from "@/lib/print/types";

/**
 * Where a poster of a given size sits on a template's wall.
 *
 * PURE — shared by the renderer and by the template editor, so the box you
 * drag is exactly the box that gets composited.
 */

/**
 * How much larger one print size is than another, in the real world.
 *
 * Derived from the pixel floors rather than the millimetre strings: every size
 * is specified at the same DPI, so the pixel ratio IS the physical ratio, and
 * deriving it from numbers the drift check already guards means it cannot
 * silently disagree with the print sizes.
 */
export function physicalScale(from: SizeId, to: SizeId): number {
  const a = printSize(from);
  const b = printSize(to);
  const longA = Math.max(a.minWidth, a.minHeight);
  const longB = Math.max(b.minWidth, b.minHeight);
  return longB / longA;
}

/**
 * The TRUE width:height ratio of what actually gets placed on the wall — a
 * single print sheet, or an assembled split-3 panel set. Not a shape a
 * template author gets to invent: it is the real physical proportions of the
 * object being shown, derived from the same millimetre dimensions the print
 * sizes are defined by.
 *
 * A single sheet is always portrait (every print size is width < height). A
 * split-3 set is the opposite: three sheets side by side, each contributing
 * its own width, plus the two gaps between them — inherently landscape.
 */
export function trueAspectRatio(
  sizeId: SizeId,
  isSplit: boolean,
  panelGapPercent: number,
): number {
  const size = printSize(sizeId);
  if (!isSplit) return size.widthMm / size.heightMm;

  const gapMm = size.widthMm * (panelGapPercent / 100);
  return (size.widthMm * 3 + gapMm * 2) / size.heightMm;
}

/**
 * Scale a rect about its own centre.
 *
 * Centre rather than a corner because a poster hanging on a wall stays where
 * it is when you order a smaller one — it does not slide left. Anchoring to a
 * corner makes a size change look like the poster moved.
 */
export function scaleRect(rect: PlacementRect, scale: number): PlacementRect {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  // Rounded to whole pixels: sharp's composite rejects a fractional `left` or
  // `top` outright, and a scale factor like 1/√2 produces fractions for almost
  // every input. Rounding here rather than at each call site means no caller
  // can forget.
  return {
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width,
    height,
  };
}

/** Scale a quad about its centroid, for the same reason. */
export function scaleQuad(
  quad: readonly Pt[],
  scale: number,
): [Pt, Pt, Pt, Pt] {
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / quad.length;
  const cy = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
  return quad.map((p) => ({
    x: Math.round(cx + (p.x - cx) * scale),
    y: Math.round(cy + (p.y - cy) * scale),
  })) as [Pt, Pt, Pt, Pt];
}

/**
 * The rect a flat template uses for a given size.
 *
 * `isSplit` selects `splitSizing` instead of `rect`/`sizing` — a split-3
 * poster's assembled panel set is a different shape from a single sheet, and
 * needs its own box on the wall. Falls back to the single-sheet placement
 * when the template has not defined a split one, so existing templates keep
 * working exactly as before this existed.
 */
export function rectForSize(
  template: Extract<MockupTemplate, { kind: "flat" }>,
  sizeId: SizeId,
  isSplit = false,
): PlacementRect {
  if (isSplit && template.splitSizing) {
    const { base, overrides } = template.splitSizing;
    const referenceSize = referenceSizeOf(template);
    const override = overrides?.[sizeId];
    if (override) return override;
    if (sizeId === referenceSize) return base;
    return scaleRect(base, physicalScale(referenceSize, sizeId));
  }

  const sizing = template.sizing;
  if (!sizing) return template.rect;

  const override = sizing.overrides?.[sizeId];
  if (override) return override;

  if (sizeId === sizing.referenceSize) return sizing.base;
  return scaleRect(sizing.base, physicalScale(sizing.referenceSize, sizeId));
}

/** The corner quad a perspective template uses for a given size. See
 *  `rectForSize` — same `isSplit` behaviour, just for the angled geometry. */
export function quadForSize(
  template: Extract<MockupTemplate, { kind: "perspective" }>,
  sizeId: SizeId,
  isSplit = false,
): [Pt, Pt, Pt, Pt] {
  if (isSplit && template.splitSizing) {
    const { base, overrides } = template.splitSizing;
    const referenceSize = referenceSizeOf(template);
    const override = overrides?.[sizeId];
    if (override) return override;
    if (sizeId === referenceSize) return base;
    return scaleQuad(base, physicalScale(referenceSize, sizeId));
  }

  const sizing = template.sizing;
  if (!sizing) return template.corners;

  const override = sizing.overrides?.[sizeId];
  if (override) return override;

  if (sizeId === sizing.referenceSize) return sizing.base;
  return scaleQuad(sizing.base, physicalScale(sizing.referenceSize, sizeId));
}

/** Whether this template should render a separate mockup per size. */
export function isPerSize(template: MockupTemplate): boolean {
  return template.sizing?.perSize === true;
}

/** The size a single, non-per-size mockup is rendered at. */
export function referenceSizeOf(template: MockupTemplate): SizeId {
  return template.sizing?.referenceSize ?? "A3";
}

/** Whether this template has a placement box of its own for a split-3
 *  poster's assembled panel set, rather than falling back to the
 *  single-sheet one. */
export function hasSplitPlacement(template: MockupTemplate): boolean {
  return Boolean(template.splitSizing);
}
