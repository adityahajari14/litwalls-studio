import "server-only";

import {
  ensureRootFolder,
  FILE_QUERY,
  FOLDER_QUERY,
  listAll,
  PRODUCT_PROPERTY,
  trashItem,
} from "@/lib/drive/files";
import { planCleanup, type CleanupFolder, type CleanupPlan } from "@/lib/drive/cleanup-plan";
import { driveQueueStatus } from "@/lib/drive/queue";
import { listBatches, listJobs } from "@/lib/pipeline/store";
import { err, ok, type Result } from "@/lib/result";

/**
 * Clearing out the old shared Drive folders. The rules for what may go live
 * in `cleanup-plan.ts`; this gathers the inputs from Drive and from the jobs
 * on disk, and moves what the plan allows to the Drive trash.
 */

/**
 * Not while the queue is uploading: a poster mid-re-file has moved to its new
 * folder but may not have every file there yet, and its old folder is exactly
 * what this would remove.
 */
function busyReason(): string | null {
  const queue = driveQueueStatus();
  if (queue.uploading.length > 0 || queue.waiting > 0) {
    return "Drive uploads are still running — clean up once the queue is empty.";
  }
  return null;
}

export async function cleanupPlan(): Promise<Result<CleanupPlan>> {
  const root = await ensureRootFolder();
  if (!root.ok) return root;

  const folders = await listAll<{
    id: string;
    name: string;
    parents?: string[];
    appProperties?: Record<string, string>;
  }>(FOLDER_QUERY, "id,name,parents,appProperties");
  if (!folders.ok) return folders;

  const files = await listAll<{
    id: string;
    name: string;
    parents?: string[];
    md5Checksum?: string;
  }>(FILE_QUERY, "id,name,parents,md5Checksum");
  if (!files.ok) return files;

  const referenced = new Set<string>();
  for (const batch of await listBatches()) {
    for (const job of await listJobs(batch.id)) {
      if (job.drive?.folderId) referenced.add(job.drive.folderId);
      if (job.driveLinkedFolderId) referenced.add(job.driveLinkedFolderId);
    }
  }

  return ok(
    planCleanup({
      rootId: root.value,
      folders: folders.value.map((f) => ({
        id: f.id,
        name: f.name,
        parents: f.parents ?? [],
        productTag: f.appProperties?.[PRODUCT_PROPERTY] ?? null,
      })),
      files: files.value.map((f) => ({
        id: f.id,
        name: f.name,
        parents: f.parents ?? [],
        md5: f.md5Checksum ?? null,
      })),
      referenced,
    }),
  );
}

export type CleanupPreview = CleanupPlan & { blocked: string | null };

export async function previewCleanup(): Promise<Result<CleanupPreview>> {
  const plan = await cleanupPlan();
  if (!plan.ok) return plan;
  return ok({ ...plan.value, blocked: busyReason() });
}

/**
 * Move to the trash the folders the person confirmed — but only those the
 * plan, worked out again right now, still says can go. Something may have
 * changed between the preview and the click.
 */
export async function runCleanup(
  confirmedIds: string[],
): Promise<Result<{ trashed: CleanupFolder[]; failed: { name: string; error: string }[] }>> {
  const blocked = busyReason();
  if (blocked) return err(blocked);

  const plan = await cleanupPlan();
  if (!plan.ok) return plan;

  const confirmed = new Set(confirmedIds);
  const trashed: CleanupFolder[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const folder of plan.value.remove) {
    if (!confirmed.has(folder.id)) continue;
    const result = await trashItem(folder.id);
    if (result.ok) trashed.push(folder);
    else failed.push({ name: folder.name, error: result.error });
  }
  if (trashed.length > 0) {
    console.log(`[drive] cleanup moved ${trashed.length} old shared folder(s) to the trash`);
  }
  return ok({ trashed, failed });
}
