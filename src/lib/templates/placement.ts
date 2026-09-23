import { printSize } from "@/lib/print/sizes";
import type {
  MockupTemplate,
  PlacementRect,
  PosterKind,
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
 * Turn a placement box on its side, keeping its centre and staying on canvas.
 *
 * The fallback shape for a landscape single poster on a template that has no
 * `landscapeSizing` of its own. The alternative — handing back the portrait
 * box unchanged — is what `fitRect` used to receive, and a wide poster fitted
 * inside a tall box is bound by WIDTH: an A3 landscape ended up occupying
 * about half the wall area the template author drew, floating in the middle
 * of its own box. Turning the box instead gives the poster the same area the
 * portrait one gets, in the shape it actually is.
 *
 * Clamped rather than allowed off-canvas: a box drawn near the top of a tall
 * wall becomes wider than the space beside it, and `sharp` rejects a
 * negative composite offset outright.
 */
export function flipRect(
  rect: PlacementRect,
  canvas: { width: number; height: number },
): PlacementRect {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const width = Math.min(Math.round(rect.height), canvas.width);
  const height = Math.min(Math.round(rect.width), canvas.height);
  return {
    x: Math.round(Math.min(Math.max(cx - width / 2, 0), canvas.width - width)),
    y: Math.round(Math.min(Math.max(cy - height / 2, 0), canvas.height - height)),
    width,
    height,
  };
}

/**
 * The rect a flat template uses for a given size.
 *
 * `isSplit` selects `splitSizing` instead of `rect`/`sizing` — a split-3
 * poster's assembled panel set is a different shape from a single sheet, and
 * needs its own box on the wall. `isLandscape` selects `landscapeSizing` the
 * same way, for a single poster whose source is wide rather than tall. The
 * two never both apply — a split set's shape is fixed regardless of the
 * source's orientation — so `isSplit` is checked first and wins if a caller
 * somehow passes both.
 *
 * `isSplitVertical` only means anything alongside `isSplit`: it selects
 * `splitVerticalSizing` — a SEPARATE, independently-authored box for showing
 * the same assembled panel set turned on a particular wall photo, kept apart
 * from `splitSizing` on purpose. They used to be the same field, with the
 * editor's Vertical/Horizontal toggle flipping it in place; that meant
 * repositioning the box for a vertical preview overwrote whatever had been
 * authored for the horizontal one, since there was only ever one box to
 * disagree with itself. Two fields means editing one cannot touch the other.
 *
 * A template that has not defined the relevant box still gets a sensible
 * answer: a split set falls back to the single-sheet placement, a landscape
 * single falls back to that placement TURNED ON ITS SIDE, and a vertical
 * split falls back to the (possibly also-fallback) horizontal split box
 * turned the same way — see `flipRect` for why the un-turned box is the
 * wrong fallback.
 */
export function rectForSize(
  template: Extract<MockupTemplate, { kind: "flat" }>,
  sizeId: SizeId,
  isSplit = false,
  isLandscape = false,
  isSplitVertical = false,
): PlacementRect {
  if (isSplit) {
    if (isSplitVertical) {
      if (template.splitVerticalSizing) {
        const { base, overrides } = template.splitVerticalSizing;
        const referenceSize = referenceSizeOf(template);
        const override = overrides?.[sizeId];
        if (override) return override;
        if (sizeId === referenceSize) return base;
        return scaleRect(base, physicalScale(referenceSize, sizeId));
      }
      // No vertical box authored: turn the horizontal one (itself possibly
      // a fallback) on its side rather than leaving the wide set shrunk
      // inside a box drawn for a tall one.
      return flipRect(splitRectFor(template, sizeId), template.canvas);
    }
    return splitRectFor(template, sizeId);
  }

  if (!isSplit && isLandscape) {
    if (template.landscapeSizing) {
      const { base, overrides } = template.landscapeSizing;
      const referenceSize = referenceSizeOf(template);
      const override = overrides?.[sizeId];
      if (override) return override;
      if (sizeId === referenceSize) return base;
      return scaleRect(base, physicalScale(referenceSize, sizeId));
    }
    // No landscape box authored: turn the portrait one on its side rather
    // than shrinking a wide poster into a tall box. See `flipRect`.
    return flipRect(portraitRectFor(template, sizeId), template.canvas);
  }

  return portraitRectFor(template, sizeId);
}

/** The single-sheet, portrait placement — the base case every other branch
 *  of `rectForSize` falls back to. */
function portraitRectFor(
  template: Extract<MockupTemplate, { kind: "flat" }>,
  sizeId: SizeId,
): PlacementRect {
  const sizing = template.sizing;
  if (!sizing) return template.rect;

  const override = sizing.overrides?.[sizeId];
  if (override) return override;

  if (sizeId === sizing.referenceSize) return sizing.base;
  return scaleRect(sizing.base, physicalScale(sizing.referenceSize, sizeId));
}

/** The horizontal split-3 placement — what `isSplitVertical`'s own fallback
 *  turns on its side, and what `isSplit` alone resolves to. Falls back to
 *  the single-sheet placement when `splitSizing` itself is not set. */
function splitRectFor(
  template: Extract<MockupTemplate, { kind: "flat" }>,
  sizeId: SizeId,
): PlacementRect {
  const split = template.splitSizing;
  if (!split) return portraitRectFor(template, sizeId);

  const { base, overrides } = split;
  const referenceSize = referenceSizeOf(template);
  const override = overrides?.[sizeId];
  if (override) return override;

  if (sizeId === referenceSize) return base;
  return scaleRect(base, physicalScale(referenceSize, sizeId));
}

/**
 * The corner quad a perspective template uses for a given size. See
 * `rectForSize` — same `isSplit`/`isLandscape`/`isSplitVertical` selection.
 *
 * A vertical split box is used only when explicitly authored: unlike the flat
 * case, there is no automatic turn for an angled quad — swapping width and
 * height is meaningless once corners are no longer axis-aligned, and the
 * editor never offers this toggle for a perspective template in the first
 * place. Absent `splitVerticalSizing`, this falls back to the horizontal
 * split quad UNCHANGED, the same way a perspective landscape single falls
 * back to the untouched portrait corners.
 */
export function quadForSize(
  template: Extract<MockupTemplate, { kind: "perspective" }>,
  sizeId: SizeId,
  isSplit = false,
  isLandscape = false,
  isSplitVertical = false,
): [Pt, Pt, Pt, Pt] {
  if (isSplit && isSplitVertical && template.splitVerticalSizing) {
    const { base, overrides } = template.splitVerticalSizing;
    const referenceSize = referenceSizeOf(template);
    const override = overrides?.[sizeId];
    if (override) return override;
    if (sizeId === referenceSize) return base;
    return scaleQuad(base, physicalScale(referenceSize, sizeId));
  }

  if (isSplit && template.splitSizing) {
    const { base, overrides } = template.splitSizing;
    const referenceSize = referenceSizeOf(template);
    const override = overrides?.[sizeId];
    if (override) return override;
    if (sizeId === referenceSize) return base;
    return scaleQuad(base, physicalScale(referenceSize, sizeId));
  }

  if (!isSplit && isLandscape && template.landscapeSizing) {
    const { base, overrides } = template.landscapeSizing;
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

/**
 * Whether a template's author says it fits a poster of this kind and
 * orientation.
 *
 * PURE and shared with the browser, so the batch form can pre-tick the same
 * templates the render pipeline would auto-pick. A missing `suits`, or an
 * empty array on a facet, means "no restriction on that facet" — the
 * behaviour every template had before the field existed.
 */
export function templateSuits(
  template: Pick<MockupTemplate, "suits">,
  poster: { kind: PosterKind; orientation: "portrait" | "landscape" },
): boolean {
  const formats = template.suits?.formats;
  if (formats && formats.length > 0 && !formats.includes(poster.kind)) {
    return false;
  }
  const orientations = template.suits?.orientations;
  if (
    orientations &&
    orientations.length > 0 &&
    !orientations.includes(poster.orientation)
  ) {
    return false;
  }
  return true;
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

/** Whether this template has a placement box of its own for a landscape
 *  single poster, rather than falling back to the portrait box turned on
 *  its side. */
export function hasLandscapePlacement(template: MockupTemplate): boolean {
  return Boolean(template.landscapeSizing);
}

/** Whether this template has its OWN placement box for a split-3 set shown
 *  turned, independent of `splitSizing` — rather than falling back to that
 *  horizontal box turned on its side at render time. */
export function hasSplitVerticalPlacement(template: MockupTemplate): boolean {
  return Boolean(template.splitVerticalSizing);
}
