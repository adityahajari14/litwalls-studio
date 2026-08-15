import { SIZES } from "@/lib/print/sizes";
import type { Category, SizeId } from "@/lib/print/types";

/**
 * Product identity fields: SKU and SEO.
 *
 * Pure, so the review screen can preview exactly what will be published.
 *
 * Both were missing entirely. Every product in the catalogue carries an SEO
 * description and none carries a SKU, so Studio was publishing products
 * strictly worse than the hand-made ones on one axis and no better on the
 * other.
 */

/** Short codes, because a SKU is read aloud and typed by hand. */
const SIZE_CODE: Record<SizeId, string> = {
  A5: "A5",
  A4: "A4",
  A3: "A3",
  "13x19": "SB", // Super B — "13X19" reads as three tokens on a picking list
};

/**
 * A stable, human-readable SKU.
 *
 * `LW-MARVEL-SPIDERMAN06-A3`. The point is that an order line tells whoever is
 * printing exactly what to print without opening the product: brand,
 * collection, subject, number, size.
 *
 * Uppercase and hyphen-separated because SKUs get typed, scanned and pasted
 * into spreadsheets, where case and spaces cause trouble.
 */
export function skuFor(input: {
  category: Pick<Category, "id">;
  subject: string;
  sequence: number;
  sizeId: SizeId;
  split?: boolean;
}): string {
  const collection = code(input.category.id, 8);
  const subject = code(input.subject, 14);
  const number = String(input.sequence).padStart(2, "0");
  const parts = [
    "LW",
    collection,
    `${subject}${number}`,
    SIZE_CODE[input.sizeId],
  ];
  // A three-panel set is a different physical product from a single sheet at
  // the same nominal size, and the picking list has to say so.
  if (input.split) parts.push("SET3");
  return parts.join("-");
}

function code(value: string, max: number): string {
  return (
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, max) || "X"
  );
}

/**
 * The SEO description.
 *
 * Every existing product carries a single identical template — verified across
 * 60 products — so this is a shared string rather than something to generate.
 * The live copy hardcodes `13" x 19"` as the only size, which stops being true
 * the moment four sizes ship, so the size clause is built from the size table.
 *
 * Kept under ~160 characters where possible: Google truncates beyond that, and
 * a description cut mid-sentence in the SERP looks careless.
 */
export function seoDescriptionFor(subject: string): string {
  const sizes = SIZES.map((s) => s.label).join(", ");
  return (
    `${subject} poster from Litwalls — available in ${sizes}. ` +
    `300 GSM glossy, fade-resistant inks, elegant white border. Free shipping over ₹499.`
  );
}

/**
 * The SEO title.
 *
 * No existing product sets one, so Shopify falls back to the product title —
 * which for this catalogue is `Spider Man #06 | Marvel Posters`. That reads as
 * an internal SKU in a search result: the `#06` is meaningless to a shopper
 * and the pipe is noise. A purpose-written title drops the number and says
 * what the thing actually is.
 *
 * Capped at 60 characters, which is roughly where Google truncates.
 */
export function seoTitleFor(input: {
  subject: string;
  category: Pick<Category, "label">;
}): string {
  const full = `${input.subject} Poster | ${input.category.label} Wall Art | Litwalls`;
  if (full.length <= 60) return full;

  const shorter = `${input.subject} Poster | ${input.category.label} | Litwalls`;
  if (shorter.length <= 60) return shorter;

  return `${input.subject} Poster | Litwalls`.slice(0, 60);
}
