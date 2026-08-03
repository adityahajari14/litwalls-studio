/**
 * What Studio will accept as source artwork.
 *
 * Shared by the browser (to reject a bad file before it wastes an upload) and
 * the server (which cannot trust the browser). Pure, no imports, so both sides
 * genuinely run the same rules rather than two implementations that agree
 * until one is edited.
 */

/**
 * Deliberately wider than the storefront's customer-facing allowlist.
 *
 * Customers upload phone photos; here the source is our own artwork, which
 * arrives as whatever the designer exported — often TIFF from print work, and
 * occasionally AVIF from a stock library. sharp decodes all of these, and the
 * pipeline re-encodes everything to JPEG anyway, so accepting them costs
 * nothing and refusing them means a manual conversion step before every batch.
 */
export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "image/avif",
] as const;

export const ACCEPTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".avif",
] as const;

/**
 * 200MB. Generous on purpose: a 13x19 at 300dpi in 16-bit TIFF is comfortably
 * 80MB, and the whole point of a local tool is that there is no upload cost to
 * economise against. The limit exists to catch a wrong-file mistake — someone
 * dragging in a video — not to ration disk.
 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 100) return `${Math.round(mb)}MB`;
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

export function isAcceptedType(file: {
  type?: string;
  name: string;
}): boolean {
  // Extension is checked as well as MIME because browsers report an empty
  // type for TIFF often enough to matter, and a file that sharp can decode
  // should not be refused over a missing header.
  const byMime =
    !!file.type &&
    (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type);
  const byExtension = (ACCEPTED_EXTENSIONS as readonly string[]).includes(
    extensionOf(file.name),
  );
  return byMime || byExtension;
}

export type FileProblem = { message: string };

/** Metadata-only checks. No decoding — that happens in the probe stage. */
export function checkFile(file: {
  name: string;
  type?: string;
  size: number;
}): FileProblem | null {
  if (!isAcceptedType(file)) {
    return {
      message: `${file.name}: unsupported file type. Use JPG, PNG, WebP, TIFF or AVIF.`,
    };
  }
  if (file.size === 0) {
    return { message: `${file.name}: file is empty.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      message: `${file.name}: ${formatBytes(file.size)} exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`,
    };
  }
  return null;
}

/**
 * Make a filename safe to write to disk while keeping it recognisable.
 *
 * The original name is preserved separately on the job for display and for the
 * Drive copy; this is only what lands on the local filesystem. Windows
 * reserved device names are handled because "CON.jpg" is a real filename that
 * cannot be created, and the failure it produces is baffling.
 */
export function safeFilename(name: string): string {
  const extension = extensionOf(name) || ".bin";
  const stem = name
    .slice(0, name.length - extension.length)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);

  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const safeStem = !stem || reserved.test(stem) ? "artwork" : stem;

  return `${safeStem}${extension}`;
}
