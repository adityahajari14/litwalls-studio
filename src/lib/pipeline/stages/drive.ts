import "server-only";

import { rm } from "node:fs/promises";

import { ensureFolderPath, uploadFile } from "@/lib/drive/files";
import { renderLosslessPrintFile } from "@/lib/pipeline/stages/crop";
import { jobAsset } from "@/lib/pipeline/paths";
import { readBatch, updateJob } from "@/lib/pipeline/store";
import { mainCategoryFor } from "@/lib/print/categories";
import { formatTitle } from "@/lib/print/title";
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
/** Where a poster with no collection yet is filed on Drive. A real folder
 *  rather than the Drive root, so these are easy to find and re-file once
 *  someone picks a collection. */
const UNFILED_FOLDER = "Unfiled";

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

  // The MAIN collection, which on an auto batch is the one the model picked
  // for this poster rather than one the batch carries. It both names the
  // parent folder and supplies the title suffix that is then stripped back
  // off, so the two cannot drift onto different collections.
  const category = mainCategoryFor(job, batch);

  // The folder is named for the product so it can be found from a Shopify
  // order. The sequence is a placeholder until publish assigns the real one.
  const folderName = safeFolderName(
    formatTitle(
      {
        subject,
        sequence: job.metadata?.sequence ?? 1,
        subtitle: job.metadata?.subtitle,
      },
      // The suffix is stripped off the very next line, so a poster not yet
      // filed into a collection files fine — it just lands under "Unfiled"
      // rather than blocking an upload that has nothing to do with Shopify.
      category ?? { suffix: "" },
    ).replace(/\s*\|.*$/, ""),
  );

  const folder = await ensureFolderPath([
    category?.label ?? UNFILED_FOLDER,
    folderName,
  ]);
  if (!folder.ok) return folder;

  const existing: DriveRefs = job.drive ?? { folderId: folder.value, files: {} };
  // A changed folder id means the poster was renamed; the old uploads no
  // longer apply, so start the file map again rather than mixing locations.
  const files =
    existing.folderId === folder.value ? { ...existing.files } : {};

  // What goes to Drive is the artwork a printer needs, and nothing else:
  //   - the original, byte for byte, exactly as it was supplied; and
  //   - every print file, re-rendered LOSSLESS (PNG). The JPEGs in `sizes/`
  //     are quality 95 and fine for a screen, but this folder is the archive
  //     the prints are made from, so it gets no compression artifacts at all.
  // Mockups are deliberately not here: they are marketing images that live on
  // Shopify, and filing them beside the print files would only bury the files
  // someone is looking for.
  //
  // The key for a print file is its PNG name, so posters filed before this
  // (whose entries are the old .jpg paths) upload the lossless versions
  // instead of being skipped as "already there".
  const targets = [
    {
      key: job.sourceRelPath,
      name: `original${extensionOf(job.sourceRelPath)}`,
      render: null as null | ((outPath: string) => Promise<void>),
    },
    ...job.assets.map((asset) => {
      const name = `${(asset.relPath.split("/").pop() ?? asset.relPath).replace(/\.[^.]+$/, "")}.png`;
      return {
        key: `sizes/${name}`,
        name,
        render: (outPath: string) => renderLosslessPrintFile(job, asset, outPath),
      };
    }),
  ];

  for (const target of targets) {
    if (files[target.key]) continue; // already uploaded

    // Rendered into the job's own folder and removed once uploaded, so a
    // finished poster is not left holding a second, lossless copy of every size.
    const localPath = target.render
      ? jobAsset(job.batchId, job.id, `drive-${target.name}`)
      : jobAsset(job.batchId, job.id, target.key);

    if (target.render) {
      try {
        await target.render(localPath);
      } catch (cause) {
        return err(
          `Could not render ${target.name} for Drive: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    }

    const result = await uploadFile({
      localPath,
      name: target.name,
      parentId: folder.value,
      mimeType: mimeFor(target.name),
    });
    if (target.render) await rm(localPath, { force: true }).catch(() => undefined);

    if (!result.ok) {
      // Persist what did land before giving up, so a retry resumes rather
      // than starting from nothing.
      await updateJob(job.batchId, job.id, (current) => ({
        ...current,
        drive: { folderId: folder.value, files },
      }));
      return result;
    }

    files[target.key] = result.value;
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
