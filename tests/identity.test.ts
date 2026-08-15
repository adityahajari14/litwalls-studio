import assert from "node:assert/strict";
import { test } from "node:test";

import {
  seoDescriptionFor,
  seoTitleFor,
  skuFor,
} from "../src/lib/print/identity.ts";
import { distance, isProbableDuplicate } from "../src/lib/image/fingerprint.ts";
import { ensureCategoryTag } from "../src/lib/print/title.ts";
import { MANUAL, MARVEL, MOVIES } from "./fixtures/categories.ts";

test("SKU identifies exactly what to print", () => {
  const sku = skuFor({
    category: MARVEL,
    subject: "Spider Man",
    sequence: 6,
    sizeId: "A3",
  });
  assert.equal(sku, "LW-MARVEL-SPIDERMAN06-A3");
});

test("SKU marks a split set apart from a single sheet", () => {
  // Three A3 sheets is a different physical product from one A3, and the
  // picking list has to say so.
  const single = skuFor({
    category: MARVEL,
    subject: "Loki",
    sequence: 2,
    sizeId: "A3",
  });
  const split = skuFor({
    category: MARVEL,
    subject: "Loki",
    sequence: 2,
    sizeId: "A3",
    split: true,
  });
  assert.notEqual(single, split);
  assert.match(split, /SET3$/);
});

test("SKUs are unique per size", () => {
  const skus = (["A5", "A4", "A3", "13x19"] as const).map((sizeId) =>
    skuFor({ category: MARVEL, subject: "Batman", sequence: 1, sizeId }),
  );
  assert.equal(new Set(skus).size, 4);
});

test("SKU strips punctuation that breaks spreadsheets", () => {
  const sku = skuFor({
    category: MOVIES,
    subject: "KR$NA & Co.",
    sequence: 3,
    sizeId: "A4",
  });
  assert.match(sku, /^[A-Z0-9-]+$/, `not spreadsheet-safe: ${sku}`);
});

test("SEO title drops the sequence number", () => {
  // Shopify would otherwise default to the product title, where "#06" is
  // meaningless to a shopper reading a search result.
  const title = seoTitleFor({ subject: "Spider Man", category: MARVEL });
  assert.ok(!title.includes("#"), title);
  assert.ok(title.includes("Spider Man"));
  assert.ok(title.includes("Litwalls"));
});

test("SEO title stays within Google's truncation point", () => {
  for (const subject of [
    "Spider Man",
    "APT. - Bruno Mars and Rosé",
    "Billie Eilish Hit Me Hard And Soft Album Edition",
  ]) {
    const title = seoTitleFor({ subject, category: MOVIES });
    assert.ok(title.length <= 60, `${title.length} chars: ${title}`);
  }
});

test("SEO description lists every size, not just 13x19", () => {
  // The live template hardcodes 13" x 19" as the only size, which stopped
  // being true the moment four sizes shipped.
  const description = seoDescriptionFor("Spider Man");
  for (const size of ["A5", "A4", "A3"]) {
    assert.ok(description.includes(size), `missing ${size}: ${description}`);
  }
  assert.ok(description.includes("Spider Man"));
});

test("a manual collection adds no tag", () => {
  // Nothing to add — membership needs an explicit collection add instead.
  assert.deepEqual(ensureCategoryTag(["Loki"], MANUAL), ["Loki"]);
});

test("fingerprint distance is zero for identical hashes", () => {
  assert.equal(distance("abcdef0123456789", "abcdef0123456789"), 0);
  assert.ok(isProbableDuplicate("abcdef0123456789", "abcdef0123456789"));
});

test("fingerprint distance counts differing bits", () => {
  // 0x0 vs 0xf is four bits.
  assert.equal(distance("0000000000000000", "000000000000000f"), 4);
});

test("wholly different fingerprints are not flagged", () => {
  assert.ok(!isProbableDuplicate("0000000000000000", "ffffffffffffffff"));
});

test("mismatched fingerprint lengths never compare equal", () => {
  // A truncated or legacy hash must not accidentally read as a match.
  assert.equal(distance("abc", "abcdef0123456789"), Number.POSITIVE_INFINITY);
  assert.ok(!isProbableDuplicate("abc", "abcdef0123456789"));
});
