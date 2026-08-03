import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyH,
  boundsOf,
  invertHomography,
  isUsableQuad,
  quadArea,
  solveHomography,
  UNIT_QUAD,
} from "../src/lib/image/homography.ts";
import type { Pt } from "../src/lib/print/types.ts";

function assertClose(actual: number, expected: number, epsilon = 1e-6, what = "") {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${what} expected ${expected}, got ${actual}`,
  );
}

/** Every corner of `src` must land on the matching corner of `dst`. */
function assertCornersMap(src: readonly Pt[], dst: readonly Pt[]) {
  const h = solveHomography(src, dst);
  assert.ok(h, "solve returned null");
  for (let i = 0; i < 4; i++) {
    const got = applyH(h, src[i]);
    assert.ok(got, `corner ${i} mapped to the horizon`);
    assertClose(got.x, dst[i].x, 1e-6, `corner ${i} x`);
    assertClose(got.y, dst[i].y, 1e-6, `corner ${i} y`);
  }
  return h;
}

test("unit square maps onto an arbitrary quad, corner for corner", () => {
  // THE load-bearing property. If this holds, a poster lands exactly where the
  // template says it should.
  assertCornersMap(UNIT_QUAD, [
    { x: 690, y: 300 },
    { x: 1520, y: 415 },
    { x: 1505, y: 1290 },
    { x: 705, y: 1180 },
  ]);
});

test("solves when a corner sits at the origin", () => {
  // The case partial pivoting exists for: a zero on the diagonal. Templates
  // are often authored flush to an edge, so this is common, not exotic.
  assertCornersMap(UNIT_QUAD, [
    { x: 0, y: 0 },
    { x: 800, y: 40 },
    { x: 780, y: 900 },
    { x: 20, y: 860 },
  ]);
});

test("handles a strong keystone", () => {
  // Far edge much shorter than the near edge — a sharply angled wall. This is
  // precisely what affine() cannot represent.
  assertCornersMap(UNIT_QUAD, [
    { x: 400, y: 300 },
    { x: 900, y: 380 },
    { x: 1000, y: 1200 },
    { x: 300, y: 1100 },
  ]);
});

test("a pure rectangle still works", () => {
  // Degenerate in the sense that no perspective is involved — the flat case
  // must not need a separate code path.
  const h = assertCornersMap(UNIT_QUAD, [
    { x: 100, y: 200 },
    { x: 500, y: 200 },
    { x: 500, y: 800 },
    { x: 100, y: 800 },
  ]);
  // The centre of the unit square should land at the centre of the rect.
  const centre = applyH(h, { x: 0.5, y: 0.5 });
  assert.ok(centre);
  assertClose(centre.x, 300, 1e-6, "centre x");
  assertClose(centre.y, 500, 1e-6, "centre y");
});

test("inverse maps destination corners back to the source", () => {
  // This is the direction the warp actually uses: for each output pixel, pull
  // from the source. An inverse that is subtly wrong produces a skewed poster
  // that still looks plausible, which is the worst kind of bug.
  const dst = [
    { x: 690, y: 300 },
    { x: 1520, y: 415 },
    { x: 1505, y: 1290 },
    { x: 705, y: 1180 },
  ];
  const h = solveHomography(UNIT_QUAD, dst);
  assert.ok(h);
  const inv = invertHomography(h);
  assert.ok(inv, "inverse returned null");

  for (let i = 0; i < 4; i++) {
    const back = applyH(inv, dst[i]);
    assert.ok(back);
    assertClose(back.x, UNIT_QUAD[i].x, 1e-6, `inverse corner ${i} x`);
    assertClose(back.y, UNIT_QUAD[i].y, 1e-6, `inverse corner ${i} y`);
  }
});

test("forward then inverse is the identity for interior points", () => {
  const h = solveHomography(UNIT_QUAD, [
    { x: 120, y: 90 },
    { x: 980, y: 210 },
    { x: 1010, y: 1400 },
    { x: 60, y: 1180 },
  ]);
  assert.ok(h);
  const inv = invertHomography(h);
  assert.ok(inv);

  for (const p of [
    { x: 0.25, y: 0.25 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.1 },
    { x: 0.33, y: 0.77 },
  ]) {
    const forward = applyH(h, p);
    assert.ok(forward);
    const back = applyH(inv, forward);
    assert.ok(back);
    assertClose(back.x, p.x, 1e-6, "round-trip x");
    assertClose(back.y, p.y, 1e-6, "round-trip y");
  }
});

test("degenerate quads return null instead of NaN", () => {
  // Three collinear corners cannot define a projection. Returning null lets
  // the template loader say "this is malformed"; NaNs would surface much later
  // as a blank mockup with no explanation.
  assert.equal(
    solveHomography(UNIT_QUAD, [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ]),
    null,
  );
  assert.equal(
    solveHomography(UNIT_QUAD, [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]),
    null,
  );
});

test("wrong-length inputs are rejected", () => {
  assert.equal(solveHomography(UNIT_QUAD.slice(0, 3), UNIT_QUAD), null);
});

test("quadArea measures a known rectangle", () => {
  const area = quadArea([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 0, y: 5 },
  ]);
  assertClose(Math.abs(area), 50, 1e-9, "area");
});

test("isUsableQuad accepts sane quads", () => {
  assert.equal(
    isUsableQuad([
      { x: 690, y: 300 },
      { x: 1520, y: 415 },
      { x: 1505, y: 1290 },
      { x: 705, y: 1180 },
    ]),
    true,
  );
});

test("isUsableQuad rejects a bow-tie", () => {
  // Corners in the wrong order — the single most likely authoring mistake.
  // It has area and it solves, but renders as a poster folded through itself,
  // so catching it here turns a baffling image into a clear error.
  assert.equal(
    isUsableQuad([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]),
    false,
  );
});

test("isUsableQuad rejects zero area and non-finite corners", () => {
  assert.equal(
    isUsableQuad([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]),
    false,
  );
  assert.equal(
    isUsableQuad([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]),
    false,
  );
});

test("boundsOf clamps to the canvas", () => {
  const bounds = boundsOf(
    [
      { x: -50, y: -20 },
      { x: 5000, y: 10 },
      { x: 4000, y: 3000 },
      { x: -10, y: 2000 },
    ],
    { width: 1000, height: 800 },
  );
  assert.equal(bounds.minX, 0);
  assert.equal(bounds.minY, 0);
  assert.equal(bounds.maxX, 999);
  assert.equal(bounds.maxY, 799);
});
