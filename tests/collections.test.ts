import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HIDDEN_COLLECTION_HANDLES,
  withoutHiddenCollections,
} from "../src/lib/shopify/collections.ts";
import type { Category } from "../src/lib/print/types.ts";

function category(id: string): Category {
  return {
    id,
    label: id,
    suffix: `${id} Posters`,
    tag: id,
    collectionId: `gid://shopify/Collection/${id}`,
    smart: true,
  };
}

test("drops the custom-prints collection, keeps the rest", () => {
  const kept = withoutHiddenCollections([
    category("marvel"),
    category("custom-prints"),
    category("music"),
  ]);
  assert.deepEqual(
    kept.map((c) => c.id),
    ["marvel", "music"],
  );
});

test("custom-prints is the handle that is hidden", () => {
  assert.equal(HIDDEN_COLLECTION_HANDLES.has("custom-prints"), true);
});

test("a list with nothing hidden is returned unchanged", () => {
  const list = [category("marvel"), category("music")];
  assert.deepEqual(withoutHiddenCollections(list), list);
});
