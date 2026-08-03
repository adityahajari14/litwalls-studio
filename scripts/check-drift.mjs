/**
 * Fail loudly when Studio's mirrored constants disagree with the storefront's.
 *
 * WHY THIS EXISTS
 *
 * Studio is a separate project, so it cannot import from the litwalls repo.
 * Two values nonetheless have to agree, or the two apps make contradictory
 * promises about the same artwork:
 *
 *   • The print size table and its ~250dpi floor. That floor is a promise the
 *     storefront already makes to customers on the custom-poster page. If
 *     Studio's were laxer it would publish a poster the storefront would have
 *     refused to sell — the same file judged acceptable or not depending on
 *     which door it came through.
 *
 *   • The Shopify Admin API version. Different pins mean the two apps see
 *     different response shapes from the same store, which surfaces as a
 *     baffling parse error in whichever one was updated second.
 *
 * A shared npm package for two apps one person runs is ceremony. Silent
 * copy-paste is how drift happens. This is the middle path: copy the values,
 * say so in a comment, and let a script catch the day they diverge.
 *
 * Runs before `next dev`. If the storefront is not checked out beside this
 * project, it warns and passes — Studio still has to work standalone.
 *
 *   node scripts/check-drift.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("..", import.meta.url);
const STOREFRONT = new URL("../litwalls/", ROOT);

/** Where the canonical values live, and how to pull them back out. */
const MIRRORS = [
  {
    what: "print sizes",
    theirs: new URL("src/lib/custom-poster.ts", STOREFRONT),
    ours: new URL("src/lib/print/sizes.ts", ROOT),
    /**
     * Extract `{ id, minWidth, minHeight }` for each size.
     *
     * Regex rather than a parser on purpose: this must run before `next dev`
     * with no build step and no dependency, and the shape it reads is a
     * hand-maintained literal that has been stable for the life of both files.
     * If it ever stops matching, `extract` returns nothing and the check fails
     * loudly rather than passing by accident — see the empty-result guard.
     */
    extract(source) {
      const found = [];
      const re =
        /\{\s*id:\s*"([^"]+)"[^}]*?minWidth:\s*(\d+),\s*minHeight:\s*(\d+)/g;
      let match;
      while ((match = re.exec(source))) {
        found.push(`${match[1]}=${match[2]}x${match[3]}`);
      }
      return found;
    },
    /**
     * Studio adds 13x19, which the storefront deliberately does not offer.
     * Only the shared rows are compared.
     */
    only: ["A5", "A4", "A3"],
  },
  {
    what: "Admin API version",
    theirs: new URL("src/lib/shopify/env.ts", STOREFRONT),
    ours: new URL("src/lib/shopify/env.ts", ROOT),
    extract(source) {
      const match = source.match(/ADMIN_API_VERSION\s*=\s*"([^"]+)"/);
      return match ? [`ADMIN_API_VERSION=${match[1]}`] : [];
    },
  },
];

function keep(values, only) {
  if (!only) return values;
  return values.filter((value) => only.some((id) => value.startsWith(`${id}=`)));
}

if (!existsSync(fileURLToPath(STOREFRONT))) {
  console.warn(
    `drift: storefront not found at ${fileURLToPath(STOREFRONT)} — skipping.\n` +
      "        Mirrored constants are UNVERIFIED in this checkout.",
  );
  process.exit(0);
}

const problems = [];

for (const mirror of MIRRORS) {
  const theirsPath = fileURLToPath(mirror.theirs);
  const oursPath = fileURLToPath(mirror.ours);

  if (!existsSync(oursPath)) {
    // Expected while a phase is still being built; not a drift failure.
    continue;
  }
  if (!existsSync(theirsPath)) {
    problems.push(`${mirror.what}: storefront file missing (${theirsPath})`);
    continue;
  }

  const theirs = keep(
    mirror.extract(readFileSync(theirsPath, "utf8")),
    mirror.only,
  );
  const ours = keep(mirror.extract(readFileSync(oursPath, "utf8")), mirror.only);

  // An empty extraction means the regex stopped matching — a silent pass here
  // would defeat the entire point of the check.
  if (theirs.length === 0) {
    problems.push(
      `${mirror.what}: found nothing in ${theirsPath}. ` +
        "The source shape changed; update the extractor in check-drift.mjs.",
    );
    continue;
  }
  if (ours.length === 0) {
    problems.push(
      `${mirror.what}: found nothing in ${oursPath}. ` +
        "The mirrored values are missing or reformatted.",
    );
    continue;
  }

  const a = theirs.join(", ");
  const b = ours.join(", ");
  if (a !== b) {
    problems.push(
      `${mirror.what} DRIFTED\n` +
        `    storefront: ${a}\n` +
        `    studio:     ${b}\n` +
        `    Change the storefront first, then mirror it here.`,
    );
  }
}

if (problems.length > 0) {
  console.error("\n  Mirrored constants disagree with the storefront:\n");
  for (const problem of problems) console.error(`  • ${problem}\n`);
  process.exit(1);
}

console.log("drift: mirrored constants match the storefront.");
