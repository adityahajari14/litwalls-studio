import "server-only";

import { ensureFolderPath, uploadFile } from "@/lib/drive/files";
import { jobAsset } from "@/lib/pipeline/paths";
import { readBatch, updateJob } from "@/lib/pipeline/store";
import { CATEGORY_LABEL, formatTitle } from "@/lib/print/title";
import { err, ok, type Result } from "@/lib/result";
import type { DriveRefs, PosterJob } from "@/lib/print/types";

/**
 * File a poster's print-ready artwork to Google Drive.
 *
 * One folder per poster: Litwalls Posters/<Category>/<Product Name>/ holding
 * every size (or every panel, for a split) plus the original. That layout
 * means "find the print files for this product" is one navigation rather than
 * a search across size folders.
 */

/** Windows and Drive both dislike these; a folder named with them is a mess. */
function safeFolderName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Untitled"
  );
}

function mimeFor(relPath: string): string {
  const extension = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".avif": "image/avif",
  };
  return types[extension] ?? "application/octet-stream";
}

/**
 * Upload everything this poster needs filing, skipping what is already there.
 *
 * Each file id is written back to job.json IMMEDIATELY on success rather than
 * batched at the end, so a crash or a lost connection loses at most one file's
 * worth of work instead of the whole poster's.
 */
export async function uploadToDrive(job: PosterJob): Promise<Result<DriveRefs>> {
  const batch = await readBatch(job.batchId);
  if (!batch) return err(`Batch not found for job ${job.id}`);

  if (job.assets.length === 0) {
    return err("Nothing to upload — this poster has not been rendered yet.");
  }

  const subject = job.metadata?.subject?.trim();
  if (!subject) {
    return err("Set a subject before filing to Drive — it names the folder.");
  }

  // The folder is named for the product so it can be found from a Shopify
  // order. The sequence is a placeholder until publish assigns the real one.
  const folderName = safeFolderName(
    formatTitle(
      {
        subject,
        sequence: job.metadata?.sequence ?? 1,
        subtitle: job.metadata?.subtitle,
      },
      batch.category,
    ).replace(/\s*\|.*$/, ""),
  );

  const folder = await ensureFolderPath([
    CATEGORY_LABEL[batch.category],
    folderName,
  ]);
  if (!folder.ok) return folder;

  const existing: DriveRefs = job.drive ?? { folderId: folder.value, files: {} };
  // A changed folder id means the poster was renamed; the old uploads no
  // longer apply, so start the file map again rather than mixing locations.
  const files =
    existing.folderId === folder.value ? { ...existing.files } : {};

  const targets = [
    { relPath: job.sourceRelPath, name: `original${extensionOf(job.sourceRelPath)}` },
    ...job.assets.map((asset) => ({
      relPath: asset.relPath,
      name: asset.relPath.split("/").pop() ?? asset.relPath,
    })),
  ];

  for (const target of targets) {
    if (files[target.relPath]) continue; // already uploaded

    const result = await uploadFile({
      localPath: jobAsset(job.batchId, job.id, target.relPath),
      name: target.name,
      parentId: folder.value,
      mimeType: mimeFor(target.relPath),
    });

    if (!result.ok) {
      // Persist what did land before giving up, so a retry resumes rather
      // than starting from nothing.
      await updateJob(job.batchId, job.id, (current) => ({
        ...current,
        drive: { folderId: folder.value, files },
      }));
      return result;
    }

    files[target.relPath] = result.value;
    await updateJob(job.batchId, job.id, (current) => ({
      ...current,
      drive: { folderId: folder.value, files },
    }));
  }

  return ok({ folderId: folder.value, files });
}

function extensionOf(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  return dot === -1 ? "" : relPath.slice(dot);
}
