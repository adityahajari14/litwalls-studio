import "server-only";

import { storefront } from "@/lib/shopify/storefront";
import {
  nextSequence,
  sequencesBySubject,
  subjectKey,
} from "@/lib/print/title";

/**
 * Work out the next free `#NN` for a subject, from the live catalogue.
 *
 * Numbers are assigned at PUBLISH time rather than when a poster is analysed:
 * a number chosen an hour ago may have been taken since, and a duplicate title
 * is exactly the kind of mistake that is tedious to unpick in Shopify.
 */

const PAGE_SIZE = 250;

const PRODUCT_TITLES = /* GraphQL */ `
  query ProductTitles($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        title
        tags
      }
    }
  }
`;

type ProductTitlesResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { title: string; tags: string[] }[];
  };
};

/**
 * Every product title in the store.
 *
 * Paginated because the catalogue will outgrow one page, and a partial list
 * would silently under-count a subject and propose a number already in use.
 * The safety valve is a page cap, not a time limit — an unbounded loop against
 * a paginated API is how a bug becomes an outage.
 */
export async function fetchCatalogue(): Promise<{
  titles: string[];
  tags: string[];
}> {
  const titles: string[] = [];
  const tags = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < 40; page++) {
    const data: ProductTitlesResponse = await storefront<ProductTitlesResponse>(
      PRODUCT_TITLES,
      { cursor },
    );
    for (const node of data.products.nodes) {
      titles.push(node.title);
      for (const tag of node.tags) tags.add(tag);
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return { titles, tags: [...tags].sort() };
}

export async function fetchAllTitles(): Promise<string[]> {
  return (await fetchCatalogue()).titles;
}

/**
 * A numbering session for one publish run.
 *
 * Fetches the catalogue once, then hands out numbers locally, remembering what
 * it has already given away. Without that memory, ten Spider-Man posters in
 * one batch would all be told "the next number is 06", because none of them
 * exist in Shopify yet.
 */
export class Numberer {
  // Declared explicitly rather than as a constructor parameter property:
  // Node's strip-only TypeScript mode (used by `node --test`) cannot handle
  // parameter properties, and this module is exercised by the test suite.
  private readonly used: Map<string, number[]>;

  private constructor(used: Map<string, number[]>) {
    this.used = used;
  }

  static async load(): Promise<Numberer> {
    const titles = await fetchAllTitles();
    return new Numberer(sequencesBySubject(titles));
  }

  /** For tests and for offline use — seed from a known list of titles. */
  static fromTitles(titles: readonly string[]): Numberer {
    return new Numberer(sequencesBySubject(titles));
  }

  /**
   * Claim the next number for a subject.
   *
   * Claiming mutates the session, so calling twice for the same subject yields
   * consecutive numbers rather than the same one twice.
   *
   * Subjects are grouped globally, not per collection. Verified against the
   * live catalogue: no subject appears under more than one collection suffix,
   * so scoping by category would add a parameter that never changes an answer.
   */
  claim(subject: string): number {
    const key = subjectKey(subject);
    const existing = this.used.get(key) ?? [];
    const next = nextSequence(existing);
    this.used.set(key, [...existing, next]);
    return next;
  }

  /**
   * Claim one SPECIFIC number, if nobody holds it.
   *
   * For re-creating a product whose Shopify copy was deleted: it can take its
   * old number back, provided nothing else has used it in the meantime.
   * Returns false, claiming nothing, when the number is taken.
   */
  reserve(subject: string, sequence: number): boolean {
    const key = subjectKey(subject);
    const existing = this.used.get(key) ?? [];
    if (existing.includes(sequence)) return false;
    this.used.set(key, [...existing, sequence]);
    return true;
  }

  /** What `claim` would return, without consuming it. For previews. */
  peek(subject: string): number {
    return nextSequence(this.used.get(subjectKey(subject)) ?? []);
  }
}
