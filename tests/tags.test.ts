import assert from "node:assert/strict";
import { test } from "node:test";

import {
  categoriesFor,
  isAutoBatch,
  mainCategoryFor,
  resolveCategories,
} from "../src/lib/print/categories.ts";
import {
  missingTags,
  ORIENTATION_TAGS,
  requiredTagsFor,
  SPLIT_TAG,
  withRequiredTags,
} from "../src/lib/print/tags.ts";
import {
  orientationOf,
  printOrientation,
  productOrientation,
} from "../src/lib/print/orientation.ts";
import type { Batch, Category, PosterJob } from "../src/lib/print/types.ts";

function category(id: string, tag: string | null, smart = true): Category {
  return {
    id,
    label: id,
    suffix: `${id} Posters`,
    tag,
    collectionId: `gid://shopify/Collection/${id}`,
    smart,
  };
}

const MARVEL = category("marvel", "Marvel");
const MOVIES = category("movies-tv", "Movies");
const MANUAL = category("staff-picks", null, false);

/** Only the fields the functions under test read. */
function job(over: Partial<PosterJob> = {}): PosterJob {
  return { kind: "normal", probe: null, categories: null, ...over } as PosterJob;
}
function batch(category: Category | null): Batch {
  return { category } as Batch;
}

test("required tags cover every collection, not just the main one", () => {
  // The failure this guards against is silent: a smart collection is keyed on
  // a tag, so a product filed into three collections but tagged for one is
  // live and invisible in the other two.
  const tags = requiredTagsFor({
    categories: [MARVEL, MOVIES],
    orientation: "portrait",
    kind: "normal",
  });

  assert.ok(tags.includes("Marvel"));
  assert.ok(tags.includes("Movies"));
  assert.equal(tags[0], "Marvel", "the main collection's tag should lead");
});

test("a manual collection contributes no tag", () => {
  // There is no rule to satisfy — membership is an explicit add, which the
  // publisher does with collectionAddProducts instead.
  const tags = requiredTagsFor({
    categories: [MANUAL],
    orientation: "portrait",
    kind: "normal",
  });
  assert.deepEqual(tags, [ORIENTATION_TAGS.portrait]);
});

test("orientation and format are always tagged", () => {
  const portrait = requiredTagsFor({
    categories: [MARVEL],
    orientation: "portrait",
    kind: "normal",
  });
  assert.ok(portrait.includes("Portrait"));
  assert.ok(!portrait.includes(SPLIT_TAG));

  const split = requiredTagsFor({
    categories: [MARVEL],
    orientation: "landscape",
    kind: "split3",
  });
  assert.ok(split.includes("Landscape"));
  assert.ok(split.includes(SPLIT_TAG));
});

test("an existing spelling is never corrected", () => {
  // The live tag cloud already carries Weeknd/weekend/Weekend. Rewriting
  // someone's "marvel" to "Marvel" is a silent edit of a deliberate choice,
  // and both put the product in the same collection anyway.
  assert.deepEqual(withRequiredTags(["marvel"], ["Marvel"]), ["marvel"]);
  assert.deepEqual(withRequiredTags(["Loki"], ["Marvel"]), ["Marvel", "Loki"]);
});

test("missingTags is exactly what withRequiredTags would add", () => {
  const have = ["Loki", "portrait"];
  const need = ["Marvel", "Portrait", "Movies"];
  assert.deepEqual(
    withRequiredTags(have, need),
    [...missingTags(have, need), ...have],
  );
  // "portrait" is already there in another casing, so it is not added again.
  assert.deepEqual(missingTags(have, need), ["Marvel", "Movies"]);
});

test("a poster's own collections win over the batch's", () => {
  assert.deepEqual(categoriesFor(job(), batch(MARVEL)), [MARVEL]);
  assert.deepEqual(
    categoriesFor(job({ categories: [MOVIES, MARVEL] }), batch(MARVEL)),
    [MOVIES, MARVEL],
  );
  assert.equal(
    mainCategoryFor(job({ categories: [MOVIES, MARVEL] }), batch(MARVEL)),
    MOVIES,
  );
});

test("an auto batch with nothing filed resolves to nothing", () => {
  // A real state the publisher has to refuse, not one to paper over: a
  // product with no collection is live, findable by nobody, and would be
  // titled after a collection it is not in.
  assert.equal(isAutoBatch(batch(null)), true);
  assert.deepEqual(categoriesFor(job(), batch(null)), []);
  assert.equal(mainCategoryFor(job(), batch(null)), null);
});

test("resolving handles keeps the order given and drops inventions", () => {
  // Order IS the meaning: the first handle is the main collection, so a
  // resolver that sorted would quietly rename every product in the batch.
  assert.deepEqual(
    resolveCategories(["movies-tv", "nope", "marvel", "marvel"], [MARVEL, MOVIES]),
    [MOVIES, MARVEL],
  );
});

test("a square source is portrait everywhere", () => {
  // The two inline comparisons this replaced disagreed: the cropper used >=
  // and the mockup renderer used >, so a square poster was cut as landscape
  // and then shown portrait on the wall.
  assert.equal(orientationOf({ width: 1000, height: 1000 }), "portrait");
  assert.equal(orientationOf({ width: 1001, height: 1000 }), "landscape");
});

test("a split set prints portrait but hangs landscape", () => {
  const wide = job({
    kind: "split3",
    probe: { width: 4000, height: 2000 } as PosterJob["probe"],
  });
  // Each panel is a full portrait sheet, whichever way round the source is.
  assert.equal(printOrientation(wide), "portrait");
  // Three of them side by side is 2.12:1 — tagging that "Portrait" would
  // tell a shopper filtering for wide artwork exactly the wrong thing.
  assert.equal(productOrientation(wide), "landscape");
});
