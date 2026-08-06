import "server-only";

import { adminConfig } from "@/lib/shopify/env";
import { ShopifyError } from "@/lib/shopify/storefront";

/**
 * Admin API client.
 *
 * Written fresh rather than copied from the storefront's. That one is scoped
 * to `stagedUploadsCreate` with `resource: "FILE"`, deliberately, because
 * customer artwork must not surface as catalogue media — a constraint that is
 * exactly wrong here. This is a superset, not a fork, so there is no shared
 * surface to drift.
 */
/**
 * Retry transport failures and throttling, but never a rejected request.
 *
 * A dropped connection mid-publish is not hypothetical — it happened during
 * testing — and the cost is images staged with no product attached. A rejected
 * mutation, by contrast, fails identically however many times it is sent, so
 * retrying it only delays a real error reaching the user.
 */
export async function withRetry<T>(
  label: string,
  attempt: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let tries = 0; tries < 3; tries++) {
    if (tries > 0) await sleep(1000 * tries);
    try {
      return await attempt();
    } catch (cause) {
      lastError = cause;
      // A ShopifyError means Shopify answered and refused. Anything else is a
      // transport failure, which is exactly what a retry is for.
      if (cause instanceof ShopifyError && !cause.retryable) throw cause;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new ShopifyError(`${label} failed after 3 attempts: ${detail}`);
}

export async function admin<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const { endpoint, accessToken } = adminConfig();

  return withRetry("Admin API request", async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
      // Every response here either creates something or carries a single-use
      // expiring credential. Caching would be actively wrong.
      cache: "no-store",
    });

    if (!response.ok) {
      throw new ShopifyError(
        `Admin API returned ${response.status} ${response.statusText}`,
        undefined,
        // 429 is Shopify's throttle; 5xx is its problem rather than ours.
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };

    // Shopify answers 200 with an `errors` array rather than an HTTP error
    // status, so the body is the only reliable place to look.
    if (body.errors?.length) {
      const message = body.errors.map((error) => error.message).join("; ");
      throw new ShopifyError(message, body.errors, /throttl/i.test(message));
    }

    if (!body.data) throw new ShopifyError("Admin API returned no data");
    return body.data;
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
};

/**
 * Mint a pre-signed target for one product image.
 *
 * `resource: "IMAGE"` — this artwork IS catalogue media, unlike the
 * storefront's customer uploads which use "FILE" specifically so they never
 * appear as product photos.
 */
export async function createImageUpload(file: {
  filename: string;
  mimeType: string;
  fileSize: number;
}): Promise<StagedTarget> {
  const data = await admin<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(STAGED_UPLOADS_CREATE, {
    input: [
      {
        resource: "IMAGE",
        filename: file.filename,
        mimeType: file.mimeType,
        fileSize: String(file.fileSize),
        httpMethod: "POST",
      },
    ],
  });

  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  if (userErrors.length) {
    throw new ShopifyError(
      userErrors.map((error) => error.message).join("; "),
      userErrors,
    );
  }

  const target = stagedTargets[0];
  if (!target) throw new ShopifyError("Shopify returned no upload target");
  return target;
}

/**
 * Push bytes to a staged target.
 *
 * THE SIGNED PARAMETERS MUST BE APPENDED BEFORE THE FILE PART. Google Cloud
 * Storage, which backs these targets, parses the multipart body in order and
 * rejects the upload if the policy fields arrive after the content. This is
 * the single most easily broken step in the whole publish path.
 */
export async function uploadToStagedTarget(
  target: StagedTarget,
  bytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<void> {
  await withRetry(`Staged upload of ${filename}`, async () => {
    // Rebuilt each attempt: a FormData carrying a Blob cannot be replayed once
    // its stream has been consumed by a failed request.
    const form = new FormData();
    for (const parameter of target.parameters) {
      form.append(parameter.name, parameter.value);
    }
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      filename,
    );

    const response = await fetch(target.url, { method: "POST", body: form });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ShopifyError(
        `Staged upload failed: ${response.status} ${detail.slice(0, 200)}`,
        undefined,
        response.status >= 500,
      );
    }
  });
}
