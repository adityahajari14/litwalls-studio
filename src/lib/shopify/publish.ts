import "server-only";

import { readFile } from "node:fs/promises";

import { stageLibraryImage } from "@/lib/library/media";
import { jobAsset } from "@/lib/pipeline/paths";
import { descriptionFor } from "@/lib/print/description";
import { effectiveGallery } from "@/lib/print/gallery";
import {
  FALLBACK_SPLIT_PRICES,
  resolvePriceTable,
  validCompareAt,
} from "@/lib/print/pricing";
import { SIZES, sizeIdsFor, sizesFor } from "@/lib/print/sizes";
import {
  seoDescriptionFor,
  seoTitleFor,
  skuFor,
} from "@/lib/print/identity";
import {
  forgetPublished,
  listPublished,
  recordPublished,
} from "@/lib/pipeline/registry";
import { categoriesFor } from "@/lib/print/categories";
import { productOrientation } from "@/lib/print/orientation";
import { requiredTagsFor, withRequiredTags } from "@/lib/print/tags";
import { formatTitle, parseTitle, stripOfficial } from "@/lib/print/title";
import type {
  Batch,
  Category,
  PosterJob,
  ShopifyRefs,
  SizeId,
} from "@/lib/print/types";
import { err, ok, type Result } from "@/lib/result";
import {
  admin,
  createImageUpload,
  uploadToStagedTarget,
} from "@/lib/shopify/admin";
import { Numberer } from "@/lib/shopify/numbering";

/**
 * Create the Shopify product: one product, four size variants.
 *
 * `productSet` rather than `productCreate`, which only supports a product's
 * INITIAL variant and would need a three-call dance to add the rest — three
 * chances to fail halfway and leave a broken product. productSet takes
 * options, variants and files in one declarative call, so a retry converges
 * on the same product instead of creating a duplicate.
 */

const PRODUCT_SET = /* GraphQL */ `
  mutation AdminProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        handle
        title
        status
        media(first: 25) {
          nodes {
            id
            alt
          }
        }
        variants(first: 10) {
          nodes {
            id
            title
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const PRODUCT_EXISTS = /* GraphQL */ `
  query ProductExists($id: ID!) {
    product(id: $id) {
      id
    }
  }
`;

const PUBLICATIONS = /* GraphQL */ `
  query Publications {
    publications(first: 25) {
      nodes {
        id
        name
      }
    }
  }
`;

/**
 * Joining a MANUAL collection.
 *
 * Tags cannot do this: a manual collection has no rule to satisfy, so
 * membership is an explicit add. Kept out of the `productSet` input on
 * purpose — that mutation is declarative, and handing it a collection list
 * would make it authoritative over membership the store manages by rule.
 */
const COLLECTION_ADD = /* GraphQL */ `
  mutation AddToCollection($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      userErrors {
        field
        message
      }
    }
  }
`;

const PUBLISHABLE_PUBLISH = /* GraphQL */ `
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

/** The image sent to Shopify for each size. */
function mediaFor(job: PosterJob, sizeId: SizeId) {
  // For a split poster the first panel stands in for the set: Shopify shows
  // one image per variant, and a lone middle panel would be baffling.
  return (
    job.assets.find((a) => a.sizeId === sizeId && a.panel === 1) ??
    job.assets.find((a) => a.sizeId === sizeId) ??
    null
  );
}

/**
 * The product's image gallery, in display order.
 *
 * Built from `job.images` when a human has curated it on the review screen,
 * and otherwise defaulted to "every rendered mockup, then every library
 * image". The default matters: a batch published without anyone opening the
 * review screen should still get a proper gallery rather than nothing.
 *
 * A single failed image never fails the publish — a product with one missing
 * gallery shot is worth far more than no product at all.
 */
async function stageGallery(
  job: PosterJob,
  subject: string,
): Promise<{ originalSource: string; alt: string }[]> {
  const curated = effectiveGallery(job);
  const out: { originalSource: string; alt: string }[] = [];

  for (const ref of curated) {
    try {
      if (ref.kind === "mockup") {
        const mockup = job.mockups.find((m) => m.templateId === ref.templateId);
        if (!mockup) continue;
        out.push(
          await stageImage(job, mockup.relPath, `${subject} — in a room`),
        );
      } else if (ref.kind === "library") {
        const file = await stageLibraryImage(ref.libraryId);
        if (file) out.push(file);
      } else {
        out.push(await stageImage(job, ref.relPath, subject));
      }
    } catch (cause) {
      console.warn(
        `publish: skipped a gallery image for ${job.sourceName}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  return out;
}

async function stageImage(
  job: PosterJob,
  relPath: string,
  altText: string,
): Promise<{ originalSource: string; alt: string }> {
  const bytes = await readFile(jobAsset(job.batchId, job.id, relPath));
  const filename = `${job.id}-${relPath.replace(/\//g, "-")}`;

  const target = await createImageUpload({
    filename,
    mimeType: "image/jpeg",
    fileSize: bytes.byteLength,
  });
  await uploadToStagedTarget(target, bytes, filename, "image/jpeg");

  return { originalSource: target.resourceUrl, alt: altText };
}

/**
 * Every sales channel to publish to.
 *
 * ALL of them, not a guess at the right one. This store has four publications
 * — Online Store, Point of Sale, "Litwalls Headless" and "Headless" — and
 * every existing product is on all four. An earlier version picked the first
 * name matching /headless/, chose the wrong one of the two, and produced a
 * product that looked published in the admin while being completely invisible
 * to the storefront's getProduct(). That is the single most confusing failure
 * this pipeline can produce, because nothing about it looks broken.
 *
 * SHOPIFY_PUBLICATION_ID still overrides, for a store that genuinely wants
 * one channel only.
 */
async function publicationIds(): Promise<string[]> {
  const configured = process.env.SHOPIFY_PUBLICATION_ID?.trim();
  if (configured) return [configured];

  try {
    const data = await admin<{
      publications: { nodes: { id: string; name: string }[] };
    }>(PUBLICATIONS);
    return data.publications.nodes.map((node) => node.id);
  } catch {
    return [];
  }
}

/**
 * Add the product to every collection a tag cannot reach.
 *
 * Best-effort, like channel publication: the product exists either way, and
 * failing a whole publish over a membership fixable with one click in the
 * admin would be the wrong trade. Warns per collection so the reason is in
 * the log rather than inferred from an empty collection page later.
 */
async function joinManualCollections(
  productId: string,
  categories: readonly Category[],
): Promise<void> {
  for (const category of categories) {
    if (category.smart) continue;
    try {
      await admin(COLLECTION_ADD, {
        id: category.collectionId,
        productIds: [productId],
      });
    } catch (cause) {
      console.warn(
        `publish: could not add the product to "${category.label}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }
}

/** The number an already-published poster's title carries, if it can be found. */
/**
 * Whether Shopify still has this product. A product deleted in the admin
 * leaves its id behind in the job, and `productSet` with a dead id fails with
 * "input.id: Product does not exist" instead of creating anything.
 */
async function productExists(id: string): Promise<boolean> {
  const data = await admin<{ product: { id: string } | null }>(PRODUCT_EXISTS, {
    id,
  });
  return data.product !== null;
}

async function existingSequence(job: PosterJob): Promise<number | null> {
  if (job.shopify?.sequence) return job.shopify.sequence;
  const record = (await listPublished()).find(
    (entry) => entry.productId === job.shopify?.productId,
  );
  return record ? (parseTitle(record.title)?.sequence ?? null) : null;
}

export async function publishJob(options: {
  job: PosterJob;
  batch: Batch;
  settingsPrices: Partial<Record<SizeId, string>>;
  settingsCompareAt: Partial<Record<SizeId, string>>;
  /** Dashboard defaults for split-3 posters — a different product from a
   *  single sheet at the same nominal size, priced separately. */
  settingsSplitPrices: Partial<Record<SizeId, string>>;
  settingsSplitCompareAt: Partial<Record<SizeId, string>>;
  descriptionTemplate: string;
  numberer: Numberer;
  /** DRAFT keeps it out of the storefront until variants are supported. */
  status?: "ACTIVE" | "DRAFT";
}): Promise<Result<ShopifyRefs>> {
  const { job, batch, numberer } = options;
  const isSplit = job.kind === "split3";
  // Split-3 does not sell at A5 — three 148mm-wide panels is not a product —
  // so every size-driven step below iterates this rather than the full list.
  const sizes = sizesFor(job.kind);

  // Stripped again here, not only when Gemini answers: a poster analysed
  // before the rule existed, or a subject typed by hand, must not publish
  // with "official" in its title either.
  const subject = stripOfficial(job.metadata?.subject?.trim() ?? "");
  if (!subject) return err("Set a subject before publishing.");
  if (job.assets.length === 0) return err("This poster has not been rendered.");

  // Main first. On an auto batch this is what the model chose and a human
  // approved; otherwise it is the batch's one collection. Empty is only
  // possible on an auto batch nothing was filed into, and it stops the
  // publish rather than defaulting: a product with no collection is live,
  // findable by nobody, and titled after a collection it is not in.
  const categories = categoriesFor(job, batch);
  const category = categories[0];
  if (!category) {
    return err(
      "This poster has not been filed into a collection. " +
        "Pick one on the review screen before publishing.",
    );
  }

  // Claimed here, moments before the mutation, against a catalogue snapshot
  // taken for this run — not at analyze time, when a number could since have
  // been taken by another publish.
  //
  // A republish keeps the number it already has: the catalogue now contains
  // this very product, so claiming again would hand out the NEXT number and
  // rename a live product. Products published before the number was recorded
  // are recovered from the title the registry kept.
  //
  // If the product has been deleted in Shopify since, there is nothing to
  // update: it is created again as a new product, taking its old number back
  // when nothing else has used it meanwhile.
  let productId = job.shopify?.productId ?? null;
  let deletedProductId: string | null = null;
  if (productId) {
    try {
      if (!(await productExists(productId))) {
        deletedProductId = productId;
        productId = null;
      }
    } catch (cause) {
      return err(
        `Could not check whether the Shopify product still exists: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  const previousSequence = job.shopify ? await existingSequence(job) : null;
  const sequence = productId
    ? (previousSequence ?? job.metadata?.sequence ?? numberer.claim(subject))
    : previousSequence !== null && numberer.reserve(subject, previousSequence)
      ? previousSequence
      : (job.metadata?.sequence ?? numberer.claim(subject));
  const title = formatTitle(
    {
      subject,
      sequence,
      subtitle: job.metadata?.subtitle
        ? stripOfficial(job.metadata.subtitle) || null
        : null,
    },
    category,
  );

  const prices = resolvePriceTable(
    {
      job: job.priceOverrides,
      batch: batch.prices,
      settings: isSplit ? options.settingsSplitPrices : options.settingsPrices,
    },
    sizeIdsFor(job.kind),
    isSplit ? FALLBACK_SPLIT_PRICES : undefined,
  );
  const compareAt = resolvePriceTable(
    {
      job: job.compareAtOverrides,
      batch: batch.compareAt,
      settings: isSplit
        ? options.settingsSplitCompareAt
        : options.settingsCompareAt,
    },
    sizeIdsFor(job.kind),
    isSplit ? FALLBACK_SPLIT_PRICES : undefined,
  );

  try {
    // Staged in parallel: independent uploads that do not depend on each
    // other, and doing them in sequence multiplies the wait for no benefit.
    const staged = await Promise.all(
      sizes.map(async (size) => {
        const asset = mediaFor(job, size.id);
        if (!asset) return null;
        const alt = job.metadata?.altText || `${subject} — ${size.label}`;
        return {
          sizeId: size.id,
          file: await stageImage(job, asset.relPath, `${alt} (${size.label})`),
        };
      }),
    );

    // The gallery: mockups first, then shared library images, then the plain
    // artwork. Mockups lead because a poster on a wall sells better than a
    // flat scan of it, and Shopify uses the first image as the thumbnail
    // everywhere — collection cards, search, checkout.
    //
    // Until now this was omitted entirely and only the four per-variant
    // images were sent, so every mockup the pipeline rendered was discarded
    // at the last step.
    const gallery = await stageGallery(job, subject);

    const variants = sizes.map((size) => {
      const file = staged.find((s) => s?.sizeId === size.id)?.file;
      const price = prices[size.id];
      return {
        optionValues: [{ optionName: "Size", name: size.label }],
        price,
        compareAtPrice: validCompareAt(compareAt[size.id], price),
        // No product in the catalogue had a SKU. For print-to-order this is
        // the field that tells whoever is printing exactly what to print
        // straight off the order line, without opening the product.
        inventoryItem: {
          sku: skuFor({
            category,
            subject,
            sequence,
            sizeId: size.id,
            split: job.kind === "split3",
          }),
        },
        // Print-on-demand never goes out of stock, so selling must not be
        // blocked by an inventory count nobody is maintaining.
        inventoryPolicy: "CONTINUE",
        ...(file ? { file } : {}),
      };
    });

    // Every file referenced by a variant must ALSO appear in the product's
    // top-level `files`. Shopify rejects the mutation otherwise, with
    // "File original source missing from the product files input" — the
    // variant `file` field attaches an image to a variant, it does not add
    // that image to the product.
    //
    // Gallery images come FIRST so images[0] — which Shopify uses as the
    // product thumbnail — is a mockup rather than a bare A5 scan. The
    // per-variant files follow, deduplicated by source: a file referenced
    // twice makes Shopify reject the whole mutation.
    const seen = new Set<string>();
    const files = [
      ...gallery,
      ...staged
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map((entry) => entry.file),
    ]
      .filter((file) => {
        if (seen.has(file.originalSource)) return false;
        seen.add(file.originalSource);
        return true;
      })
      .map((file) => ({ ...file, contentType: "IMAGE" as const }));

    const data = await admin<{
      productSet: {
        product: {
          id: string;
          handle: string;
          media: { nodes: { id: string; alt: string | null }[] };
          variants: {
            nodes: {
              id: string;
              selectedOptions: { name: string; value: string }[];
            }[];
          };
        } | null;
        userErrors: { field: string[] | null; message: string; code?: string }[];
      };
    }>(PRODUCT_SET, {
      synchronous: true,
      input: {
        // An existing id makes this an update rather than a create, which is
        // what keeps a retry from producing a second product.
        ...(productId ? { id: productId } : {}),
        title,
        descriptionHtml: descriptionFor(
          subject,
          stripOfficial(job.metadata?.description ?? ""),
          options.descriptionTemplate,
        ),
        vendor: "Litwalls",
        status: options.status ?? "ACTIVE",
        // Every structural tag is guaranteed here rather than trusted to the
        // model or the human: this store's collections are smart collections
        // keyed on tags, so a missing tag means a product that is live and
        // appears nowhere. That now covers EVERY collection the poster is
        // filed into, not just the main one, plus the orientation and format
        // tags a shopper filters on.
        tags: withRequiredTags(
          job.metadata?.tags ?? [],
          requiredTagsFor({
            categories,
            orientation: productOrientation(job),
            kind: job.kind,
          }),
        ),
        // Every hand-made product in the catalogue carries an SEO description
        // and Studio was publishing none — making its products strictly worse
        // in search than the ones done by hand. The title is written rather
        // than defaulted: Shopify would otherwise use "Spider Man #06 | Marvel
        // Posters", where the "#06" is meaningless to a shopper.
        seo: {
          title: seoTitleFor({ subject, category }),
          description: seoDescriptionFor(subject, job.kind),
        },
        productOptions: [
          {
            name: "Size",
            values: sizes.map((size) => ({ name: size.label })),
          },
        ],
        files,
        variants,
      },
    });

    const { product, userErrors } = data.productSet;
    if (userErrors.length) {
      return err(
        userErrors
          .map((e) => `${e.field?.join(".") ?? "product"}: ${e.message}`)
          .join("; "),
      );
    }
    if (!product) return err("Shopify returned no product");

    const variantIds: Partial<Record<SizeId, string>> = {};
    for (const node of product.variants.nodes) {
      const value = node.selectedOptions.find((o) => o.name === "Size")?.value;
      const match = SIZES.find((size) => size.label === value);
      if (match) variantIds[match.id] = node.id;
    }

    const mediaIds: Record<string, string> = {};
    for (const node of product.media.nodes) {
      if (node.alt) mediaIds[node.alt] = node.id;
    }

    // Smart collections are joined by the tags above; a manual one needs an
    // explicit add, which is why this exists at all.
    await joinManualCollections(product.id, categories);

    // Channel publication is best-effort: the product exists either way, and
    // failing the whole publish over something fixable with one click in the
    // admin would be the wrong trade. A DRAFT product stays invisible
    // regardless, so this is safe to run for both statuses.
    const channels = await publicationIds();
    if (channels.length > 0) {
      try {
        await admin(PUBLISHABLE_PUBLISH, {
          id: product.id,
          input: channels.map((publicationId) => ({ publicationId })),
        });
      } catch (cause) {
        console.warn(
          `publish: product created but not published to its sales channels: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    } else {
      console.warn(
        "publish: no sales channels found — the product will not appear on the storefront.",
      );
    }

    // The deleted product's registry entry would otherwise sit beside the new
    // one, listing a product that no longer exists and still matching
    // duplicate checks against it.
    if (deletedProductId && deletedProductId !== product.id) {
      await forgetPublished(deletedProductId).catch(() => undefined);
    }

    // Recorded OUTSIDE the batch, so duplicate detection still recognises this
    // artwork after the batch is deleted — which is exactly when the record
    // starts being worth having. Best-effort: the product is live either way,
    // and losing a registry entry must not report the publish as failed.
    await recordPublished({
      fingerprint: job.probe?.fingerprint ?? "",
      productId: product.id,
      handle: product.handle,
      title,
      subject,
      categoryId: category.id,
      categoryLabel: category.label,
      status: options.status ?? "ACTIVE",
      publishedAt: Date.now(),
      batchId: job.batchId,
      jobId: job.id,
      sourceName: job.sourceName,
    }).catch((cause) => {
      console.warn(
        `publish: could not record "${title}" in the registry: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    });

    return ok({
      productId: product.id,
      handle: product.handle,
      variantIds,
      mediaIds,
      sequence,
      publishedAt: Date.now(),
    });
  } catch (cause) {
    return err(
      `Publish failed for "${title}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}
