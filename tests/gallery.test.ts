import assert from "node:assert/strict";
import { test } from "node:test";

import { effectiveGallery, inSequence } from "../src/lib/print/gallery.ts";
import type { RenderedMockup } from "../src/lib/print/types.ts";

/**
 * The order of a product's images is a merchandising decision — the first is
 * its thumbnail everywhere on Shopify — so a sequence chosen once, when the
 * batch is set up, has to survive every step between there and the publish.
 */

const LIBRARY = [{ id: "bedroom" }, { id: "desk" }, { id: "hallway" }, { id: "sofa" }];

const mockup = (templateId: string): RenderedMockup => ({
  templateId,
  relPath: `mockups/${templateId}.jpg`,
  width: 2016,
  height: 2112,
  sizeId: null,
});

test("templates come back in the order chosen, not the library's", () => {
  assert.deepEqual(
    inSequence(LIBRARY, ["sofa", "bedroom", "hallway"]).map((t) => t.id),
    ["sofa", "bedroom", "hallway"],
  );
});

test("a template deleted since the batch was set up is skipped", () => {
  assert.deepEqual(
    inSequence(LIBRARY, ["sofa", "gone", "desk"]).map((t) => t.id),
    ["sofa", "desk"],
  );
});

test("a repeated id is rendered once, where it first appears", () => {
  assert.deepEqual(
    inSequence(LIBRARY, ["desk", "sofa", "desk"]).map((t) => t.id),
    ["desk", "sofa"],
  );
});

test("an uncurated gallery leads with the mockups in rendered order", () => {
  const gallery = effectiveGallery({
    mockups: [mockup("sofa"), mockup("bedroom")],
    images: [{ kind: "library", libraryId: "size-guide" }],
  });

  assert.deepEqual(gallery, [
    { kind: "mockup", templateId: "sofa" },
    { kind: "mockup", templateId: "bedroom" },
    { kind: "library", libraryId: "size-guide" },
  ]);
});

test("a gallery someone arranged on the review screen is left as arranged", () => {
  const images = [
    { kind: "library" as const, libraryId: "size-guide" },
    { kind: "mockup" as const, templateId: "bedroom" },
  ];

  assert.deepEqual(
    effectiveGallery({ mockups: [mockup("sofa"), mockup("bedroom")], images }),
    images,
  );
});
