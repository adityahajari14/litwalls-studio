import { SIZE_IDS } from "@/lib/print/sizes";
import type { SizeId } from "@/lib/print/types";

/**
 * Prices, resolved through three levels of override.
 *
 *   1. Per-poster  — set on the review screen for one product.
 *   2. Per-batch   — set when creating a batch, applies to every job in it.
 *   3. Settings    — the dashboard default, used when neither is given.
 *
 * Each level only has to specify the sizes it wants to change; anything absent
 * falls through to the next. That makes "this one batch is premium stock" a
 * two-field edit rather than a full table re-entry, and it means adding a
 * fifth size later cannot leave an old batch with a silently missing price.
 *
 * Money is a decimal string throughout, never a number. Shopify's API takes
 * strings, and floating point cannot represent 0.10 exactly — a price that
 * round-trips through a float is a price that can arrive as 799.0000000001.
 */

export type PriceTable = Record<SizeId, string>;
export type PartialPriceTable = Partial<Record<SizeId, string>>;

/**
 * The last-resort defaults, used until the dashboard settings are saved once.
 *
 * PLACEHOLDER — every existing product sells at ₹149 for a single 13×19, so
 * these are almost certainly wrong. They exist so the pipeline is never
 * missing a price, not because they are right.
 */
export const FALLBACK_PRICES: PriceTable = {
  A5: "299.00",
  A4: "499.00",
  A3: "799.00",
  "13x19": "999.00",
};

export const FALLBACK_COMPARE_AT: PartialPriceTable = {
  A5: "499.00",
  A4: "799.00",
  A3: "1299.00",
  "13x19": "1599.00",
};

/**
 * Resolve one size's price through the override chain.
 *
 * Ordered most-specific first. `??` rather than `||` is deliberate: an empty
 * string is a *cleared* field and should fall through, but that is handled by
 * `normalizePriceTable` stripping blanks before they get here, so by this
 * point a present value is always a real one.
 */
export function resolvePrice(
  sizeId: SizeId,
  levels: {
    job?: PartialPriceTable;
    batch?: PartialPriceTable;
    settings?: PartialPriceTable;
  },
): string {
  return (
    levels.job?.[sizeId] ??
    levels.batch?.[sizeId] ??
    levels.settings?.[sizeId] ??
    FALLBACK_PRICES[sizeId]
  );
}

/** Resolve the whole table at once, for publishing. */
export function resolvePriceTable(levels: {
  job?: PartialPriceTable;
  batch?: PartialPriceTable;
  settings?: PartialPriceTable;
}): PriceTable {
  const out = {} as PriceTable;
  for (const sizeId of SIZE_IDS) {
    out[sizeId] = resolvePrice(sizeId, levels);
  }
  return out;
}

/** Which level a resolved price came from — shown in the review UI. */
export type PriceOrigin = "job" | "batch" | "settings" | "fallback";

export function priceOrigin(
  sizeId: SizeId,
  levels: {
    job?: PartialPriceTable;
    batch?: PartialPriceTable;
    settings?: PartialPriceTable;
  },
): PriceOrigin {
  if (levels.job?.[sizeId] !== undefined) return "job";
  if (levels.batch?.[sizeId] !== undefined) return "batch";
  if (levels.settings?.[sizeId] !== undefined) return "settings";
  return "fallback";
}

/**
 * Validate and canonicalise a price the user typed.
 *
 * Returns null for anything unusable, so a bad value falls through to the next
 * level rather than reaching Shopify. Accepts "499", "499.5", "₹499", "1,499"
 * and normalises all of them to two decimal places, because people type prices
 * the way they say them and rejecting "₹499" would be pedantry.
 *
 * Rejects negatives and anything over 7 digits — a price like that is a typo
 * (a stray keypress on the numpad), and publishing it live is worse than
 * asking again.
 */
export function normalizePrice(input: string): string | null {
  const cleaned = input.trim().replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 9_999_999) return null;

  return value.toFixed(2);
}

/**
 * Clean a whole table of user input, dropping blanks and rejects.
 *
 * Blank means "no override at this level" — a cleared field must fall through
 * rather than being stored as an empty string that later reads as present.
 */
export function normalizePriceTable(
  input: Partial<Record<SizeId, string | undefined>>,
): PartialPriceTable {
  const out: PartialPriceTable = {};
  for (const sizeId of SIZE_IDS) {
    const raw = input[sizeId];
    if (raw === undefined || raw === null) continue;
    const price = normalizePrice(raw);
    if (price !== null) out[sizeId] = price;
  }
  return out;
}

/**
 * A compare-at price is only meaningful when it exceeds the real price —
 * Shopify shows it struck through, and one that is lower or equal reads as a
 * price *rise*, which is worse than showing nothing.
 */
export function validCompareAt(
  compareAt: string | undefined,
  price: string,
): string | undefined {
  if (!compareAt) return undefined;
  return Number(compareAt) > Number(price) ? compareAt : undefined;
}
