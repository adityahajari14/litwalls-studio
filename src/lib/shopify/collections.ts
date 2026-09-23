import "server-only";

import { storefront } from "@/lib/shopify/storefront";
import { admin } from "@/lib/shopify/admin";
import type { Category } from "@/lib/print/types";

/**
 * The store's collections, as the categories a batch can belong to.
 *
 * These were a hardcoded four-value TypeScript union, which meant adding
 * "Anime" or "Gaming" was a code change — the single biggest limit on how far
 * the tool could reach. They are read from Shopify instead, so a collection
 * created in the admin shows up here on the next reload.
 *
 * Every collection in this store is a SMART collection keyed on tags, so the
 * rule tells us exactly which tag makes a product a member. That is what turns
 * a collection into something Studio can publish INTO rather than merely
 * report on.
 */

/**
 * Collections Studio must never offer or publish into, by handle.
 *
 * `custom-prints` is the storefront's made-to-order upload flow, not a
 * catalogue collection — a poster filed there is titled after a collection it
 * does not belong in and appears on a page customers reach only by ordering a
 * custom print. Filtered at the source so it is gone from the batch form, the
 * review screen, and the list handed to Gemini all at once.
 */
export const HIDDEN_COLLECTION_HANDLES = new Set<string>(["custom-prints"]);

/** Drop the collections Studio is not allowed to use. Pure — unit-tested. */
export function withoutHiddenCollections(list: Category[]): Category[] {
  return list.filter((category) => !HIDDEN_COLLECTION_HANDLES.has(category.id));
}

const COLLECTIONS = /* GraphQL */ `
  query Collections {
    collections(first: 100) {
      nodes {
        id
        handle
        title
        ruleSet {
          appliedDisjunctively
          rules {
            column
            relation
            condition
          }
        }
      }
    }
  }
`;

type CollectionsResponse = {
  collections: {
    nodes: {
      id: string;
      handle: string;
      title: string;
      ruleSet: {
        appliedDisjunctively: boolean;
        rules: { column: string; relation: string; condition: string }[];
      } | null;
    }[];
  };
};

/**
 * The title suffix for a collection, derived from its name.
 *
 * The catalogue's convention is "<Subject> #NN | <Collection> Posters", so the
 * suffix is the collection title plus the word Posters — unless the title
 * already ends with it, which would otherwise produce "Music Posters Posters".
 */
function suffixFor(title: string): string {
  return /posters?$/i.test(title.trim()) ? title.trim() : `${title.trim()} Posters`;
}

/**
 * Which tag puts a product in this collection.
 *
 * Smart collections can match on several tags (Movies & TV matches Movies OR
 * Series OR Netflix); the FIRST rule wins, because that is the one the
 * existing catalogue actually uses. A manual collection has no rule, so
 * membership needs an explicit add — flagged rather than guessed at.
 */
function tagFor(node: CollectionsResponse["collections"]["nodes"][number]): string | null {
  const rule = node.ruleSet?.rules.find(
    (r) => r.column === "TAG" && r.relation === "EQUALS",
  );
  return rule?.condition ?? null;
}

export async function fetchCategories(): Promise<Category[]> {
  const data = await admin<CollectionsResponse>(COLLECTIONS);

  return withoutHiddenCollections(
    data.collections.nodes.map((node) => ({
      id: node.handle,
      label: node.title,
      suffix: suffixFor(node.title),
      tag: tagFor(node),
      collectionId: node.id,
      smart: node.ruleSet !== null,
    })),
  ).sort((a, b) => a.label.localeCompare(b.label));
}

/** Storefront fallback — works even without a write-scoped Admin token. */
const STOREFRONT_COLLECTIONS = /* GraphQL */ `
  query StorefrontCollections {
    collections(first: 100) {
      nodes {
        id
        handle
        title
      }
    }
  }
`;

export async function fetchCategoriesFallback(): Promise<Category[]> {
  const data = await storefront<{
    collections: { nodes: { id: string; handle: string; title: string }[] };
  }>(STOREFRONT_COLLECTIONS);

  return withoutHiddenCollections(
    data.collections.nodes.map((node) => ({
      id: node.handle,
      label: node.title,
      suffix: suffixFor(node.title),
      // The Storefront API does not expose collection rules, so the tag is
      // guessed from the title. Usually right, and the batch form lets it be
      // corrected — better than refusing to offer the collection at all.
      tag: node.title.trim().replace(/\s*posters?$/i, ""),
      collectionId: node.id,
      smart: true,
    })),
  ).sort((a, b) => a.label.localeCompare(b.label));
}
