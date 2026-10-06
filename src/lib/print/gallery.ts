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
    ...job.mockups.map((mockup) => ({
      kind: "mockup" as const,
      templateId: mockup.templateId,
    })),
    ...job.images,
  ];
}
