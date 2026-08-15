import type { Category } from "../../src/lib/print/types.ts";

/**
 * Category fixtures matching the live store, verified against the Admin API.
 *
 * Categories are read from Shopify at runtime rather than hardcoded, so tests
 * need a stand-in. These mirror the real collections so the assertions still
 * say something about the actual store rather than an invented one.
 */

export const MARVEL: Category = {
  id: "marvel",
  label: "Marvel",
  suffix: "Marvel Posters",
  tag: "Marvel",
  collectionId: "gid://shopify/Collection/1",
  smart: true,
};

export const MUSIC: Category = {
  id: "music",
  label: "Music",
  suffix: "Music Posters",
  tag: "Music",
  collectionId: "gid://shopify/Collection/2",
  smart: true,
};

/**
 * Movies & TV matches Movies OR Series OR Netflix. "Movies" is the tag the
 * existing catalogue actually uses, and the one the first rule reports.
 */
export const MOVIES: Category = {
  id: "movies-tv",
  label: "Movies & TV",
  suffix: "Movies & TV Posters",
  tag: "Movies",
  collectionId: "gid://shopify/Collection/3",
  smart: true,
};

/** A manual collection — no tag, so membership needs an explicit add. */
export const MANUAL: Category = {
  id: "featured",
  label: "Featured",
  suffix: "Featured Posters",
  tag: null,
  collectionId: "gid://shopify/Collection/4",
  smart: false,
};
