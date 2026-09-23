import type { Batch, Category, PosterJob } from "@/lib/print/types";

/**
 * Which collections a poster actually publishes into.
 *
 * PURE — the review screen previews the title from this and the publisher
 * builds the product from it, so what a human approves is what goes out.
 *
 * There are two sources and a strict precedence. A poster's own `categories`
 * win, because they are either what the model chose for this specific artwork
 * on an auto batch or what a human set on the review screen. Otherwise the
 * batch's single collection stands in. An auto batch whose poster has not been
 * analyzed yet has neither, and that is a real state the caller has to handle
 * rather than paper over — publishing into no collection produces a product
 * that is live and appears nowhere.
 */

/**
 * The sentinel the batch form posts instead of a collection handle when the
 * user picks Auto.
 *
 * A reserved string rather than an omitted field, so "the user chose auto" and
 * "the request forgot to say" stay distinguishable at the API boundary — one
 * is a batch to create, the other is a 400. Prefixed so it can never collide
 * with a real Shopify handle, which is lowercase letters, digits and hyphens.
 */
export const AUTO_CATEGORY = "__auto__";

/** True when this batch chooses collections per poster rather than using one
 *  for all of them. */
export function isAutoBatch(batch: Pick<Batch, "category">): boolean {
  return batch.category === null;
}

/**
 * Every collection this poster belongs to, MAIN FIRST.
 *
 * Empty only on an auto batch with nothing assigned yet.
 */
export function categoriesFor(
  job: Pick<PosterJob, "categories">,
  batch: Pick<Batch, "category">,
): Category[] {
  if (job.categories && job.categories.length > 0) return job.categories;
  return batch.category ? [batch.category] : [];
}

/**
 * The one collection that names the product: its suffix ends the title, its
 * handle goes in the SKU, its label names the Drive folder.
 *
 * Null when nothing is assigned. Callers that need a name must say so rather
 * than substituting a placeholder — a product titled "… | Posters" because a
 * fallback string leaked into the suffix is worse than a publish that stops
 * and asks.
 */
export function mainCategoryFor(
  job: Pick<PosterJob, "categories">,
  batch: Pick<Batch, "category">,
): Category | null {
  return categoriesFor(job, batch)[0] ?? null;
}

/**
 * Resolve handles to live collections, preserving the ORDER GIVEN.
 *
 * Order is the whole point: the first handle the model returns is the main
 * collection, so a resolver that sorted or deduplicated carelessly would
 * quietly rename every product in the batch. Unknown handles are dropped —
 * a model that invents "superhero-posters" should cost a collection, not the
 * publish.
 */
export function resolveCategories(
  handles: readonly string[],
  available: readonly Category[],
): Category[] {
  const byId = new Map(available.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Category[] = [];

  for (const handle of handles) {
    const id = handle.trim();
    const category = byId.get(id);
    if (!category || seen.has(id)) continue;
    seen.add(id);
    out.push(category);
  }

  return out;
}
