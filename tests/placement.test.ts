import assert from "node:assert/strict";
import { test } from "node:test";

import {
  physicalScale,
  quadForSize,
  rectForSize,
  scaleQuad,
  scaleRect,
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
