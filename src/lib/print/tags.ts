import type { Orientation } from "@/lib/print/orientation";
import type { Category, PosterKind } from "@/lib/print/types";

/**
 * The tags a product MUST carry, as opposed to the ones describing what it
 * depicts.
 *
 * PURE — the review screen shows what will be added and the publisher adds it,
 * from this one list. Every collection in this store is a smart collection
 * keyed on a tag, so a tag is not decoration here: it is the mechanism that
 * makes a product appear anywhere at all. Leaving one to a model or a human to
 * remember is how a product goes live and shows up in no collection.
 */

/**
 * Which way round the poster hangs.
 *
 * Worth tagging because it is the one thing about a poster a shopper filters
 * on that is invisible in the title — "Spider Man #06 | Marvel Posters" says
 * nothing about whether it fits above a desk or beside a door. Title Case to
 * match the catalogue's existing tag vocabulary.
 */
export const ORIENTATION_TAGS: Record<Orientation, string> = {
  portrait: "Portrait",
  landscape: "Landscape",
};

/**
 * A three-panel set. A genuinely different product from a single sheet at the
 * same nominal size — different price table, different sizes offered, three
 * sheets in the tube — so it is tagged rather than left to the description.
 */
export const SPLIT_TAG = "Split Poster";

/** Case- and whitespace-insensitive key, matching `subjectKey`'s reasoning:
 *  the live tag cloud already carries "Weeknd"/"weekend"/"Weekend", and
 *  adding a second spelling beside an existing one makes that worse. */
function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Add the tags that must be present, and only those.
 *
 * Missing ones go IN FRONT, so the structural tags read first in the admin.
 * A required tag already present — in any casing — is left exactly as the
 * human or the model spelled it: correcting "marvel" to "Marvel" would be
 * a silent edit of someone's deliberate choice, and both put the product in
 * the same collection anyway.
 */
export function withRequiredTags(
  tags: readonly string[],
  required: readonly string[],
): string[] {
  return [...missingTags(tags, required), ...tags];
}

/**
 * Which required tags are not there yet — what `withRequiredTags` would add.
 *
 * Exported so the review screen can show the list before publishing rather
 * than describing it in prose. Same function, so the preview cannot drift
 * from what actually goes to Shopify.
 */
export function missingTags(
  tags: readonly string[],
  required: readonly string[],
): string[] {
  const present = new Set(tags.map(tagKey));
  const missing: string[] = [];

  for (const tag of required) {
    const key = tagKey(tag);
    if (!key || present.has(key)) continue;
    present.add(key);
    missing.push(tag.trim());
  }

  return missing;
}

/**
 * Every tag this product has to carry, in the order they should appear.
 *
 * Collection tags lead because they are the ones with consequences — get one
 * wrong and the product is live but invisible. A manual collection has no tag
 * (membership needs an explicit add), so it contributes nothing here and is
 * joined by `collectionAddProducts` at publish instead.
 */
export function requiredTagsFor(input: {
  /** Every collection the product belongs to, main first. */
  categories: readonly Pick<Category, "tag">[];
  /** How the finished product hangs — see `productOrientation`. */
  orientation: Orientation;
  kind: PosterKind;
}): string[] {
  const out: string[] = [];

  for (const category of input.categories) {
    if (category.tag) out.push(category.tag);
  }

  out.push(ORIENTATION_TAGS[input.orientation]);
  if (input.kind === "split3") out.push(SPLIT_TAG);

  // Deduplicated here too: two collections keyed on the same tag is unusual
  // but not impossible, and Shopify would silently keep one of them anyway.
  return missingTags([], out);
}
