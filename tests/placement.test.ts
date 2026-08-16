import assert from "node:assert/strict";
import { test } from "node:test";

import {
  physicalScale,
  quadForSize,
  rectForSize,
  scaleQuad,
  scaleRect,
  trueAspectRatio,
} from "../src/lib/templates/placement.ts";
import type { MockupTemplate } from "../src/lib/print/types.ts";

const FLAT: Extract<MockupTemplate, { kind: "flat" }> = {
  id: "room",
  name: "Room",
  kind: "flat",
  background: "background.jpg",
  canvas: { width: 2000, height: 1500 },
  rect: { x: 600, y: 200, width: 700, height: 990 },
};

test("physical scale matches the real size ratio", () => {
  // A5 is exactly half an A3 linearly — the A-series halves each step.
  assert.ok(Math.abs(physicalScale("A3", "A5") - 0.5) < 0.01);
  assert.ok(Math.abs(physicalScale("A5", "A3") - 2) < 0.02);
  assert.equal(physicalScale("A4", "A4"), 1);
  // A4 sits between them.
  const a4 = physicalScale("A3", "A4");
  assert.ok(a4 > 0.69 && a4 < 0.72, `A4/A3 should be ~0.707, got ${a4}`);
});

test("scaling a rect keeps its centre", () => {
  const rect = { x: 100, y: 200, width: 400, height: 600 };
  const half = scaleRect(rect, 0.5);

  // A poster hanging on a wall stays where it is when a smaller one is
  // ordered — it must not slide toward a corner.
  assert.equal(rect.x + rect.width / 2, half.x + half.width / 2);
  assert.equal(rect.y + rect.height / 2, half.y + half.height / 2);
  assert.equal(half.width, 200);
  assert.equal(half.height, 300);
});

test("scaling a quad keeps its centroid", () => {
  const quad = [
    { x: 100, y: 100 },
    { x: 500, y: 140 },
    { x: 500, y: 700 },
    { x: 100, y: 660 },
  ] as const;
  const half = scaleQuad(quad, 0.5);

  const cx = (q: readonly { x: number }[]) =>
    q.reduce((s, p) => s + p.x, 0) / q.length;
  const cy = (q: readonly { y: number }[]) =>
    q.reduce((s, p) => s + p.y, 0) / q.length;

  assert.ok(Math.abs(cx(quad) - cx(half)) < 1e-9);
  assert.ok(Math.abs(cy(quad) - cy(half)) < 1e-9);
  // And it really did shrink.
  assert.ok(half[1].x - half[0].x < quad[1].x - quad[0].x);
});

test("without sizing every size uses the base rect", () => {
  for (const sizeId of ["A5", "A4", "A3", "13x19"] as const) {
    assert.deepEqual(rectForSize(FLAT, sizeId), FLAT.rect);
  }
});

test("with sizing, other sizes derive by physical scale", () => {
  const template = {
    ...FLAT,
    sizing: { referenceSize: "A3" as const, base: FLAT.rect },
  };

  assert.deepEqual(rectForSize(template, "A3"), FLAT.rect);

  const a5 = rectForSize(template, "A5");
  // Half the linear size, so a quarter of the area.
  assert.ok(Math.abs(a5.width - FLAT.rect.width * 0.5) < 6);
  assert.ok(a5.width < FLAT.rect.width, "A5 must be smaller than A3");
  // Same place on the wall.
  assert.ok(
    Math.abs(
      a5.x + a5.width / 2 - (FLAT.rect.x + FLAT.rect.width / 2),
    ) < 1e-6,
  );
});

test("an override wins over the derived placement", () => {
  const custom = { x: 10, y: 20, width: 30, height: 40 };
  const template = {
    ...FLAT,
    sizing: {
      referenceSize: "A3" as const,
      base: FLAT.rect,
      overrides: { A5: custom },
    },
  };
  assert.deepEqual(rectForSize(template, "A5"), custom);
  // And it does not leak into the sizes that were not overridden.
  assert.notDeepEqual(rectForSize(template, "A4"), custom);
});

test("perspective quads derive and override the same way", () => {
  const corners = [
    { x: 700, y: 300 },
    { x: 1500, y: 420 },
    { x: 1500, y: 1280 },
    { x: 700, y: 1180 },
  ] as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];

  const template: Extract<MockupTemplate, { kind: "perspective" }> = {
    id: "hall",
    name: "Hall",
    kind: "perspective",
    background: "background.jpg",
    canvas: { width: 2400, height: 1600 },
    corners,
    sizing: { referenceSize: "A3", base: corners },
  };

  assert.deepEqual(quadForSize(template, "A3"), corners);

  const a5 = quadForSize(template, "A5");
  const widthOf = (q: readonly { x: number }[]) => q[1].x - q[0].x;
  assert.ok(widthOf(a5) < widthOf(corners), "A5 quad should be smaller");
  assert.ok(Math.abs(widthOf(a5) - widthOf(corners) * 0.5) < 8);
});

test("a bigger reference size scales the other way", () => {
  // Authoring against A5 means A3 must come out LARGER, not smaller.
  const template = {
    ...FLAT,
    sizing: { referenceSize: "A5" as const, base: FLAT.rect },
  };
  const a3 = rectForSize(template, "A3");
  assert.ok(a3.width > FLAT.rect.width, "A3 should be larger than the A5 base");
});

test("without a split placement, a split poster falls back to the single-sheet rect", () => {
  // This is the bug that motivated splitSizing: a triptych fitted into a box
  // drawn for one portrait sheet renders tiny, and a template with no split
  // box at all must still produce SOMETHING rather than throwing.
  assert.deepEqual(rectForSize(FLAT, "A3", true), FLAT.rect);
});

test("a split placement is used only when isSplit is true", () => {
  const wide = { x: 200, y: 400, width: 1600, height: 700 };
  const template = { ...FLAT, splitSizing: { base: wide } };

  assert.deepEqual(rectForSize(template, "A3", true), wide);
  // The single-sheet rect is untouched by the split box existing.
  assert.deepEqual(rectForSize(template, "A3", false), FLAT.rect);
});

test("split placement derives other sizes from the shared reference size", () => {
  const wide = { x: 200, y: 400, width: 1600, height: 700 };
  const template = {
    ...FLAT,
    sizing: { referenceSize: "A3" as const, base: FLAT.rect },
    splitSizing: { base: wide },
  };

  const a5 = rectForSize(template, "A5", true);
  assert.ok(Math.abs(a5.width - wide.width * 0.5) < 6);
  assert.ok(a5.width < wide.width, "A5 split box must be smaller than the A3 base");
});

test("a single sheet's true ratio is always portrait", () => {
  for (const sizeId of ["A5", "A4", "A3", "13x19"] as const) {
    const ratio = trueAspectRatio(sizeId, false, 1.2);
    assert.ok(ratio < 1, `${sizeId} should be portrait, got ratio ${ratio}`);
  }
});

test("a split-3 set's true ratio is always landscape, roughly 3 panels wide", () => {
  const ratio = trueAspectRatio("A3", true, 1.2);
  assert.ok(ratio > 1, "a triptych should be wider than it is tall");
  // Three panels at ~0.707 each, plus a couple of small gaps.
  assert.ok(ratio > 2 && ratio < 2.3, `expected roughly 2.1, got ${ratio}`);
});

test("a bigger panel gap widens the split ratio", () => {
  const noGap = trueAspectRatio("A3", true, 0);
  const withGap = trueAspectRatio("A3", true, 5);
  assert.ok(withGap > noGap, "more gap between panels means a wider set");
});

test("a split override wins over the derived split placement", () => {
  const wide = { x: 200, y: 400, width: 1600, height: 700 };
  const custom = { x: 10, y: 20, width: 30, height: 40 };
  const template = {
    ...FLAT,
    splitSizing: { base: wide, overrides: { A5: custom } },
  };

  assert.deepEqual(rectForSize(template, "A5", true), custom);
  assert.notDeepEqual(rectForSize(template, "A4", true), custom);
});
