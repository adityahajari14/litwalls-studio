/**
 * Check that every Shopify product links to its print files on Google Drive.
 *
 *   npm run check:drive-links            report; fails if a Studio product has no link
 *   npm run check:drive-links -- --strict  also fail on products Studio never made
 *
 * For every product in the store it reads the `custom.drive_folder` metafield
 * and sorts the product into one of:
 *
 *   ok            linked, and (if Studio made it) to the poster's current folder
 *   missing       made by Studio, but no link yet — "File missing to Drive" on
 *                 the dashboard fixes it
 *   stale         linked, but to a folder the poster has since moved out of
 *   dead          linked to a Drive folder that is gone or in the trash
 *   not-studio    no link, and no poster on this machine made it — added by
 *                 hand in Shopify, or its batch was deleted here, so Studio
 *                 has no print files to link to
 *
 * Read-only: changes nothing in Shopify, on Drive, or on disk. Reads
 * credentials from this project's .env.local and the Drive connection from
 * workspace/drive-token.json; with Drive not connected, the "dead" check is
 * skipped and says so.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const STRICT = process.argv.includes("--strict");
const NAMESPACE = "custom";
const KEY = "drive_folder";
const API_VERSION = "2025-01"; // must match ADMIN_API_VERSION in src/lib/shopify/env.ts

function readEnv(name, { optional = false } = {}) {
  const raw = readFileSync(new URL(".env.local", ROOT), "utf8");
  const value = raw.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim();
  if (!value && !optional) throw new Error(`Missing ${name} in .env.local`);
  return value || null;
}

// ─── Shopify ─────────────────────────────────────────────────────────────────

const domain = readEnv("SHOPIFY_STORE_DOMAIN");
const adminToken = readEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
const origin = (/^https?:\/\//.test(domain) ? domain : `https://${domain}`).replace(/\/$/, "");

async function admin(query, variables) {
  const response = await fetch(`${origin}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Shopify answered ${response.status} ${response.statusText}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

const PRODUCTS = `
  query Products($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        status
        metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value }
      }
    }
  }
`;

async function allProducts() {
  const products = [];
  let cursor = null;
  do {
    const data = await admin(PRODUCTS, { cursor });
    products.push(...data.products.nodes);
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return products;
}

// ─── Studio's own records ────────────────────────────────────────────────────

/** productId → the poster Studio published it from. */
function studioJobs() {
  const jobs = new Map();
  const batches = new URL("workspace/batches/", ROOT);
  if (!existsSync(batches)) return jobs;
  for (const batch of readdirSync(batches)) {
    const jobsDir = new URL(`${batch}/jobs/`, batches);
    if (!existsSync(jobsDir)) continue;
    for (const id of readdirSync(jobsDir)) {
      try {
        const job = JSON.parse(readFileSync(new URL(`${id}/job.json`, jobsDir), "utf8"));
        if (job.shopify?.productId) jobs.set(job.shopify.productId, job);
      } catch {
        // Not a job folder, or a half-written file — not this script's problem.
      }
    }
  }
  return jobs;
}

function folderIdOf(url) {
  return url?.match(/\/folders\/([^/?#]+)/)?.[1] ?? null;
}

// ─── Drive (optional) ────────────────────────────────────────────────────────

async function driveToken() {
  const file = new URL("workspace/drive-token.json", ROOT);
  if (!existsSync(file)) return null;
  const token = JSON.parse(readFileSync(file, "utf8"));
  if (!token.refreshToken) return null;
  if (token.accessToken && token.expiresAt - 60_000 > Date.now()) return token.accessToken;

  // Refreshed but NOT saved back: the running app owns that file.
  const clientId = readEnv("GOOGLE_OAUTH_CLIENT_ID", { optional: true });
  const clientSecret = readEnv("GOOGLE_OAUTH_CLIENT_SECRET", { optional: true });
  if (!clientId || !clientSecret) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return null;
  return (await response.json()).access_token ?? null;
}

/** Whether a Drive folder exists and is not in the trash. */
async function folderAlive(token, folderId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=trashed`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return false;
  if (!response.ok) return null; // could not tell
  return !(await response.json()).trashed;
}

// ─── Check ───────────────────────────────────────────────────────────────────

const [products, jobs, token] = await Promise.all([allProducts(), studioJobs(), driveToken()]);

const groups = { ok: [], missing: [], stale: [], dead: [], "not-studio": [] };
const linked = [];

for (const product of products) {
  const job = jobs.get(product.id);
  const url = product.metafield?.value ?? null;
  const folderId = folderIdOf(url);

  if (!folderId) {
    groups[job ? "missing" : "not-studio"].push(product);
    continue;
  }
  if (job?.drive?.folderId && job.drive.folderId !== folderId) {
    groups.stale.push(product);
    continue;
  }
  linked.push({ product, folderId });
}

if (token) {
  // A few at a time: hundreds of products, one request each.
  for (let i = 0; i < linked.length; i += 8) {
    const slice = linked.slice(i, i + 8);
    const alive = await Promise.all(slice.map((l) => folderAlive(token, l.folderId)));
    slice.forEach((l, j) => groups[alive[j] === false ? "dead" : "ok"].push(l.product));
  }
} else {
  groups.ok.push(...linked.map((l) => l.product));
}

const label = {
  missing: "Made by Studio, no Drive link yet — run \"File missing to Drive\" on the dashboard",
  stale: "Linked to an old folder — run \"File missing to Drive\" to update the link",
  dead: "Linked to a Drive folder that is gone or in the trash — re-file these posters",
  "not-studio":
    "No link, and not published from this Studio (made by hand, or its batch was deleted) — no print files to link",
};

console.log(`\n${products.length} products in Shopify · ${jobs.size} published from this Studio\n`);
console.log(`  ok           ${groups.ok.length}`);
for (const key of ["missing", "stale", "dead", "not-studio"]) {
  console.log(`  ${key.padEnd(12)} ${groups[key].length}`);
}
if (!token) console.log("\n  (Drive not connected — linked folders were not checked for existence)");

for (const key of ["missing", "stale", "dead", "not-studio"]) {
  if (groups[key].length === 0) continue;
  console.log(`\n${label[key]}:`);
  for (const p of groups[key]) {
    console.log(`  - ${p.title}${p.status !== "ACTIVE" ? ` [${p.status.toLowerCase()}]` : ""}`);
  }
}

const failing =
  groups.missing.length +
  groups.stale.length +
  groups.dead.length +
  (STRICT ? groups["not-studio"].length : 0);
console.log(failing ? `\n✖ ${failing} product(s) need attention.` : "\n✔ Every product checked has a working Drive link.");
process.exit(failing ? 1 : 0);
