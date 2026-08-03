import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cropRectFor,
  isValidRect,
  toPixelRect,
} from "../src/lib/image/crop-rect.ts";
import { aspectFor } from "../src/lib/print/sizes.ts";
import { coverageFor } from "../src/lib/pipeline/stages/probe.ts";
import { COVERAGE_WARN } from "../src/lib/print/types.ts";

const SQUARE = { width: 1000, height: 1000 };
const PORTRAIT = { width: 1000, height: 1500 };
const LANDSCAPE = { width: 1500, height: 1000 };

/** Actual aspect of a crop, in source pixels. */
function actualAspect(
  rect: { width: number; height: number },
  source: { width: number; height: number },
) {
  return (rect.width * source.width) / (rect.height * source.height);
}

test("crop matches the requested aspect ratio", () => {
  for (const source of [SQUARE, PORTRAIT, LANDSCAPE]) {
    for (const target of [0.5, 1, 1.5, aspectFor("A4"), aspectFor("A4") * 3]) {
      const rect = cropRectFor({ source, targetAspect: target });
      assert.ok(
        Math.abs(actualAspect(rect, source) - target) < 1e-9,
        `aspect ${target} on ${source.width}x${source.height} gave ${actualAspect(rect, source)}`,
      );
    }
  }
});

test("crop always stays inside the image", () => {
  for (const source of [SQUARE, PORTRAIT, LANDSCAPE]) {
    for (const target of [0.2, 0.7, 1, 2.1, 5]) {
      const rect = cropRectFor({ source, targetAspect: target });
      assert.ok(isValidRect(rect), `escaped bounds: ${JSON.stringify(rect)}`);
    }
  }
});

test("crop uses the whole constraining edge — no wasted resolution", () => {
  // A 1:1.5 crop from a 1:1.5 source should be the entire image.
  const rect = cropRectFor({ source: PORTRAIT, targetAspect: 1000 / 1500 });
  assert.ok(Math.abs(rect.width - 1) < 1e-9);
  assert.ok(Math.abs(rect.height - 1) < 1e-9);
});

test("with no subject the crop is centred", () => {
  const rect = cropRectFor({ source: LANDSCAPE, targetAspect: 1 });
  // Square crop from a landscape image: full height, centred horizontally.
  assert.ok(Math.abs(rect.height - 1) < 1e-9);
  assert.ok(Math.abs(rect.x - (1 - rect.width) / 2) < 1e-9);
});

test("crop slides to keep a subject that would otherwise be cut", () => {
  // Subject hard against the left edge of a landscape image, square crop.
  const rect = cropRectFor({
    source: LANDSCAPE,
    targetAspect: 1,
    subject: { x: 0.02, y: 0.3, width: 0.25, height: 0.4 },
  });
  assert.ok(
    rect.x <= 0.02 + 1e-9,
    `crop starts at ${rect.x}, would clip a subject at 0.02`,
  );
  assert.ok(isValidRect(rect));
});

test("crop slides the other way for a subject on the right", () => {
  const rect = cropRectFor({
    source: LANDSCAPE,
    targetAspect: 1,
    subject: { x: 0.73, y: 0.3, width: 0.25, height: 0.4 },
  });
  assert.ok(
    rect.x + rect.width >= 0.98 - 1e-9,
    "crop should extend far enough right to contain the subject",
  );
});

test("a contained subject stays fully inside the crop", () => {
  // The property that actually matters: no beheading.
  const subjects = [
    { x: 0.0, y: 0.0, width: 0.3, height: 0.3 },
    { x: 0.35, y: 0.4, width: 0.3, height: 0.2 },
    { x: 0.7, y: 0.7, width: 0.3, height: 0.3 },
  ];
  for (const subject of subjects) {
    for (const target of [0.7, 1, 1.4]) {
      const rect = cropRectFor({ source: SQUARE, targetAspect: target, subject });
      if (subject.width <= rect.width && subject.height <= rect.height) {
        assert.ok(
          rect.x <= subject.x + 1e-9 &&
            rect.x + rect.width >= subject.x + subject.width - 1e-9,
          `subject ${JSON.stringify(subject)} cut horizontally by ${JSON.stringify(rect)}`,
        );
        assert.ok(
          rect.y <= subject.y + 1e-9 &&
            rect.y + rect.height >= subject.y + subject.height - 1e-9,
          `subject ${JSON.stringify(subject)} cut vertically`,
        );
      }
    }
  }
});

test("an oversized subject falls back to the anchor", () => {
  // A subject spanning the full width cannot fit in a narrow crop. Something
  // must be cut, and the anchor decides what we cut around.
  const rect = cropRectFor({
    source: LANDSCAPE,
    targetAspect: 0.5,
    subject: { x: 0, y: 0.2, width: 1, height: 0.6 },
    anchor: { x: 0.8, y: 0.5 },
  });
  assert.ok(isValidRect(rect));
  const centre = rect.x + rect.width / 2;
  assert.ok(
    centre > 0.5,
    `crop should lean towards the anchor at 0.8, centred at ${centre}`,
  );
});

test("the split crop aspect is three panels wide and still valid", () => {
  const target = aspectFor("A3") * 3;
  const rect = cropRectFor({ source: LANDSCAPE, targetAspect: target });
  assert.ok(isValidRect(rect));
  assert.ok(Math.abs(actualAspect(rect, LANDSCAPE) - target) < 1e-9);
});

test("toPixelRect never exceeds the source bounds", () => {
  for (const source of [SQUARE, PORTRAIT, LANDSCAPE, { width: 999, height: 667 }]) {
    for (const target of [0.5, 0.7071, 1, 1.4142, 2.12]) {
      const rect = cropRectFor({ source, targetAspect: target });
      const px = toPixelRect(rect, source);
      assert.ok(px.left >= 0 && px.top >= 0, "negative origin");
      assert.ok(px.width >= 1 && px.height >= 1, "degenerate size");
      assert.ok(
        px.left + px.width <= source.width,
        `right edge ${px.left + px.width} > ${source.width}`,
      );
      assert.ok(
        px.top + px.height <= source.height,
        `bottom edge ${px.top + px.height} > ${source.height}`,
      );
    }
  }
});

test("toPixelRect survives a degenerate rect without throwing", () => {
  // A mis-parsed focal box should produce a poor crop, not stop a batch.
  const px = toPixelRect({ x: 0, y: 0, width: 0, height: 0 }, SQUARE);
  assert.equal(px.width, 1);
  assert.equal(px.height, 1);
});

test("coverage warns when a source is the wrong shape for a split", () => {
  // A 3-panel A-series set is ~2.12:1. A portrait source cannot fill that, so
  // most of the artwork is discarded — correct geometry, but the user needs to
  // know before publishing rather than after.
  const portrait = { width: 3600, height: 5000 };
  const normal = coverageFor(portrait, "normal");
  const split = coverageFor(portrait, "split3");

  assert.ok(normal > 0.9, `normal should keep most of a portrait, got ${normal}`);
  assert.ok(split < COVERAGE_WARN, `split should warn, got ${split}`);

  // A wide source is the right shape for a split and should not warn.
  const wide = coverageFor({ width: 6000, height: 2800 }, "split3");
  assert.ok(wide > COVERAGE_WARN, `wide source should not warn, got ${wide}`);
});

test("coverage is never above 1 or below 0", () => {
  for (const source of [SQUARE, PORTRAIT, LANDSCAPE, { width: 8000, height: 900 }]) {
    for (const kind of ["normal", "split3"] as const) {
      const value = coverageFor(source, kind);
      assert.ok(value > 0 && value <= 1, `${value} out of range`);
    }
  }
});

test("isValidRect rejects what sharp would choke on", () => {
  assert.equal(isValidRect({ x: 0, y: 0, width: 1, height: 1 }), true);
  assert.equal(isValidRect({ x: -0.1, y: 0, width: 1, height: 1 }), false);
  assert.equal(isValidRect({ x: 0.5, y: 0, width: 0.6, height: 1 }), false);
  assert.equal(isValidRect({ x: 0, y: 0, width: 0, height: 1 }), false);
  assert.equal(isValidRect({ x: 0, y: 0, width: NaN, height: 1 }), false);
});
