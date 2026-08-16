import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aspectFor,
  cropAspectFor,
  DPI_FLOOR,
  dpiFor,
  isLowRes,
  isUnprintable,
  printSize,
  SIZE_IDS,
  sizeIdsFor,
  SPLIT_SIZE_IDS,
  sizesFor,
  targetPanelPixels,
  targetPixels,
} from "../src/lib/print/sizes.ts";
import { panelRects, seamPositions } from "../src/lib/print/split.ts";

test("all four sizes are present", () => {
  assert.deepEqual([...SIZE_IDS], ["A5", "A4", "A3", "13x19"]);
});

test("split-3 offers three sizes, never A5", () => {
  assert.deepEqual([...SPLIT_SIZE_IDS], ["A4", "A3", "13x19"]);
  assert.deepEqual([...sizeIdsFor("split3")], ["A4", "A3", "13x19"]);
  assert.deepEqual(
    sizesFor("split3").map((s) => s.id),
    ["A4", "A3", "13x19"],
  );
});

test("a normal poster still offers every size", () => {
  assert.deepEqual([...sizeIdsFor("normal")], [...SIZE_IDS]);
});

test("A-series sizes share the same aspect ratio", () => {
  // A5/A4/A3 are all 1:√2. If a mirrored value is fat-fingered this catches it
  // even when check-drift is not run.
  const a5 = aspectFor("A5");
  assert.ok(Math.abs(a5 - aspectFor("A4")) < 0.005, "A4 differs from A5");
  assert.ok(Math.abs(a5 - aspectFor("A3")) < 0.005, "A3 differs from A5");
  assert.ok(Math.abs(a5 - 1 / Math.SQRT2) < 0.005, "not 1:root2");
});

test("dpiFor returns the floor when the image exactly meets it", () => {
  const size = printSize("A4");
  const dpi = dpiFor("A4", { width: size.minWidth, height: size.minHeight });
  assert.equal(dpi, DPI_FLOOR);
});

test("dpiFor is orientation-agnostic", () => {
  const size = printSize("A4");
  // The same sheet rotated must not be judged differently — rejecting a good
  // landscape image for being "too short" reads as the tool being broken.
  const portrait = dpiFor("A4", {
    width: size.minWidth,
    height: size.minHeight,
  });
  const landscape = dpiFor("A4", {
    width: size.minHeight,
    height: size.minWidth,
  });
  assert.equal(portrait, landscape);
});

test("dpiFor halves when the image is half size", () => {
  const size = printSize("A4");
  const dpi = dpiFor("A4", {
    width: size.minWidth / 2,
    height: size.minHeight / 2,
  });
  assert.equal(dpi, DPI_FLOOR / 2);
});

test("dpiFor is bound by the worst edge", () => {
  const size = printSize("A4");
  // Plenty of height, half the width: the width is what limits the print.
  const dpi = dpiFor("A4", {
    width: size.minWidth / 2,
    height: size.minHeight * 4,
  });
  assert.equal(dpi, DPI_FLOOR / 2);
});

test("low-res and unprintable thresholds", () => {
  assert.equal(isLowRes(249), true);
  assert.equal(isLowRes(250), false);
  assert.equal(isUnprintable(149), true);
  assert.equal(isUnprintable(150), false);
});

test("targetPixels follows the artwork orientation", () => {
  const portrait = targetPixels("A4", "portrait");
  const landscape = targetPixels("A4", "landscape");
  assert.ok(portrait.height > portrait.width);
  assert.ok(landscape.width > landscape.height);
  assert.equal(portrait.width, landscape.height);
});

test("a split panel is a FULL sheet, not a fraction of one", () => {
  // Buying "split A3" means receiving three A3 sheets. An earlier version
  // divided the sheet width by three, which would have printed three narrow
  // strips — the artwork would have been right and the paper wrong.
  const sheet = targetPixels("A3", "portrait");
  const panel = targetPanelPixels("A3");
  assert.deepEqual(panel, sheet);
});

test("panels are portrait regardless of the source's orientation", () => {
  const panel = targetPanelPixels("A3");
  assert.ok(panel.height > panel.width, "a triptych panel should be portrait");
});

test("three assembled panels match the split crop aspect", () => {
  // The property that keeps mockups honest: what gets cropped from the source
  // must be the same shape as what ends up on the wall. These disagreeing is
  // exactly how a circle turned into an ellipse in the first split mockup.
  for (const sizeId of SIZE_IDS) {
    const panel = targetPanelPixels(sizeId);
    const assembled = (panel.width * 3) / panel.height;
    const wanted = cropAspectFor(sizeId, "split3");
    assert.ok(
      Math.abs(assembled - wanted) < 0.01,
      `${sizeId}: assembled ${assembled.toFixed(3)} vs crop ${wanted.toFixed(3)}`,
    );
  }
});

test("split crop aspect is three portrait sheets wide", () => {
  assert.equal(cropAspectFor("A3", "split3"), aspectFor("A3") * 3);
  assert.equal(cropAspectFor("A3", "normal"), aspectFor("A3"));
  // A-series: 3 x 0.707 = 2.121, a wide band.
  assert.ok(Math.abs(cropAspectFor("A3", "split3") - 2.121) < 0.01);
});


test("panels tile the crop exactly, with no gap or overlap", () => {
  const crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
  const [p1, p2, p3] = panelRects(crop);

  // Each panel is a third of the parent width, at full parent height.
  for (const p of [p1, p2, p3]) {
    assert.ok(Math.abs(p.width - crop.width / 3) < 1e-12);
    assert.equal(p.height, crop.height);
    assert.equal(p.y, crop.y);
  }

  // Adjacency is the whole point: a seam that does not meet is scrap paper.
  assert.ok(Math.abs(p1.x + p1.width - p2.x) < 1e-12, "seam 1 does not meet");
  assert.ok(Math.abs(p2.x + p2.width - p3.x) < 1e-12, "seam 2 does not meet");

  // And together they cover the parent exactly.
  assert.ok(Math.abs(p1.x - crop.x) < 1e-12);
  assert.ok(Math.abs(p3.x + p3.width - (crop.x + crop.width)) < 1e-12);
});

test("seam positions sit at the panel boundaries", () => {
  const crop = { x: 0, y: 0, width: 0.9, height: 1 };
  const [a, b] = seamPositions(crop);
  const [, p2, p3] = panelRects(crop);
  assert.ok(Math.abs(a - p2.x) < 1e-12);
  assert.ok(Math.abs(b - p3.x) < 1e-12);
});
