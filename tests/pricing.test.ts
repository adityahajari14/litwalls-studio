import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FALLBACK_PRICES,
  FALLBACK_SPLIT_PRICES,
  normalizePrice,
  normalizePriceTable,
  priceOrigin,
  resolvePrice,
  resolvePriceTable,
  validCompareAt,
} from "../src/lib/print/pricing.ts";
import { SPLIT_SIZE_IDS } from "../src/lib/print/sizes.ts";
import { ensureCategoryTag } from "../src/lib/print/title.ts";
import { MANUAL, MARVEL, MOVIES } from "./fixtures/categories.ts";

test("job price wins over batch, batch over settings", () => {
  const levels = {
    job: { A4: "111.00" },
    batch: { A4: "222.00", A3: "333.00" },
    settings: { A4: "444.00", A3: "555.00", A5: "666.00" },
  };
  assert.equal(resolvePrice("A4", levels), "111.00", "job should win");
  assert.equal(resolvePrice("A3", levels), "333.00", "batch should win");
  assert.equal(resolvePrice("A5", levels), "666.00", "settings should win");
  assert.equal(
    resolvePrice("13x19", levels),
    FALLBACK_PRICES["13x19"],
    "unset at every level should reach the fallback",
  );
});

test("a size absent from a level falls through rather than blocking", () => {
  // The point of partial tables: overriding A3 for a batch must not wipe out
  // the settings-level prices for every other size.
  const table = resolvePriceTable({
    batch: { A3: "899.00" },
    settings: { A5: "199.00", A4: "399.00" },
  });
  assert.equal(table.A3, "899.00");
  assert.equal(table.A5, "199.00");
  assert.equal(table.A4, "399.00");
  assert.equal(table["13x19"], FALLBACK_PRICES["13x19"]);
});

test("a split-3 size resolves against the split fallback, not the normal one", () => {
  assert.equal(
    resolvePrice("A4", {}, FALLBACK_SPLIT_PRICES),
    FALLBACK_SPLIT_PRICES.A4,
  );
  assert.notEqual(FALLBACK_SPLIT_PRICES.A4, FALLBACK_PRICES.A4);
});

test("resolving a size the given fallback does not cover throws rather than lying", () => {
  // A closed SizeId union means this can only happen from a caller mismatch —
  // e.g. resolving "A5" against FALLBACK_SPLIT_PRICES, which does not have it
  // on purpose. Silently returning something would sell split-3 A5 posters.
  assert.throws(() => resolvePrice("A5", {}, FALLBACK_SPLIT_PRICES));
});

test("resolvePriceTable restricted to the split sizes never touches A5", () => {
  const table = resolvePriceTable({}, SPLIT_SIZE_IDS, FALLBACK_SPLIT_PRICES);
  assert.deepEqual(Object.keys(table).sort(), ["13x19", "A3", "A4"]);
});

test("priceOrigin reports which level supplied the value", () => {
  const levels = {
    job: { A5: "1.00" },
    batch: { A4: "2.00" },
    settings: { A3: "3.00" },
  };
  assert.equal(priceOrigin("A5", levels), "job");
  assert.equal(priceOrigin("A4", levels), "batch");
  assert.equal(priceOrigin("A3", levels), "settings");
  assert.equal(priceOrigin("13x19", levels), "fallback");
});

test("resolvePriceTable fills every size", () => {
  const table = resolvePriceTable({});
  assert.deepEqual(Object.keys(table).sort(), ["13x19", "A3", "A4", "A5"]);
});

test("normalizePrice accepts what people actually type", () => {
  assert.equal(normalizePrice("499"), "499.00");
  assert.equal(normalizePrice("499.5"), "499.50");
  assert.equal(normalizePrice("499.00"), "499.00");
  assert.equal(normalizePrice("₹499"), "499.00");
  assert.equal(normalizePrice("1,499"), "1499.00");
  assert.equal(normalizePrice("  799  "), "799.00");
  assert.equal(normalizePrice("0"), "0.00");
});

test("normalizePrice rejects what would reach Shopify as garbage", () => {
  assert.equal(normalizePrice(""), null);
  assert.equal(normalizePrice("   "), null);
  assert.equal(normalizePrice("free"), null);
  assert.equal(normalizePrice("-10"), null);
  assert.equal(normalizePrice("1.234"), null, "three decimals");
  assert.equal(normalizePrice("99999999"), null, "typo-sized");
  assert.equal(normalizePrice("1e5"), null, "exponent notation");
});

test("a blank field clears the override instead of storing an empty string", () => {
  // A cleared field must FALL THROUGH to the next level. Storing "" would read
  // as present further down the chain and silently publish an empty price.
  const table = normalizePriceTable({ A4: "", A3: "  ", A5: "299" });
  assert.equal("A4" in table, false);
  assert.equal("A3" in table, false);
  assert.equal(table.A5, "299.00");
});

test("normalizePriceTable drops unparseable values", () => {
  const table = normalizePriceTable({ A4: "banana", A5: "199" });
  assert.equal("A4" in table, false);
  assert.equal(table.A5, "199.00");
});

test("compareAt only shows when it is genuinely higher", () => {
  assert.equal(validCompareAt("799.00", "499.00"), "799.00");
  // Equal or lower would render as a price RISE — worse than showing nothing.
  assert.equal(validCompareAt("499.00", "499.00"), undefined);
  assert.equal(validCompareAt("299.00", "499.00"), undefined);
  assert.equal(validCompareAt(undefined, "499.00"), undefined);
});

test("category tag is added when missing", () => {
  // Collections are smart and keyed on tags, so a missing tag means the
  // product publishes live but appears in no collection.
  assert.deepEqual(ensureCategoryTag(["Spider Man"], MARVEL), [
    "Marvel",
    "Spider Man",
  ]);
});

test("category tag is not duplicated, even across case", () => {
  assert.deepEqual(ensureCategoryTag(["Marvel", "Loki"], MARVEL), [
    "Marvel",
    "Loki",
  ]);
  // The live tag cloud already has near-duplicates; adding "Marvel" beside an
  // existing "marvel" would make that worse for no benefit.
  assert.deepEqual(ensureCategoryTag(["marvel"], MARVEL), ["marvel"]);
});

test("movies-tv uses the tag the smart collection actually matches", () => {
  // Verified against the live store: Movies & TV matches Movies OR Series OR
  // Netflix. "Movies" is the one the existing catalogue uses.
  assert.equal(MOVIES.tag, "Movies");
  assert.deepEqual(ensureCategoryTag([], MOVIES), ["Movies"]);
});
