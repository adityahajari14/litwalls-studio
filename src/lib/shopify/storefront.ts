import "server-only";

import { storefrontConfig } from "@/lib/shopify/env";

/**
 * Read-only Storefront API client.
 *
 * Used only to list existing product titles when working out the next free
 * sequence number. The Admin API could answer the same question, but this
 * token is public-scope and cannot write, so a mistake in the numbering code
 * has no blast radius at all.
 */

export class ShopifyError extends Error {
  // Declared explicitly rather than as a constructor parameter property:
  // Node's strip-only TypeScript mode (used by `node --test`) rejects those,
  // and this module is reachable from the test suite.
  readonly detail?: unknown;
  /**
   * Whether sending the identical request again could plausibly succeed.
   *
   * Throttling and 5xx are worth another go; a rejected mutation will be
   * rejected the same way every time, so retrying it only wastes time and
   * delays a real error reaching the user.
   */
  readonly retryable: boolean;

  constructor(message: string, detail?: unknown, retryable = false) {
    super(message);
    this.name = "ShopifyError";
    this.detail = detail;
    this.retryable = retryable;
  }
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

export async function storefront<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const { endpoint, accessToken } = storefrontConfig();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    // Numbering must see the catalogue as it is right now. A cached response
    // would hand two posters the same number.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ShopifyError(
      `Storefront API returned ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as GraphQLResponse<T>;

  // Shopify answers 200 with an `errors` array rather than an HTTP error
  // status, so the body is the only reliable place to look.
  if (body.errors?.length) {
    throw new ShopifyError(
      body.errors.map((error) => error.message).join("; "),
      body.errors,
    );
  }

  if (!body.data) {
    throw new ShopifyError("Storefront API returned no data");
  }

  return body.data;
}
