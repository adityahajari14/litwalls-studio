import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  formatTitle,
  isUsableSubject,
  nextSequence,
  normalizeSpacing,
  parseTitle,
  sequencesBySubject,
  stripOfficial,
  subjectFromFilename,
  subjectKey,
} from "../src/lib/print/title.ts";
import { MARVEL, MUSIC } from "./fixtures/categories.ts";

/**
 * Tested against a snapshot of the REAL catalogue rather than invented
 * examples, because the interesting cases are all things the store actually
 * did: duplicate numbers, gaps, a missing suffix, a capitalisation split.
 * Invented fixtures would have been tidy and would have proved nothing.
 *
 * Refresh with `node scripts/refresh-titles.mjs` if the catalogue moves on.
 */
const LIVE_TITLES: string[] = JSON.parse(
  readFileSync(new URL("./fixtures/live-titles.json", import.meta.url), "utf8"),
);

test("fixture is the real catalogue", () => {
  assert.equal(LIVE_TITLES.length, 154);
});

test("parses the standard pattern", () => {
  assert.deepEqual(parseTitle("Spider Man #01 | Marvel Posters"), {
    subject: "Spider Man",
    sequence: 1,
    subtitle: null,
  });
});

test("parses the subtitle variant", () => {
  assert.deepEqual(parseTitle("The Weeknd #06 - Star Boy | Music Posters"), {
    subject: "The Weeknd",
    sequence: 6,
    subtitle: "Star Boy",
  });
  assert.deepEqual(
    parseTitle("Billie Eilish #04 - Hit me hard and soft Album | Music Posters"),
    {
      subject: "Billie Eilish",
      sequence: 4,
      subtitle: "Hit me hard and soft Album",
    },
  );
});

test("parses a title with no suffix", () => {
  // The catalogue contains exactly one of these. The number is what matters.
  assert.deepEqual(parseTitle("Superman #03"), {
    subject: "Superman",
    sequence: 3,
    subtitle: null,
  });
});

test("returns null for un-numbered titles instead of throwing", () => {
  for (const title of [
    "Batman - Wanted | DC Posters",
    "Captain America Worthy | Marvel Posters",
    "Eminem - Superman | Music Posters",
    "Batman vs Superman Dawn of Justice | DC Posters",
    "Custom Poster",
  ]) {
    assert.equal(parseTitle(title), null, title);
  }
});

test("every live title either parses or returns null, never throws", () => {
  let numbered = 0;
  let unnumbered = 0;
  for (const title of LIVE_TITLES) {
    const parts = parseTitle(title);
    if (parts) {
      numbered++;
      assert.ok(parts.subject.length > 0, `empty subject from: ${title}`);
      assert.ok(parts.sequence > 0, `bad sequence from: ${title}`);
    } else {
      unnumbered++;
    }
  }
  // Guards against a regex change that silently stops matching: if numbered
  // collapses, this fails loudly rather than quietly renumbering from 1.
  assert.ok(numbered > 125, `expected >125 numbered titles, got ${numbered}`);
  assert.equal(numbered + unnumbered, LIVE_TITLES.length);
});

test("formatTitle round-trips a parsed title", () => {
  const original = "Travis Scott #07 | Music Posters";
  const parts = parseTitle(original);
  assert.ok(parts);
  assert.equal(formatTitle(parts, MUSIC), original);
});

test("formatTitle round-trips a subtitled title", () => {
  const original = "Zayn #02 - Nobody is Listening | Music Posters";
  const parts = parseTitle(original);
  assert.ok(parts);
  assert.equal(formatTitle(parts, MUSIC), original);
});

test("formatTitle zero-pads below 10 and widens past 99", () => {
  assert.equal(
    formatTitle({ subject: "Loki", sequence: 3 }, MARVEL),
    "Loki #03 | Marvel Posters",
  );
  assert.equal(
    formatTitle({ subject: "Loki", sequence: 100 }, MARVEL),
    "Loki #100 | Marvel Posters",
  );
});

test("subjectKey unifies the AP/Ap Dhillon split", () => {
  // Both spellings exist in the live catalogue as separate sequences.
  assert.equal(subjectKey("AP Dhillon"), subjectKey("Ap Dhillon"));
  assert.equal(subjectKey("  The   Weeknd "), "the weeknd");
});

test("nextSequence is max+1, not count+1 and not gap-filling", () => {
  // The Weeknd's real numbers: 01, 02, 04, 05, 07 (03 and 06 carry subtitles).
  assert.equal(nextSequence([1, 2, 4, 5, 7]), 8);
  // count+1 would say 6 (taken); lowest-gap would say 3 (deliberately skipped).
  assert.notEqual(nextSequence([1, 2, 4, 5, 7]), 6);
  assert.notEqual(nextSequence([1, 2, 4, 5, 7]), 3);
  assert.equal(nextSequence([]), 1);
});

test("nextSequence survives the duplicate in the live data", () => {
  // "Spider Man into the spiderverse #04" appears TWICE in the catalogue.
  assert.equal(nextSequence([1, 2, 3, 4, 4]), 5);
});

test("live catalogue: next numbers match hand-checked values", () => {
  const bySubject = sequencesBySubject(LIVE_TITLES);

  const spiderMan = bySubject.get(subjectKey("Spider Man"));
  assert.ok(spiderMan, "Spider Man missing from grouping");
  assert.equal(nextSequence(spiderMan), 6, "Spider Man tops out at #05");

  const weeknd = bySubject.get(subjectKey("The Weeknd"));
  assert.ok(weeknd);
  assert.equal(nextSequence(weeknd), 8, "The Weeknd tops out at #07");

  const travis = bySubject.get(subjectKey("Travis Scott"));
  assert.ok(travis);
  assert.equal(nextSequence(travis), 8, "Travis Scott tops out at #07");
});

test("live catalogue: AP Dhillon groups as one subject, not two", () => {
  const bySubject = sequencesBySubject(LIVE_TITLES);
  const dhillon = bySubject.get(subjectKey("AP Dhillon"));
  assert.ok(dhillon, "AP Dhillon missing");
  // "AP Dhillon #01" and "Ap Dhillon #02" must land in the same bucket, so the
  // next free number is 03 rather than a second 02.
  assert.deepEqual([...dhillon].sort(), [1, 2]);
  assert.equal(nextSequence(dhillon), 3);
});

test("no subject would be handed an already-taken number", () => {
  const bySubject = sequencesBySubject(LIVE_TITLES);
  for (const [key, used] of bySubject) {
    const next = nextSequence(used);
    assert.ok(!used.includes(next), `${key}: proposed #${next} is already used`);
  }
});

test("subjectFromFilename produces a usable fallback", () => {
  assert.equal(subjectFromFilename("spider-man_02.jpg"), "Spider Man 02");
  assert.equal(subjectFromFilename("the weeknd.png"), "The Weeknd");
});

test("subjectFromFilename strips stray symbols a weird filename might carry", () => {
  assert.equal(
    subjectFromFilename("poster ★ final (1).jpg"),
    "Poster Final 1",
  );
});

test("isUsableSubject accepts real proper nouns, including model numbers", () => {
  for (const subject of [
    "Spider Man",
    "The Weeknd",
    "Ferrari F1",
    "AC/DC",
    "Guns N' Roses",
    "Simon & Garfunkel",
    "GT3 RS",
    "U2",
  ]) {
    assert.ok(isUsableSubject(subject), subject);
  }
});

test("isUsableSubject rejects the exact failure this guards against", () => {
  // A hallucinated symbol where a model number belonged — this shipped as a
  // live product title before this check existed.
  assert.equal(isUsableSubject("Ferrari F!"), false);
});

test("isUsableSubject rejects garbage and near-empty subjects", () => {
  for (const subject of ["", "!", "1", "12", "---", "!!!", "@"]) {
    assert.equal(isUsableSubject(subject), false, subject);
  }
});

test("normalizeSpacing trims and collapses whitespace only", () => {
  assert.equal(normalizeSpacing("  The   Weeknd  "), "The Weeknd");
  assert.equal(normalizeSpacing("Spider-Man"), "Spider-Man");
});

test("stripOfficial removes the word without leaving gaps or bad grammar", () => {
  assert.equal(stripOfficial("Official Spider Man"), "Spider Man");
  assert.equal(
    stripOfficial("An official poster of The Weeknd."),
    "A poster of The Weeknd.",
  );
  assert.equal(
    stripOfficial("The official artwork, officially styled."),
    "The artwork, styled.",
  );
  assert.equal(stripOfficial("Spider Man"), "Spider Man");
});

test("stripOfficial leaves words that merely contain it alone", () => {
  assert.equal(stripOfficial("Unofficial fan art"), "Unofficial fan art");
});
