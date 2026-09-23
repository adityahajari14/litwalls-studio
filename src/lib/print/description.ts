/**
 * The product description: a short paragraph Gemini writes specific to the
 * poster, followed by the policy block every product shares.
 *
 * The paragraph is generated per poster (see `gemini/metadata.ts`, which asks
 * for it in the same call that identifies the subject) rather than filled
 * into a template here — that's what keeps five hundred products from
 * reading as one paragraph with a name swapped in. This file only owns the
 * policy block below it: border, mounting and colour facts are store policy,
 * not poster copy, so it's edited from Settings rather than written fresh
 * per product.
 */

/**
 * Shared, byte-identical across every product until someone edits it in
 * Settings. This is only the value a fresh install starts with.
 */
export const DEFAULT_DESCRIPTION_TEMPLATE = `<h3>Things to know before you buy</h3>
<ul>
<li><strong>Border:</strong> A standard poster ships with a clean white border framing the print.</li>
<li><strong>Split sets:</strong> A split set's panels are trimmed by hand and sold without a border, so a panel's size can vary slightly from the dimensions listed.</li>
<li><strong>Mounting:</strong> Posters ship unmounted — nothing sticky on the back. Put them up with double sided tape or glue dots, whichever you have.</li>
<li><strong>Tape:</strong> If you need some, double sided tape is sold separately in our store.</li>
<li><strong>Colour:</strong> Screens render colour differently, so the print in hand can read a touch different from the photo on screen.</li>
</ul>`;

/** Escape the handful of characters that would otherwise break the markup. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Used only when Gemini didn't write one — offline, unconfigured, or a
 * failed call. Plain and short on purpose: a human reviews every poster
 * before it publishes, so this just has to be honest, not persuasive.
 */
function fallbackIntro(subject: string): string {
  return `<p>High-definition wall poster of <strong>${escapeHtml(subject)}</strong>, printed on thick matte paper for a clean, ready-to-frame finish.</p>`;
}

/**
 * The full description HTML: the poster-specific paragraph, then the policy
 * block. `description` is what Gemini wrote for this poster (or a human's
 * edit of it) — empty falls back to a plain line built from `subject`.
 */
export function descriptionFor(
  subject: string,
  description: string,
  template: string,
): string {
  const intro = description.trim()
    ? `<p>${escapeHtml(description.trim())}</p>`
    : fallbackIntro(subject);
  return [intro, template].join("\n");
}
