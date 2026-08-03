import type { NormRect } from "@/lib/print/types";

/** How many panels a split poster is printed across. */
export const PANEL_COUNT = 3;

export type PanelIndex = 1 | 2 | 3;

export const PANEL_INDICES: readonly PanelIndex[] = [1, 2, 3] as const;

/**
 * Slice a crop into the three panels of a split poster.
 *
 * ORDER OF OPERATIONS MATTERS. The artwork is cropped to the size's aspect
 * FIRST, and only then sliced into equal vertical strips. Slicing first and
 * cropping each panel independently would let the three panels drift out of
 * alignment by a pixel or two each — and a triptych whose seams do not line up
 * on the wall is scrap paper, not a product. Deriving all three from one
 * parent rect makes misalignment arithmetically impossible.
 *
 * The strips are exactly adjacent: panel 2 starts where panel 1 ends. Any gap
 * between them is a MOCKUP concern (see `panelGap` on a template), not a print
 * concern — the printed sheets butt together.
 *
 * Returned rects are normalized against the ORIGINAL image, not against the
 * parent crop, so they can be handed straight to a cropper without a second
 * coordinate change.
 */
export function panelRects(
  sizeCrop: NormRect,
): [NormRect, NormRect, NormRect] {
  const panelWidth = sizeCrop.width / PANEL_COUNT;
  return [0, 1, 2].map((i) => ({
    x: sizeCrop.x + panelWidth * i,
    y: sizeCrop.y,
    width: panelWidth,
    height: sizeCrop.height,
  })) as [NormRect, NormRect, NormRect];
}

/**
 * The normalized x positions of the two seams, for drawing them over the crop
 * editor.
 *
 * Shown so a human can see whether a seam lands on a face before publishing —
 * the one split-specific mistake that is obvious on screen and expensive on
 * paper.
 */
export function seamPositions(sizeCrop: NormRect): [number, number] {
  const panelWidth = sizeCrop.width / PANEL_COUNT;
  return [sizeCrop.x + panelWidth, sizeCrop.x + panelWidth * 2];
}

/** Filename stem for one rendered panel, e.g. "A3-p2". */
export function panelFileStem(sizeId: string, panel: PanelIndex): string {
  return `${sizeId}-p${panel}`;
}
