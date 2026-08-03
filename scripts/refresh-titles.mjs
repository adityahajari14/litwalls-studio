/**
 * Re-snapshot the live product titles used by tests/title.test.ts.
 *
 * The title tests deliberately run against real catalogue data rather than
 * invented examples, because every interesting case — a duplicate #04, a
 * missing suffix, "AP" versus "Ap" — is something the store actually did.
 * Invented fixtures would be tidy and would prove nothing.
 *
 * Run this after a bulk edit in Shopify admin, then re-run the tests and read
 * any failure as a real question about the data, not a broken test.
 *
 *   node scripts/refresh-titles.mjs
 *
 * Reads Shopify credentials from this project's .env.local.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("tests/fixtures/live-titles.json", ROOT);

function readEnv(name) {
  const raw = readFileSync(new URL(".env.local", ROOT), "utf8");
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1].trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env.local`);
  }
  return value;
}

const domain = readEnv("SHOPIFY_STORE_DOMAIN");
const token = readEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN");
const origin = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;

const response = await fetch(
  `${origin.replace(/\/$/, "")}/api/2025-01/graphql.json`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query: "{products(first:250){nodes{title}}}" }),
  },
);

// Shopify answers 200 with an `errors` array rather than an HTTP error status,
// so the body is the only reliable place to look.
const body = await response.json();
if (body.errors?.length) {
  throw new Error(body.errors.map((e) => e.message).join("; "));
}

const titles = body.data.products.nodes.map((node) => node.title);
writeFileSync(OUT, `${JSON.stringify(titles, null, 2)}\n`);
console.log(`Saved ${titles.length} titles to ${fileURLToPath(OUT)}`);
