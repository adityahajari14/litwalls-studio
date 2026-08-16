import type { PosterKind } from "@/lib/print/types";

/**
 * The product description, shared verbatim by every poster.
 *
 * This is a static template rather than generated copy, because that is what
 * the store already does: all 154 live products carry byte-identical
 * description HTML. There is no per-product prose to write, which is why the
 * model is never asked for one.
 *
 * Editing this constant changes the description of every product published
 * from here on. That is the intended workflow, and the reason it is a plain
 * string and not something clever.
 *
 * TWO DELIBERATE CHANGES from the live copy:
 *
 * 1. The size section said "Currently available in 13\" x 19\" … More sizes
 *    coming soon". Studio publishes four sizes, so that text would contradict
 *    the size selector on its own product page. Rewritten to list all four.
 *
 * 2. Dropped the `data-start` / `data-end` attributes littered through the
 *    original. They are artifacts of a paste into Shopify's rich-text editor —
 *    they carry no meaning, one of them decorates an empty <strong>, and they
 *    make the template unreadable. Nothing visible changes.
 *
 * The three cdn.shopify.com infographic images are kept as-is. They are
 * already uploaded to the store's Files and shared across every product.
 */

const INTRO = `<h3 style="text-align: left;">Discover Premium Posters</h3>
<p style="text-align: left;">Transform your walls with <strong>premium posters</strong>, designed to combine stunning aesthetics with lasting quality.</p>
<p style="text-align: left;"> </p>
<h3 style="text-align: left;">Key Features</h3>
<p> </p>
<h5 style="text-align: left;"><strong>✔ Premium Print Quality</strong></h5>
<p style="text-align: left;">Crafted using <strong>high-definition printing</strong> on <strong>300 GSM glossy paper</strong>, ensuring sharp details, rich colors, and a smooth, professional finish. Each poster is made to make your wall stand out.</p>
<p style="text-align: left;"> </p>`;

/** The size block for a single-sheet poster. */
const SIZES_NORMAL = `<h5 style="text-align: left;"><strong>✔ Perfect Size for Every Space</strong></h5>
<p><img height="400" width="400" alt="" src="https://cdn.shopify.com/s/files/1/0684/9826/0142/files/Product_description_02.webp?v=1756202904"></p>
<p style="text-align: left;">Available in <strong>A5, A4, A3</strong> and <strong>13” x 19”</strong> — sizes to suit bedrooms, living rooms, offices, and gaming setups.<br><em>Pick the size that fits your wall from the dropdown above.</em></p>
<p style="text-align: left;"> </p>`;

/**
 * The size block for a three-panel set.
 *
 * Says plainly that one purchase is three sheets. A customer who expects one
 * poster and receives three panels has been mis-sold even though they got more
 * paper, so this is the one place the split format must be unambiguous.
 */
const SIZES_SPLIT = `<h5 style="text-align: left;"><strong>✔ A Three-Panel Set</strong></h5>
<p><img height="400" width="400" alt="" src="https://cdn.shopify.com/s/files/1/0684/9826/0142/files/Product_description_02.webp?v=1756202904"></p>
<p style="text-align: left;">This design is printed as a <strong>set of three panels</strong> that sit side by side to form one image. <strong>Every order includes all three panels.</strong></p>
<p style="text-align: left;">Choose <strong>A4, A3</strong> or <strong>13” x 19”</strong> above — the size you pick is the size of <em>each</em> panel, so the finished piece is three panels wide.</p>
<p style="text-align: left;"> </p>`;

const OUTRO = `<h5 style="text-align: left;"><strong>✔ Elegant White Border</strong></h5>
<p><img height="400" width="400" alt="" src="https://cdn.shopify.com/s/files/1/0684/9826/0142/files/Product_description_03.webp?v=1756202906"></p>
<p style="text-align: left;">Each poster includes a <strong>subtle 0.5mm white border</strong> for a premium, gallery-like look. This border enhances the visual appeal, provides a natural framing effect, and makes your poster pop without the need for an actual frame.</p>
<p style="text-align: left;"> </p>
<h5 style="text-align: left;"><strong>✔ Built to Last</strong></h5>
<p><img height="400" width="400" alt="" src="https://cdn.shopify.com/s/files/1/0684/9826/0142/files/description_image_01.webp?v=1756202904"></p>
<p style="text-align: left;">Made with <strong>300 GSM thickness</strong> and <strong>fade-resistant inks</strong>, ensuring durability and long-lasting vibrancy.</p>`;

/**
 * The full description HTML for a poster of the given kind.
 *
 * Two variants, assembled from three constants. No templating engine and no
 * interpolation — a template literal is the whole implementation, and adding
 * anything more would be building a CMS for a two-branch decision.
 */
export function descriptionFor(kind: PosterKind): string {
  const sizes = kind === "split3" ? SIZES_SPLIT : SIZES_NORMAL;
  return [INTRO, sizes, OUTRO].join("\n");
}
