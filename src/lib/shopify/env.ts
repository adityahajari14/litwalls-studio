import "server-only";

/**
 * Credentials and endpoints for the Shopify APIs Studio talks to.
 *
 * Server-only. The Admin token grants write access to the entire store — it
 * must never reach a browser, and `server-only` turns a mistaken client import
 * into a build error rather than a live leak.
 */

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local — see README.md for how to set it up.`,
    );
  }
  return value;
}

/**
 * MIRRORED — must match ADMIN_API_VERSION in litwalls/src/lib/shopify/env.ts.
 * Two apps on different pins see different response shapes from the same
 * store. `npm run check:drift` fails if these diverge.
 */
export const ADMIN_API_VERSION = "2025-01";
export const STOREFRONT_API_VERSION = "2025-01";

function storeOrigin() {
  const store = required("SHOPIFY_STORE_DOMAIN");
  const origin = /^https?:\/\//.test(store) ? store : `https://${store}`;
  return origin.replace(/\/$/, "");
}

/**
 * The Admin API — used to create products, mint upload targets for product
 * media, and read existing titles when numbering.
 *
 * This token is NOT the storefront's. It needs `write_products` and
 * `read_products` in addition to `write_files`, and adding those scopes forces
 * Shopify to issue a new token which invalidates the old one. When that
 * happens, litwalls/.env.local must be updated in the same sitting or the
 * storefront's custom-poster upload silently breaks.
 */
export function adminConfig() {
  return {
    endpoint: `${storeOrigin()}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
    accessToken: required("SHOPIFY_ADMIN_ACCESS_TOKEN"),
  };
}

/**
 * The Storefront API — read-only, used to list existing product titles when
 * working out the next free sequence number.
 *
 * The Admin API could answer the same question, but this token is public-scope
 * and cannot write, so using it here keeps the blast radius of a mistake in
 * the numbering code to zero.
 */
export function storefrontConfig() {
  return {
    endpoint: `${storeOrigin()}/api/${STOREFRONT_API_VERSION}/graphql.json`,
    accessToken: required("SHOPIFY_STOREFRONT_ACCESS_TOKEN"),
  };
}
