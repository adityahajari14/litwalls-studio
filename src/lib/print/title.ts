import type { CategoryId } from "@/lib/print/types";

/**
 * Product titles, matching the convention the store already uses.
 *
 * The catalogue holds 154 products following `<Subject> #<NN> | <Suffix>`,
 * sometimes with a subtitle: `The Weeknd #06 - Star Boy | Music Posters`. New
 * products have to join that pattern seamlessly, which means parsing the
 * existing ones well enough to find the next free number.
 *
 * Everything here is pure, so the review UI can preview the exact title the
 * publisher will produce rather than an approximation of it.
 */

/**
 * The title suffix for each collection.
 *
 * Note "Movies & TV", plural. The live catalogue contains one product reading
 * "Movie & TV Posters" (singular) against many reading "Movies & TV Posters".
 * That is a typo, and this table is the deliberate decision not to propagate
 * it — new products get the majority spelling.
 */
export const CATEGORY_SUFFIX: Record<CategoryId, string> = {
  marvel: "Marvel Posters",
  dc: "DC Posters",
  "movies-tv": "Movies & TV Posters",
  music: "Music Posters",
};

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  marvel: "Marvel",
  dc: "DC",
  "movies-tv": "Movies & TV",
  music: "Music",
};

export const CATEGORY_IDS = Object.keys(CATEGORY_SUFFIX) as CategoryId[];

/**
 * The tag that puts a product in its collection.
 *
 * All four collections in the live store are SMART collections keyed on tags,
 * verified against the Admin API:
 *
 *   Marvel        TAG = "Marvel"
 *   DC            TAG = "DC"
 *   Music         TAG = "Music"
 *   Movies & TV   TAG = "Movies" OR "Series" OR "Netflix"
 *
 * That has a concrete consequence for publishing: membership is a side effect
 * of tagging, so there is NO collectionAddProducts call to make. Get the tag
 * right and the product appears; get it wrong and the product is live but
 * invisible in every collection, which is the failure mode to watch for.
 *
 * "Movies" is chosen for movies-tv because it is the tag the existing
 * catalogue actually uses — "Series" and "Netflix" also match the rule, but
 * picking the majority spelling keeps the tag cloud from fragmenting further.
 *
 * These tags are REQUIRED. `ensureCategoryTag` below adds one if the model or
 * a human left it out, rather than trusting either to remember.
 */
export const CATEGORY_TAG: Record<CategoryId, string> = {
  marvel: "Marvel",
  dc: "DC",
  "movies-tv": "Movies",
  music: "Music",
};

/**
 * Guarantee the collection tag is present, without disturbing the rest.
 *
 * Compared case-insensitively because the live tag cloud already contains
 * near-duplicates ("Weeknd"/"weekend"/"Weekend"); adding a second "marvel"
 * beside an existing "Marvel" would make that worse while doing nothing
 * useful. An existing tag that differs only by case is left exactly as it is.
 */
export function ensureCategoryTag(
  tags: readonly string[],
  category: CategoryId,
): string[] {
  const required = CATEGORY_TAG[category];
  const present = tags.some(
    (tag) => tag.trim().toLowerCase() === required.toLowerCase(),
  );
  return present ? [...tags] : [required, ...tags];
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
  category: CategoryId,
): string {
  const subject = parts.subject.trim();
  const number = String(parts.sequence).padStart(2, "0");
  const subtitle = parts.subtitle?.trim();
  const head = subtitle
    ? `${subject} #${number} - ${subtitle}`
    : `${subject} #${number}`;
  return `${head} | ${CATEGORY_SUFFIX[category]}`;
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
 * Turn a filename into a usable subject when the model is unavailable.
 *
 * Poster files are usually named after what they depict, so this is a
 * genuinely decent fallback rather than a placeholder — "spider-man_02.jpg"
 * becomes "Spider Man 02", which a human can fix in one edit.
 */
export function subjectFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
