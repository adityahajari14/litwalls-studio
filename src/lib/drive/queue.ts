import "server-only";

import { uploadToDrive } from "@/lib/pipeline/stages/drive";
import { listBatches, listJobs, readJob, updateJob } from "@/lib/pipeline/store";
import { driveComplete, type DriveRefs } from "@/lib/print/types";
import { setDriveLink } from "@/lib/shopify/drive-link";
import { err, type Result } from "@/lib/result";

/**
 * The background queue that files posters to Google Drive.
 *
 * Filing used to run inline in the publish request, one poster after another
 * at ~45s each. Anything that ended that request early — a dev-server restart,
 * a reload, the laptop sleeping — stopped it mid-poster, leaving a Drive folder
 * with nothing in it and no error recorded anywhere. And a poster that failed
 * (Drive full, network) was never tried again.
 *
 * So instead:
 *   - "needs filing" is written to the job (`drivePending`) BEFORE any work,
 *     which makes the queue durable: it is rebuilt from disk on server start;
 *   - a failure is saved on the job and retried with backoff, not dropped;
 *   - the worker lives outside any request, so closing the tab changes nothing.
 *
 * State is held on globalThis so a hot reload in `next dev` does not create a
 * second queue running beside the first and uploading the same posters twice.
 */

/** Two at a time: one renders its PNGs while the other uploads. */
const CONCURRENCY = 2;

/** Delays before retrying a failed poster. After the last, it waits for the
 *  next server start or a manual "File to Drive" — still marked pending. */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

type Key = `${string}/${string}`;

type QueueState = {
  /**
   * One line, in order. Posters a person asked for (publish, republish, a
   * button) are moved to the front of it, ahead of background work. Kept as a
   * single array, not two lanes, because a worker started by an older copy of
   * this module (dev hot reload) keeps taking from `waiting` until it drains,
   * and must still see the right order.
   */
  waiting: Key[];
  /** Which of `waiting` were asked for by a person. */
  urgentKeys: Set<Key>;
  active: Map<Key, Promise<Result<DriveRefs>>>;
  retrying: Map<Key, ReturnType<typeof setTimeout>>;
  attempts: Map<Key, number>;
  labels: Map<Key, string>;
  lastError: { job: string; message: string; at: number } | null;
  filedThisSession: number;
  /** (time, filedThisSession) samples, for a time-remaining estimate. */
  pace: { t: number; n: number }[];
  resumed: boolean;
};

const holder = globalThis as typeof globalThis & {
  __litwallsDriveQueue?: QueueState;
};

const state: QueueState = (holder.__litwallsDriveQueue ??= {
  waiting: [],
  urgentKeys: new Set(),
  active: new Map(),
  retrying: new Map(),
  attempts: new Map(),
  labels: new Map(),
  lastError: null,
  filedThisSession: 0,
  pace: [],
  resumed: false,
});
// A queue created by an older version of this module (dev hot reload) lacks
// the newer fields.
state.urgentKeys ??= new Set();
state.pace ??= [];
{
  // A short-lived earlier version kept a separate urgent lane; fold it in.
  const legacy = state as QueueState & { urgent?: Key[] };
  if (legacy.urgent?.length) {
    for (const key of legacy.urgent) state.urgentKeys.add(key);
    state.waiting = [...legacy.urgent, ...state.waiting.filter((k) => !legacy.urgent!.includes(k))];
  }
  delete legacy.urgent;
}

function isWaiting(key: Key): boolean {
  return state.waiting.includes(key);
}

/** Remove in place: an older worker may hold a reference to this array. */
function removeWaiting(key: Key) {
  const index = state.waiting.indexOf(key);
  if (index !== -1) state.waiting.splice(index, 1);
}

/** Put a poster at the back of the asked-for group at the front of the line. */
function moveToFront(key: Key) {
  removeWaiting(key);
  let at = 0;
  while (at < state.waiting.length && state.urgentKeys.has(state.waiting[at])) at += 1;
  state.waiting.splice(at, 0, key);
  state.urgentKeys.add(key);
}

const keyOf = (batchId: string, jobId: string): Key => `${batchId}/${jobId}`;

function split(key: Key): [string, string] {
  const slash = key.indexOf("/");
  return [key.slice(0, slash), key.slice(slash + 1)];
}

function isQueued(key: Key): boolean {
  return isWaiting(key) || state.active.has(key) || state.retrying.has(key);
}

/**
 * Queue posters for Drive. The pending flag is saved first, so even if the
 * server dies a moment later these are picked up again when it comes back.
 *
 * `urgent` (the default) is for anything a person just asked for: it goes
 * ahead of background work, so republishing one batch is not stuck behind
 * a few hundred posters of clean-up from another.
 */
export async function enqueueDrive(
  refs: { batchId: string; jobId: string }[],
  { urgent = true }: { urgent?: boolean } = {},
): Promise<number> {
  let added = 0;
  for (const { batchId, jobId } of refs) {
    const key = keyOf(batchId, jobId);
    try {
      await updateJob(batchId, jobId, (job) => ({ ...job, drivePending: true }));
    } catch {
      continue; // job deleted in the meantime
    }
    // A poster waiting on a retry timer goes now: someone asked for it.
    const timer = state.retrying.get(key);
    if (timer) {
      clearTimeout(timer);
      state.retrying.delete(key);
    }
    if (state.active.has(key)) continue;
    if (urgent && !(isWaiting(key) && state.urgentKeys.has(key))) {
      moveToFront(key);
      added += 1;
    } else if (!isWaiting(key)) {
      state.waiting.push(key);
      added += 1;
    }
  }
  pump();
  return added;
}

/**
 * File one poster right now and wait for the result — the review screen's
 * "File to Drive" button. Joins the in-flight upload if the queue already has
 * it, so the two can never upload the same poster side by side.
 */
export async function fileToDriveNow(
  batchId: string,
  jobId: string,
): Promise<Result<DriveRefs>> {
  const key = keyOf(batchId, jobId);
  const inflight = state.active.get(key);
  if (inflight) return inflight;

  removeWaiting(key);
  const timer = state.retrying.get(key);
  if (timer) {
    clearTimeout(timer);
    state.retrying.delete(key);
  }
  try {
    await updateJob(batchId, jobId, (job) => ({ ...job, drivePending: true }));
  } catch {
    return err("Job not found.");
  }
  return start(key);
}

/** Start workers up to the concurrency limit. */
function pump() {
  while (state.active.size < CONCURRENCY && state.waiting.length > 0) {
    const key = state.waiting.shift()!;
    if (state.active.has(key)) continue;
    void start(key);
  }
}

function start(key: Key): Promise<Result<DriveRefs>> {
  state.urgentKeys.delete(key);
  const run = fileOne(key).finally(() => {
    state.active.delete(key);
    pump();
  });
  state.active.set(key, run);
  return run;
}

async function fileOne(key: Key): Promise<Result<DriveRefs>> {
  const [batchId, jobId] = split(key);
  const job = await readJob(batchId, jobId);
  if (!job) {
    state.attempts.delete(key);
    return err("Job not found.");
  }
  state.labels.set(key, job.metadata?.subject ?? job.sourceName);

  let result: Result<DriveRefs>;
  try {
    result = await uploadToDrive(job);
  } catch (cause) {
    // uploadToDrive returns its errors, but a throw (disk, sharp) must not
    // kill the worker and strand everything waiting behind it.
    result = err(cause instanceof Error ? cause.message : String(cause));
  }

  if (result.ok) {
    const filed = result.value;
    // The files are up; now point the Shopify product at them. A failure here
    // is treated like a failed upload — saved, retried with backoff, poster
    // left pending — because a product with no link is exactly the thing this
    // exists to prevent. The retry is cheap: every file is already recorded
    // as uploaded, so it skips straight back to this step.
    const linkError = await linkProduct(batchId, jobId, filed.folderId);
    if (linkError === null) {
      state.attempts.delete(key);
      state.labels.delete(key);
      state.filedThisSession += 1;
      await updateJob(batchId, jobId, (current) => ({
        ...current,
        drive: filed,
        driveError: null,
        // Cleared only once every file is confirmed AND the product is
        // linked, so a partial job stays queued rather than read as done.
        drivePending: !driveComplete({ ...current, drive: filed }),
        stage: current.stage === "approved" ? "uploaded" : current.stage,
      })).catch(() => undefined);
      return result;
    }
    await updateJob(batchId, jobId, (current) => ({ ...current, drive: filed })).catch(
      () => undefined,
    );
    result = { ok: false, error: linkError };
  }

  const message = result.error;
  const attempt = (state.attempts.get(key) ?? 0) + 1;
  state.attempts.set(key, attempt);
  state.lastError = { job: state.labels.get(key) ?? key, message, at: Date.now() };
  console.error(`[drive] ${state.labels.get(key) ?? key} (attempt ${attempt}): ${message}`);

  await updateJob(batchId, jobId, (current) => ({
    ...current,
    driveError: { message, at: Date.now() },
  })).catch(() => undefined);

  const delay = RETRY_DELAYS_MS[attempt - 1];
  if (delay !== undefined) {
    state.retrying.set(
      key,
      setTimeout(() => {
        state.retrying.delete(key);
        if (!isWaiting(key) && !state.active.has(key)) {
          state.waiting.push(key);
          pump();
        }
      }, delay),
    );
  }
  return result;
}

/**
 * Write the Drive folder link onto the poster's Shopify product, if it has
 * one and the link is not already this folder. Returns an error message, or
 * null when there was nothing to do or it worked.
 *
 * Reads the job afresh: publishing may have created the product while the
 * files were uploading.
 */
async function linkProduct(
  batchId: string,
  jobId: string,
  folderId: string,
): Promise<string | null> {
  const job = await readJob(batchId, jobId);
  const productId = job?.shopify?.productId;
  if (!job || !productId || job.driveLinkedFolderId === folderId) return null;
  try {
    await setDriveLink(productId, folderId);
  } catch (cause) {
    return `Filed to Drive, but could not add the folder link to the Shopify product: ${
      cause instanceof Error ? cause.message : String(cause)
    }`;
  }
  await updateJob(batchId, jobId, (current) => ({
    ...current,
    driveLinkedFolderId: folderId,
  })).catch(() => undefined);
  return null;
}

/**
 * Re-queue every poster still marked pending — run once per server start, so
 * work interrupted by a restart carries on by itself.
 */
export async function resumeDrive(): Promise<void> {
  if (state.resumed) return;
  state.resumed = true;
  const refs: { batchId: string; jobId: string }[] = [];
  for (const batch of await listBatches()) {
    for (const job of await listJobs(batch.id)) {
      if (job.drivePending && !isQueued(keyOf(batch.id, job.id))) {
        refs.push({ batchId: batch.id, jobId: job.id });
      }
    }
  }
  if (refs.length > 0) {
    console.log(`[drive] resuming ${refs.length} poster(s) waiting for Drive`);
    await enqueueDrive(refs, { urgent: false });
  }
}

/**
 * Queue every published poster that is not fully on Drive, or whose product
 * is not yet linked to its folder (one batch, or all). With `everything`,
 * queue every published poster regardless: cheap for one already filed in its
 * own folder (a rename at most), and it moves any poster still sharing a
 * folder with others into one of its own.
 *
 * A poster filed by the old name-matched code has an untagged folder, so
 * queueing it for its link also moves it into a folder of its own — the
 * link written is to that folder, never to a shared one.
 */
export async function enqueueMissing(
  batchId?: string,
  everything = false,
  urgent = !everything,
): Promise<number> {
  const batches = batchId ? [{ id: batchId }] : await listBatches();
  const refs: { batchId: string; jobId: string }[] = [];
  for (const batch of batches) {
    for (const job of await listJobs(batch.id)) {
      if (job.shopify?.productId && (everything || !driveComplete(job))) {
        refs.push({ batchId: batch.id, jobId: job.id });
      }
    }
  }
  // A person clicking "File missing" wants it now; a full re-file is clean-up.
  await enqueueDrive(refs, { urgent });
  return refs.length;
}

/**
 * Stop starting new uploads; the ones already running finish. Pending flags
 * stay on the jobs, so `resumeDrive`/`enqueueMissing` picks them up again.
 */
export function pauseDrive(): number {
  const dropped = state.waiting.length + state.retrying.size;
  state.waiting.splice(0);
  state.urgentKeys.clear();
  for (const timer of state.retrying.values()) clearTimeout(timer);
  state.retrying.clear();
  return dropped;
}

export type DriveQueueStatus = {
  uploading: string[];
  waiting: number;
  retrying: number;
  filedThisSession: number;
  /** Seconds until the queue is empty at the recent pace, if known. */
  etaSeconds: number | null;
  lastError: { job: string; message: string; at: number } | null;
  /** With a batch id: where that batch stands in the line. */
  batch?: {
    uploading: string[];
    waiting: number;
    /** Posters from other batches that will be done before this one starts. */
    ahead: number;
    etaSeconds: number | null;
  };
};

/**
 * Seconds per poster over roughly the last fifteen minutes, from samples of
 * the finished count taken whenever status is read.
 */
function secondsPerPoster(): number | null {
  const now = Date.now();
  state.pace = [...state.pace, { t: now, n: state.filedThisSession }].filter(
    (sample) => now - sample.t < 15 * 60_000,
  );
  const first = state.pace[0];
  const done = state.filedThisSession - first.n;
  if (done < 3) return null;
  return (now - first.t) / 1000 / done;
}

export function driveQueueStatus(batchId?: string): DriveQueueStatus {
  const line = state.waiting;
  const pace = secondsPerPoster();
  const eta = (posters: number) => (pace === null ? null : Math.round(posters * pace));
  const label = (k: Key) => state.labels.get(k) ?? k;

  let batch: DriveQueueStatus["batch"];
  if (batchId) {
    const mine = (k: Key) => split(k)[0] === batchId;
    const first = line.findIndex(mine);
    const lastIndex = line.length - 1 - [...line].reverse().findIndex(mine);
    const waiting = line.filter(mine).length;
    batch = {
      uploading: [...state.active.keys()].filter(mine).map(label),
      waiting,
      ahead: first === -1 ? 0 : line.slice(0, first).filter((k) => !mine(k)).length,
      etaSeconds: waiting === 0 ? 0 : eta(lastIndex + 1 + state.active.size),
    };
  }

  return {
    uploading: [...state.active.keys()].map(label),
    waiting: line.length,
    retrying: state.retrying.size,
    filedThisSession: state.filedThisSession,
    etaSeconds: eta(line.length + state.active.size),
    lastError: state.lastError,
    batch,
  };
}
