import type { PosterJob, ProductImageRef } from "@/lib/print/types";

/**
 * The gallery a poster publishes with — the one place that decides it, shared
 * by the publisher and the review screen so what is shown is what is sent.
 *
 * A job's `images` is not empty by default: it is seeded from the batch's
 * shared library images (the size guide and the like) when the job is created,
 * long before any mockup exists. Reading "non-empty" as "a human curated this"
 * therefore meant every published product went out with ONLY those library
 * images, and every mockup the pipeline rendered was dropped at the last step.
 *
 * So: when the stored gallery references no mockup at all, every rendered
 * mockup leads it. Someone who wants a product without mockups can still get
 * one by not rendering any; what cannot be told apart from the seeded default
 * is a gallery from which they were deliberately all removed.
 */
export function effectiveGallery(
  job: Pick<PosterJob, "images" | "mockups">,
): ProductImageRef[] {
  if (job.images.some((image) => image.kind === "mockup")) return job.images;

  return [
    // In the order they were rendered, which is the sequence chosen for the
    // batch (see `inSequence`) — so the mockup put first there is the
    // product's thumbnail without anyone opening the review screen.
    ...job.mockups.map((mockup) => ({
      kind: "mockup" as const,
      templateId: mockup.templateId,
    })),
    ...job.images,
  ];
}

/**
 * The chosen items, in the order they were chosen.
 *
 * PURE. A list of ids is a sequence, not a set: the first mockup is the image
 * a product leads with everywhere on Shopify. Filtering the library by "is it
 * selected" — which is what the mockup stage used to do — returns the right
 * templates in the LIBRARY's order, and whatever sequence was picked is lost
 * without anything looking wrong.
 *
 * An id that matches nothing is skipped, since a template can be deleted after
 * a batch was set up with it, and a repeated id counts once.
 */
export function inSequence<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const id of new Set(ids)) {
    const item = byId.get(id);
    if (item) out.push(item);
  }
  return out;
}
