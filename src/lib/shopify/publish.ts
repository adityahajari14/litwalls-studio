import "server-only";

import { readFile } from "node:fs/promises";

import { jobAsset } from "@/lib/pipeline/paths";
import { descriptionFor } from "@/lib/print/description";
import { resolvePriceTable, validCompareAt } from "@/lib/print/pricing";
import { SIZES } from "@/lib/print/sizes";
import { ensureCategoryTag, formatTitle } from "@/lib/print/title";
import type {
  Batch,
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
 * The publication id for the headless storefront.
 *
 * THE most likely "I published it and the site doesn't show it" bug: a product
 * with status ACTIVE is live on the Online Store, but a headless storefront
 * reads through its own sales channel publication. Without publishing to that
 * channel the product is invisible to getProduct() despite looking published
 * in the admin.
 */
async function headlessPublicationId(): Promise<string | null> {
  const configured = process.env.SHOPIFY_PUBLICATION_ID?.trim();
  if (configured) return configured;

  try {
    const data = await admin<{
      publications: { nodes: { id: string; name: string }[] };
    }>(PUBLICATIONS);

    const nodes = data.publications.nodes;
    const preferred =
      nodes.find((n) => /headless/i.test(n.name)) ??
      nodes.find((n) => /storefront/i.test(n.name)) ??
      nodes.find((n) => /online store/i.test(n.name));
    return preferred?.id ?? null;
  } catch {
    return null;
  }
}

export async function publishJob(options: {
  job: PosterJob;
  batch: Batch;
  settingsPrices: Partial<Record<SizeId, string>>;
  settingsCompareAt: Partial<Record<SizeId, string>>;
  numberer: Numberer;
  /** DRAFT keeps it out of the storefront until variants are supported. */
  status?: "ACTIVE" | "DRAFT";
}): Promise<Result<ShopifyRefs>> {
  const { job, batch, numberer } = options;

  const subject = job.metadata?.subject?.trim();
  if (!subject) return err("Set a subject before publishing.");
  if (job.assets.length === 0) return err("This poster has not been rendered.");

  // Claimed here, moments before the mutation, against a catalogue snapshot
  // taken for this run — not at analyze time, when a number could since have
  // been taken by another publish.
  const sequence = job.metadata?.sequence ?? numberer.claim(subject);
  const title = formatTitle(
    { subject, sequence, subtitle: job.metadata?.subtitle },
    batch.category,
  );

  const prices = resolvePriceTable({
    job: job.priceOverrides,
    batch: batch.prices,
    settings: options.settingsPrices,
  });
  const compareAt = resolvePriceTable({
    job: job.compareAtOverrides,
    batch: batch.compareAt,
    settings: options.settingsCompareAt,
  });

  try {
    // Staged in parallel: four independent uploads that do not depend on each
    // other, and doing them in sequence quadruples the wait for no benefit.
    const staged = await Promise.all(
      SIZES.map(async (size) => {
        const asset = mediaFor(job, size.id);
        if (!asset) return null;
        const alt = job.metadata?.altText || `${subject} — ${size.label}`;
        return {
          sizeId: size.id,
          file: await stageImage(job, asset.relPath, `${alt} (${size.label})`),
        };
      }),
    );

    const variants = SIZES.map((size) => {
      const file = staged.find((s) => s?.sizeId === size.id)?.file;
      const price = prices[size.id];
      return {
        optionValues: [{ optionName: "Size", name: size.label }],
        price,
        compareAtPrice: validCompareAt(compareAt[size.id], price),
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
    const files = staged
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => ({ ...entry.file, contentType: "IMAGE" as const }));

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
        ...(job.shopify?.productId ? { id: job.shopify.productId } : {}),
        title,
        descriptionHtml: descriptionFor(job.kind),
        vendor: "Litwalls",
        status: options.status ?? "ACTIVE",
        // The collection tag is guaranteed here rather than trusted: all four
        // collections are smart collections keyed on tags, so a missing tag
        // means a product that is live but appears nowhere.
        tags: ensureCategoryTag(job.metadata?.tags ?? [], batch.category),
        productOptions: [
          {
            name: "Size",
            values: SIZES.map((size) => ({ name: size.label })),
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

    // Publishing to the sales channel is best-effort: the product exists
    // either way, and failing the whole publish over a channel that can be
    // fixed with one click in the admin would be the wrong trade.
    const publicationId = await headlessPublicationId();
    if (publicationId) {
      try {
        await admin(PUBLISHABLE_PUBLISH, {
          id: product.id,
          input: [{ publicationId }],
        });
      } catch (cause) {
        console.warn(
          `publish: product created but not published to the channel: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    }

    return ok({
      productId: product.id,
      handle: product.handle,
      variantIds,
      mediaIds,
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
