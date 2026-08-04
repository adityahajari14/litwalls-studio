import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFocalReply } from "../src/lib/gemini/focal.ts";
import { cropRectFor } from "../src/lib/image/crop-rect.ts";

/**
 * Gemini returns box_2d as [ymin, xmin, ymax, xmax] normalized 0-1000 —
 * y-first, and NOT 0-1. Both of those are easy to get backwards, and both
 * produce a near-zero-area rect that sharp then rejects with an error naming
 * neither the rect nor the image. These tests pin the conversion.
 */

test("converts 0-1000 y-first to 0..1 x-first", () => {
  // Upper-left quadrant: y 100-500, x 200-600.
  const result = parseFocalReply({ box_2d: [100, 200, 500, 600], confidence: 0.9 });
  assert.ok(result);
  assert.equal(result.box.x, 0.2);
  assert.equal(result.box.y, 0.1);
  assert.equal(result.box.width, 0.4);
  assert.equal(result.box.height, 0.4);
});

test("a full-frame box means the whole image", () => {
  const result = parseFocalReply({ box_2d: [0, 0, 1000, 1000], confidence: 0.2 });
  assert.ok(result);
  assert.deepEqual(result.box, { x: 0, y: 0, width: 1, height: 1 });
});

test("anchor is also y-first", () => {
  const result = parseFocalReply({
    box_2d: [100, 200, 500, 600],
    anchor: [300, 800],
    confidence: 0.8,
  });
  assert.ok(result);
  assert.equal(result.anchor.x, 0.8);
  assert.equal(result.anchor.y, 0.3);
});

test("anchor defaults to the box centre when absent", () => {
  const result = parseFocalReply({ box_2d: [0, 0, 500, 500], confidence: 0.5 });
  assert.ok(result);
  assert.equal(result.anchor.x, 0.25);
  assert.equal(result.anchor.y, 0.25);
});

test("reversed coordinates are tolerated, not trusted", () => {
  // A model that emits ymax before ymin should still produce a sane rect
  // rather than a negative-width one.
  const result = parseFocalReply({ box_2d: [500, 600, 100, 200], confidence: 0.5 });
  assert.ok(result);
  assert.equal(result.box.x, 0.2);
  assert.equal(result.box.width, 0.4);
});

test("rejects a box that would be a sliver", () => {
  // The signature of a 0..1 reply misread as 0..1000: everything collapses to
  // a near-zero rect. Falling back to a centre crop is far better than
  // extracting a one-pixel column.
  assert.equal(parseFocalReply({ box_2d: [0, 0, 1, 1], confidence: 0.9 }), null);
  assert.equal(
    parseFocalReply({ box_2d: [500, 500, 500, 500], confidence: 0.9 }),
    null,
  );
});

test("rejects out-of-range and malformed replies", () => {
  assert.equal(parseFocalReply({ box_2d: [0, 0, 2000, 500], confidence: 1 }), null);
  assert.equal(parseFocalReply({ box_2d: [0, 0, 500], confidence: 1 }), null);
  assert.equal(parseFocalReply({ box_2d: "nope", confidence: 1 }), null);
  assert.equal(parseFocalReply({ confidence: 1 }), null);
  assert.equal(parseFocalReply(null), null);
  assert.equal(parseFocalReply({ box_2d: [0, 0, "x", 500] }), null);
});

test("confidence is clamped and defaulted", () => {
  assert.equal(parseFocalReply({ box_2d: [0, 0, 500, 500], confidence: 5 })?.confidence, 1);
  assert.equal(parseFocalReply({ box_2d: [0, 0, 500, 500], confidence: -1 })?.confidence, 0);
  assert.equal(parseFocalReply({ box_2d: [0, 0, 500, 500] })?.confidence, 0.5);
});

test("a parsed focal box actually steers the crop", () => {
  // End to end: the whole point of parsing this is that crops move.
  //
  // A square source cropped to 0.707 uses the full height, so the crop can
  // only slide horizontally — steering shows up on x, not y. Asserting the
  // wrong axis here would test nothing.
  const source = { width: 2000, height: 2000 };
  const parsed = parseFocalReply({
    box_2d: [50, 50, 400, 400], // subject in the top-left
    confidence: 0.9,
  });
  assert.ok(parsed);

  const steered = cropRectFor({
    source,
    targetAspect: 0.707,
    subject: parsed.box,
    anchor: parsed.anchor,
  });
  const centred = cropRectFor({ source, targetAspect: 0.707 });

  assert.ok(
    steered.x < centred.x,
    `a left-hand subject should pull the crop left: ${steered.x} vs ${centred.x}`,
  );
  // And the subject must survive it — the property that actually matters.
  assert.ok(steered.x <= parsed.box.x + 1e-9, "subject clipped on the left");
  assert.ok(
    steered.x + steered.width >= parsed.box.x + parsed.box.width - 1e-9,
    "subject clipped on the right",
  );
});

test("a subject low in a tall source pulls the crop down", () => {
  // The vertical counterpart: a tall source cropped to a wide split band CAN
  // move on y, so this is where vertical steering is observable.
  const source = { width: 2000, height: 4000 };
  const parsed = parseFocalReply({ box_2d: [700, 100, 950, 900], confidence: 0.9 });
  assert.ok(parsed);

  const steered = cropRectFor({
    source,
    targetAspect: 2.121,
    subject: parsed.box,
    anchor: parsed.anchor,
  });
  const centred = cropRectFor({ source, targetAspect: 2.121 });

  assert.ok(
    steered.y > centred.y,
    `a low subject should pull the crop down: ${steered.y} vs ${centred.y}`,
  );
});
