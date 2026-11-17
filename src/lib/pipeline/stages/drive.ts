import "server-only";

import { rm, stat } from "node:fs/promises";

import {
  claimFolder,
  createProductFolder,
  ensureFolderPath,
  findFile,
  findProductFolder,
  listFolderFileIds,
  uploadFile,
} from "@/lib/drive/files";
import { posterFolderName } from "@/lib/drive/naming";
import { renderLosslessPrintFile } from "@/lib/pipeline/stages/crop";
import { jobAsset } from "@/lib/pipeline/paths";
import { listPublished } from "@/lib/pipeline/registry";
import { listBatches, listJobs, readBatch, updateJob } from "@/lib/pipeline/store";
import { mainCategoryFor } from "@/lib/print/categories";
import { parseTitle } from "@/lib/print/title";
import { err, ok, type Result } from "@/lib/result";
import { driveFileKeys, type DriveRefs, type PosterJob } from "@/lib/print/types";

/**
 * File a poster's print-ready artwork to Google Drive.
 *
 * One folder per poster: Litwalls Posters/<Category>/<Product Name>/ holding
 * every size (or every panel, for a split) plus the original. That layout
 * means "find the print files for this product" is one navigation rather than
 * a search across size folders.
 */

/**
 * The number in the poster's Shopify title, or null before it is published.
 *
 * Products published before `shopify.sequence` was recorded do not carry it,
 * so their number is read back off the title in the published registry —
 * the same fallback a republish uses.
 */
async function productSequence(job: PosterJob): Promise<number | null> {
  if (job.shopify?.sequence) return job.shopify.sequence;
  if (job.shopify?.productId) {
    const record = (await listPublished()).find(
      (entry) => entry.productId === job.shopify?.productId,
    );
    const fromTitle = record ? parseTitle(record.title)?.sequence : null;
    if (fromTitle) return fromTitle;
  }
  return job.metadata?.sequence ?? null;
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
/**
 * One folder walk at a time, process-wide.
 *
 * Folder creation is find-or-create, which is only idempotent when nothing
 * else is doing the same at once: two posters in one collection filed in
 * parallel would both find no "Anime" folder and both create one. Held on
 * globalThis so a dev-server hot reload of this module shares the same lock.
 */
const lockHolder = globalThis as typeof globalThis & {
  __litwallsDriveFolderLock?: Promise<unknown>;
};

async function withFolderLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = lockHolder.__litwallsDriveFolderLock ?? Promise.resolve();
  const run = previous.then(work, work);
  lockHolder.__litwallsDriveFolderLock = run.catch(() => undefined);
  return run;
}

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
  // order — with the number Shopify actually has. That lives on
  // `shopify.sequence`; `metadata.sequence` is only an optional override and
  // is normally unset, which is why every poster used to land in "… #01" and
  // share it with every other poster of the same subject. With no number at
  // all (not yet published), the name says "unpublished" rather than guess.
  const folderName = posterFolderName({
    subject,
    subtitle: job.metadata?.subtitle,
    sequence: await productSequence(job),
    jobId: job.id,
  });

  const folder = await withFolderLock(() =>
    resolvePosterFolder(job, category?.label ?? UNFILED_FOLDER, folderName),
  );
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
  const keys = driveFileKeys(job);
  const targets = [
    {
      key: keys.original,
      name: `original${extensionOf(job.sourceRelPath)}`,
      render: null as null | ((outPath: string) => Promise<void>),
    },
    ...keys.prints.map(({ key, name, asset }) => ({
      key,
      name,
      render: (outPath: string) => renderLosslessPrintFile(job, asset, outPath),
    })),
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

    // Already in the folder but not recorded here — the process died between
    // Drive finishing the upload and the id being saved. Adopt it rather than
    // uploading a duplicate beside it. Matched on name AND byte size, so it
    // can only ever be this poster's own file.
    const size = await stat(localPath).then((s) => s.size).catch(() => -1);
    const onDrive = size >= 0 ? await findFile(target.name, folder.value, size) : null;
    if (onDrive?.ok && onDrive.value) {
      if (target.render) await rm(localPath, { force: true }).catch(() => undefined);
      files[target.key] = onDrive.value;
      await updateJob(job.batchId, job.id, (current) => ({
        ...current,
        drive: { folderId: folder.value, files },
      }));
      continue;
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

/**
 * This poster's own folder: <root>/<category>/<product name>.
 *
 * In order of preference:
 *   1. the folder already tagged with this poster's product (renamed to the
 *      current product name if it has drifted);
 *   2. the folder this poster used before, IF no other poster uses it too —
 *      renamed to the right number and tagged, keeping what is in it;
 *   3. a fresh tagged folder.
 * A folder shared with other posters (the old "#01" collisions) is never
 * reused: its files are a mix of several posters' and cannot be trusted.
 */
async function resolvePosterFolder(
  job: PosterJob,
  categoryLabel: string,
  folderName: string,
): Promise<Result<string>> {
  const category = await ensureFolderPath([categoryLabel]);
  if (!category.ok) return category;

  // Before publish there is no product yet; the job id stands in, and the
  // folder is claimed under the product key once it is published.
  const productKey = job.shopify?.productId ?? `job:${job.batchId}/${job.id}`;

  const tagged = await findProductFolder(productKey, category.value);
  if (!tagged.ok) return tagged;
  if (tagged.value) {
    // Re-applied every time: the name may have been made before the real
    // number was known ("#01" guessed, or "unpublished"). Cheap, and it
    // keeps the folder findable by the product's title.
    const renamed = await claimFolder(tagged.value, folderName, category.value, productKey);
    if (!renamed.ok) return renamed;
    return ok(tagged.value);
  }

  const previous = job.drive?.folderId;
  if (previous && (await folderIsOnlyThisPosters(job, previous))) {
    const claimed = await claimFolder(previous, folderName, category.value, productKey);
    if (!claimed.ok) return claimed;
    if (claimed.value) return ok(previous);
  }

  return createProductFolder(folderName, category.value, productKey);
}

/**
 * Whether a folder holds nothing but files this poster uploaded, and no other
 * poster points at it. Both checks are needed: a folder can be referenced by
 * this poster alone and still hold files from posters that were since moved
 * or deleted, and those leftovers are indistinguishable by name.
 */
async function folderIsOnlyThisPosters(job: PosterJob, folderId: string): Promise<boolean> {
  const mine = new Set(Object.values(job.drive?.files ?? {}));
  const contents = await listFolderFileIds(folderId);
  if (!contents.ok || !contents.value.every((id) => mine.has(id))) return false;

  for (const batch of await listBatches()) {
    for (const other of await listJobs(batch.id)) {
      if (other.id !== job.id && other.drive?.folderId === folderId) return false;
    }
  }
  return true;
}

function extensionOf(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  return dot === -1 ? "" : relPath.slice(dot);
}
