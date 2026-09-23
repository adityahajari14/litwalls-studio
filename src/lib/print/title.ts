import { withRequiredTags } from "@/lib/print/tags";
import type { Category } from "@/lib/print/types";

/**
 * Product titles, matching the convention the store already uses.
 *
 * The catalogue holds 154 products following `<Subject> #<NN> | <Suffix>`,
 * sometimes with a subtitle: `The Weeknd #06 - Star Boy | Music Posters`. New
 * products have to join that pattern seamlessly, which means parsing the
 * existing ones well enough to find the next free number.
 *
 * That format is the whole of it — there is no second style to choose
 * between. What varies is the quality of `<Subject>` itself, which is where
 * `isUsableSubject` earns its keep: it is the gate between whatever Gemini or
 * a filename produced and a title that actually ships, rejecting anything
 * that would read as broken to a customer ("Ferrari F!") in favour of a
 * plain fallback a human fixes in one edit.
 *
 * Everything here is pure, so the review UI can preview the exact title the
 * publisher will produce rather than an approximation of it.
 */

/**
 * Assemble a product title.
 *
 * The suffix comes from the CATEGORY OBJECT rather than a lookup table, so
 * adding a collection in Shopify is enough — no code change. The batch carries
 * a snapshot of its category, which also means a batch published months later
 * still uses the suffix that was correct when it was created.
 */
export function categorySuffix(category: Pick<Category, "suffix">): string {
  return category.suffix;
}

/**
 * Guarantee the collection tag is present, without disturbing the rest.
 *
 * Collection membership in this store is a SIDE EFFECT OF TAGGING — every
 * collection is smart and keyed on a tag. Get the tag right and the product
 * appears; get it wrong and the product is live but invisible in every
 * collection, which is the failure mode to watch for. So the tag is added
 * rather than trusted to a model or a human.
 *
 * Compared case-insensitively because the live tag cloud already carries
 * near-duplicates ("Weeknd"/"weekend"/"Weekend"); adding a second "marvel"
 * beside an existing "Marvel" would make that worse for no benefit.
 *
 * A manual collection has no tag, so there is nothing to add — the publisher
 * handles those with an explicit collection add.
 *
 * The general form is `withRequiredTags`, which the publisher uses to add the
 * orientation and format tags at the same time. This stays as the one-category
 * shorthand the title module has always exposed.
 */
export function ensureCategoryTag(
  tags: readonly string[],
  category: Pick<Category, "tag">,
): string[] {
  return withRequiredTags(tags, category.tag ? [category.tag] : []);
}

export type TitleParts = {
  subject: string;
  sequence: number;
  subtitle: string | null;
};

/**
 * A stable key for grouping titles by subject.
 *
 * Case- and whitespace-insensitive, and this is not hypothetical tidiness: the
 * catalogue contains both "AP Dhillon #01" and "Ap Dhillon #02" — one artist
 * split into two sequences by a single capital letter. Without normalising,
 * the numbering would look at "AP Dhillon" and cheerfully hand out #02 again,
 * or invent a third spelling.
 */
export function subjectKey(subject: string): string {
  return subject.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * `Spider Man #01 | Marvel Posters`
 * `The Weeknd #06 - Star Boy | Music Posters`
 *
 * The number is zero-padded to two digits to match every existing title. It
 * widens naturally past 99 rather than truncating.
 */
export function formatTitle(
  parts: { subject: string; sequence: number; subtitle?: string | null },
  category: Pick<Category, "suffix">,
): string {
  const subject = parts.subject.trim();
  const number = String(parts.sequence).padStart(2, "0");
  const subtitle = parts.subtitle?.trim();
  const head = subtitle
    ? `${subject} #${number} - ${subtitle}`
    : `${subject} #${number}`;
  return `${head} | ${category.suffix}`;
}

/**
 * Pull the parts back out of an existing title, or null if it is not numbered.
 *
 * Returning null is the normal path for about 20 of the 154 live titles —
 * "Batman - Wanted", "Captain America Worthy", "Custom Poster". Those are
 * legitimate products that simply predate or sit outside the numbering scheme.
 * The caller SKIPS them; it must not try to renumber or repair them, and it
 * must not treat them as an error.
 *
 * Also tolerates a missing suffix: the catalogue has one bare "Superman #03".
 * The number is what we are after, and it is present.
 */
export function parseTitle(title: string): TitleParts | null {
  // Drop the " | ... Posters" suffix if present. Split on the LAST pipe so a
  // subject containing one cannot truncate the parse.
  const pipe = title.lastIndexOf("|");
  const head = (pipe === -1 ? title : title.slice(0, pipe)).trim();

  // `<subject> #<nn>` with an optional ` - <subtitle>` tail.
  const match = head.match(/^(.*?)\s*#(\d+)(?:\s*-\s*(.+))?$/);
  if (!match) return null;

  const [, subject, digits, subtitle] = match;
  if (!subject.trim()) return null;

  const sequence = Number.parseInt(digits, 10);
  if (!Number.isFinite(sequence)) return null;

  return {
    subject: subject.trim(),
    sequence,
    subtitle: subtitle?.trim() || null,
  };
}

/**
 * The next free sequence number for a subject, given the numbers already used.
 *
 * MAX + 1 — deliberately, and this is the single most important decision in
 * this file.
 *
 * The obvious alternatives are both wrong against the real catalogue:
 *   • count + 1 collides immediately. The Weeknd has five numbered posters
 *     (01, 02, 04, 05, 07); count+1 would propose 06, which is taken.
 *   • lowest free gap resurrects numbers that were skipped on purpose, and
 *     hands every poster in a batch the same "lowest gap" because none of them
 *     exist yet.
 *
 * `used` should combine the live catalogue with numbers already assigned
 * earlier in this batch run, so ten Spider-Man posters number 06…15 rather
 * than all claiming 06.
 */
export function nextSequence(used: readonly number[]): number {
  let max = 0;
  for (const n of used) {
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Collect the sequence numbers already used per subject, from a list of live
 * product titles. Un-numbered titles are skipped silently — see parseTitle.
 */
export function sequencesBySubject(
  titles: readonly string[],
): Map<string, number[]> {
  const bySubject = new Map<string, number[]>();
  for (const title of titles) {
    const parts = parseTitle(title);
    if (!parts) continue;
    const key = subjectKey(parts.subject);
    const list = bySubject.get(key);
    if (list) list.push(parts.sequence);
    else bySubject.set(key, [parts.sequence]);
  }
  return bySubject;
}

/**
 * Characters a subject or subtitle may contain.
 *
 * These are proper nouns — people, characters, bands, teams, car and console
 * models — so the punctuation genuinely at home in one is narrow: an
 * apostrophe ("Guns N' Roses"), a hyphen ("Spider-Man"), an ampersand ("Simon
 * & Garfunkel") or a slash ("AC/DC"). A model or edition number that is part
 * of the real name stays too ("Ferrari F1", "GT3 RS"). Anything else that
 * reaches here is noise, not content — usually the model garbling one
 * character (a stray "!" where a "1" belonged), and it has shipped as a live
 * product title before this existed.
 */
const SUBJECT_CHARS = /^[\p{L}\p{N}\s'&/-]*$/u;

/** Trim and collapse whitespace. Cosmetic only — never changes meaning. */
export function normalizeSpacing(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Whether a subject or subtitle is clean enough to publish under.
 *
 * Rejects anything shorter than two characters, made of nothing but digits or
 * punctuation, or carrying a character outside `SUBJECT_CHARS`. The caller's
 * job on `false` is to fall back to something known-clean — the filename —
 * rather than ship a title with a hallucinated symbol sitting in it.
 */
export function isUsableSubject(raw: string): boolean {
  const value = normalizeSpacing(raw);
  return (
    value.length >= 2 && SUBJECT_CHARS.test(value) && /\p{L}/u.test(value)
  );
}

/**
 * Turn a filename into a usable subject when the model is unavailable.
 *
 * Poster files are usually named after what they depict, so this is a
 * genuinely decent fallback rather than a placeholder — "spider-man_02.jpg"
 * becomes "Spider Man 02", which a human can fix in one edit. Runs through the
 * same character whitelist as the AI path, so an odd filename ("poster★final
 * (1).jpg") cannot land a stray symbol in a title either.
 */
export function subjectFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return normalizeSpacing(
    stem.replace(/[_-]+/g, " ").replace(/[^\p{L}\p{N}\s'&/-]/gu, ""),
  )
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
