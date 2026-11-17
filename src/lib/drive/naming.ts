import { formatTitle } from "@/lib/print/title";

/**
 * Names and links for a poster's Drive folder. Pure, so it can be tested and
 * used from the review screen as well as the uploader.
 */

/** The browser link to a Drive folder — what goes on the Shopify product. */
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

/** Windows and Drive both dislike these; a folder named with them is a mess. */
export function safeFolderName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Untitled"
  );
}

/**
 * The folder name for one poster: the product title without its collection
 * suffix, "Spider Man #06 - Into the Verse", so it can be found from an order.
 *
 * With no number yet (filed before publishing), the name says so and carries
 * a piece of the job id instead of a made-up "#01". A guessed number is how
 * every unpublished poster of one subject used to share a single "#01"
 * folder; the folder is renamed to the real number when the poster is
 * published and filed again.
 */
export function posterFolderName(parts: {
  subject: string;
  subtitle?: string | null;
  sequence: number | null | undefined;
  jobId: string;
}): string {
  if (parts.sequence) {
    return safeFolderName(
      formatTitle(
        { subject: parts.subject, sequence: parts.sequence, subtitle: parts.subtitle },
        { suffix: "" },
      ).replace(/\s*\|.*$/, ""),
    );
  }
  const subtitle = parts.subtitle?.trim();
  const head = subtitle ? `${parts.subject.trim()} - ${subtitle}` : parts.subject.trim();
  return safeFolderName(`${head} (unpublished ${parts.jobId.slice(0, 8)})`);
}
