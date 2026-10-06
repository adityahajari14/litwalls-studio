import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Numberer } from "../src/lib/shopify/numbering.ts";

const LIVE_TITLES: string[] = JSON.parse(
  readFileSync(new URL("./fixtures/live-titles.json", import.meta.url), "utf8"),
);

test("claims the next free number against the live catalogue", () => {
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  // Hand-checked: Spider Man tops out at #05, The Weeknd at #07.
  assert.equal(numberer.claim("Spider Man"), 6);
  assert.equal(numberer.claim("The Weeknd"), 8);
});

test("claiming twice yields consecutive numbers, not the same one twice", () => {
  // THE reason a Numberer exists rather than a bare function: ten Spider-Man
  // posters in one batch must not all be told "the next number is 06",
  // because none of them exist in Shopify yet.
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  assert.deepEqual(
    [
      numberer.claim("Spider Man"),
      numberer.claim("Spider Man"),
      numberer.claim("Spider Man"),
    ],
    [6, 7, 8],
  );
});

test("reserve takes a specific number only if it is free", () => {
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  // Spider Man tops out at #05, so #06 is free and #05 is not.
  assert.equal(numberer.reserve("Spider Man", 5), false);
  assert.equal(numberer.reserve("Spider Man", 6), true);
  assert.equal(numberer.reserve("Spider Man", 6), false);
  // The next claim steps past what was reserved.
  assert.equal(numberer.claim("Spider Man"), 7);
});

test("peek does not consume a number", () => {
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  assert.equal(numberer.peek("Spider Man"), 6);
  assert.equal(numberer.peek("Spider Man"), 6);
  assert.equal(numberer.claim("Spider Man"), 6);
});

test("a brand new subject starts at 1", () => {
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  assert.equal(numberer.claim("Some Brand New Artist"), 1);
  assert.equal(numberer.claim("Some Brand New Artist"), 2);
});

test("case differences do not fork a subject's sequence", () => {
  // "AP Dhillon" and "Ap Dhillon" both exist in the live catalogue.
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  assert.equal(numberer.claim("AP DHILLON"), 3);
  assert.equal(numberer.claim("ap dhillon"), 4);
});

test("never proposes a number already in the catalogue", () => {
  const numberer = Numberer.fromTitles(LIVE_TITLES);
  const taken = new Map<string, Set<number>>();
  for (const title of LIVE_TITLES) {
    const match = title.match(/^(.*?)\s*#(\d+)/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (!taken.has(key)) taken.set(key, new Set());
    taken.get(key)!.add(Number(match[2]));
  }

  for (const [key, numbers] of taken) {
    const proposed = numberer.claim(key);
    assert.ok(
      !numbers.has(proposed),
      `${key}: proposed #${proposed} which is already taken`,
    );
  }
});
