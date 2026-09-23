import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTemplate } from "../src/lib/templates/schema.ts";

const FLAT = {
  id: "living-room-flat",
  name: "Living room",
  kind: "flat",
  background: "background.jpg",
  canvas: { width: 2000, height: 1500 },
  rect: { x: 620, y: 210, width: 700, height: 990 },
  shadow: 0.22,
};

const PERSPECTIVE = {
  id: "hallway-angled",
  name: "Hallway",
  kind: "perspective",
  background: "background.jpg",
  canvas: { width: 2400, height: 1600 },
  corners: [
    { x: 1640, y: 430 },
    { x: 2180, y: 560 },
    { x: 2180, y: 1180 },
    { x: 1640, y: 1210 },
  ],
};

test("accepts the shipped sample templates", () => {
  assert.equal(validateTemplate(FLAT).ok, true);
  assert.equal(validateTemplate(PERSPECTIVE).ok, true);
});

function errorsOf(input: unknown): string[] {
  const result = validateTemplate(input);
  assert.equal(result.ok, false, "expected validation to fail");
  return result.ok ? [] : result.errors;
}

test("rejects a rect that hangs off the canvas", () => {
  const errors = errorsOf({
    ...FLAT,
    rect: { x: 1800, y: 210, width: 700, height: 990 },
  });
  assert.match(errors.join(" "), /outside the canvas/);
});

test("rejects corners in the wrong order with an actionable message", () => {
  // The most common authoring mistake. It has area and it solves — it just
  // renders as a poster folded through itself, so the message has to say why.
  const errors = errorsOf({
    ...PERSPECTIVE,
    corners: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ],
  });
  assert.match(errors.join(" "), /TL, TR, BR, BL order/);
});

test("rejects the wrong number of corners", () => {
  const errors = errorsOf({ ...PERSPECTIVE, corners: PERSPECTIVE.corners.slice(0, 3) });
  assert.match(errors.join(" "), /exactly four points/);
});

test("rejects an unknown kind", () => {
  assert.match(errorsOf({ ...FLAT, kind: "isometric" }).join(" "), /"flat" or "perspective"/);
});

test("rejects a bad id, since it must match the folder name", () => {
  assert.match(errorsOf({ ...FLAT, id: "Living Room!" }).join(" "), /lowercase/);
});

test("rejects a missing canvas", () => {
  const { canvas, ...withoutCanvas } = FLAT;
  void canvas;
  assert.match(errorsOf(withoutCanvas).join(" "), /canvas/);
});

test("rejects an out-of-range shadow", () => {
  assert.match(errorsOf({ ...FLAT, shadow: 4 }).join(" "), /between 0 and 1/);
});

test("optional fields may be omitted", () => {
  const { shadow, ...withoutShadow } = FLAT;
  void shadow;
  assert.equal(validateTemplate(withoutShadow).ok, true);
});

test("reports every problem at once, not just the first", () => {
  // A half-authored template should list everything to fix in one pass.
  const errors = errorsOf({ kind: "flat" });
  assert.ok(errors.length >= 3, `expected several errors, got ${errors.length}`);
});

test("rejects non-objects without throwing", () => {
  for (const input of [null, undefined, 42, "template", []]) {
    assert.equal(validateTemplate(input).ok, false, String(input));
  }
});

test("accepts a split-3 placement box", () => {
  const result = validateTemplate({
    ...FLAT,
    splitSizing: { base: { x: 100, y: 300, width: 1800, height: 800 } },
  });
  assert.equal(result.ok, true);
});

test("rejects a split placement with a malformed base area", () => {
  const errors = errorsOf({
    ...FLAT,
    splitSizing: { base: { x: 100, y: 300, width: -5, height: 800 } },
  });
  assert.match(errors.join(" "), /splitSizing\.base/);
});

test("rejects a split override for an unknown size", () => {
  const errors = errorsOf({
    ...FLAT,
    splitSizing: {
      base: { x: 100, y: 300, width: 1800, height: 800 },
      overrides: { A2: { x: 0, y: 0, width: 100, height: 100 } },
    },
  });
  assert.match(errors.join(" "), /unknown size "A2"/);
});

test("accepts a split-3 vertical placement box", () => {
  const result = validateTemplate({
    ...FLAT,
    splitVerticalSizing: { base: { x: 300, y: 50, width: 700, height: 1900 } },
  });
  assert.equal(result.ok, true);
});

test("rejects a split vertical placement with a malformed base area", () => {
  const errors = errorsOf({
    ...FLAT,
    splitVerticalSizing: { base: { x: 300, y: 50, width: -5, height: 1900 } },
  });
  assert.match(errors.join(" "), /splitVerticalSizing\.base/);
});

test("rejects a split vertical override for an unknown size", () => {
  const errors = errorsOf({
    ...FLAT,
    splitVerticalSizing: {
      base: { x: 300, y: 50, width: 700, height: 1900 },
      overrides: { A2: { x: 0, y: 0, width: 100, height: 100 } },
    },
  });
  assert.match(errors.join(" "), /unknown size "A2"/);
});

test("accepts a landscape placement box", () => {
  const result = validateTemplate({
    ...FLAT,
    landscapeSizing: { base: { x: 100, y: 300, width: 990, height: 700 } },
  });
  assert.equal(result.ok, true);
});

test("rejects a landscape placement with a malformed base area", () => {
  const errors = errorsOf({
    ...FLAT,
    landscapeSizing: { base: { x: 100, y: 300, width: -5, height: 700 } },
  });
  assert.match(errors.join(" "), /landscapeSizing\.base/);
});

test("rejects a landscape override for an unknown size", () => {
  const errors = errorsOf({
    ...FLAT,
    landscapeSizing: {
      base: { x: 100, y: 300, width: 990, height: 700 },
      overrides: { A2: { x: 0, y: 0, width: 100, height: 100 } },
    },
  });
  assert.match(errors.join(" "), /unknown size "A2"/);
});

test("accepts a suits declaration with known literals", () => {
  const result = validateTemplate({
    ...FLAT,
    suits: { formats: ["split3"], orientations: ["portrait", "landscape"] },
  });
  assert.equal(result.ok, true);
});

test("suits may be omitted, or hold empty arrays", () => {
  assert.equal(validateTemplate({ ...FLAT, suits: {} }).ok, true);
  assert.equal(
    validateTemplate({ ...FLAT, suits: { formats: [] } }).ok,
    true,
  );
});

test("rejects an unknown suits.formats value", () => {
  const errors = errorsOf({ ...FLAT, suits: { formats: ["triptych"] } });
  assert.match(errors.join(" "), /suits\.formats/);
});

test("rejects an unknown suits.orientations value", () => {
  const errors = errorsOf({ ...FLAT, suits: { orientations: ["sideways"] } });
  assert.match(errors.join(" "), /suits\.orientations/);
});

test("rejects a non-array suits facet", () => {
  const errors = errorsOf({ ...FLAT, suits: { formats: "split3" } });
  assert.match(errors.join(" "), /suits\.formats.*must be an array/);
});
