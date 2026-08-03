import "server-only";

import { readdir, readFile, rm } from "node:fs/promises";

import {
  BATCHES_DIR,
  batchDir,
  batchFile,
  ensureDir,
  jobDir,
  jobFile,
  writeJsonAtomic,
} from "@/lib/pipeline/paths";
import type { Batch, PosterJob } from "@/lib/print/types";

/**
 * Job and batch state, stored as one JSON file per entity.
 *
 * Not SQLite: `better-sqlite3` is a native module, and on Windows that means
 * node-gyp and a Visual Studio toolchain for a tool one person runs locally.
 * Not a single combined file: every write would rewrite everything, and two
 * stages finishing at once would lose one of the updates.
 *
 * One file per job means a job is the unit of concurrent mutation AND the unit
 * of storage, so two stages completing simultaneously never touch the same
 * file. That removes an entire class of lost-update bugs without a lock
 * manager. It also makes the state hand-inspectable and hand-editable, which
 * for a local tool at 1am is the actual killer feature.
 */

async function readJsonFile<T>(path: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // Missing is a normal answer to "does this exist", not an error.
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt file is worth shouting about — it means a write was
    // interrupted in a way writeJsonAtomic is supposed to make impossible.
    console.error(`store: ${path} is not valid JSON`);
    return null;
  }
}

export async function readBatch(batchId: string): Promise<Batch | null> {
  return readJsonFile<Batch>(batchFile(batchId));
}

export async function writeBatch(batch: Batch): Promise<void> {
  await ensureDir(batchDir(batch.id));
  await writeJsonAtomic(batchFile(batch.id), {
    ...batch,
    updatedAt: Date.now(),
  });
}

/** Newest first — the batch you just made is the one you want to open. */
export async function listBatches(): Promise<Batch[]> {
  let entries: string[];
  try {
    entries = await readdir(BATCHES_DIR);
  } catch {
    return [];
  }

  const batches = await Promise.all(
    entries.map((id) => readBatch(id).catch(() => null)),
  );

  return batches
    .filter((batch): batch is Batch => batch !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function readJob(
  batchId: string,
  jobId: string,
): Promise<PosterJob | null> {
  return readJsonFile<PosterJob>(jobFile(batchId, jobId));
}

export async function writeJob(job: PosterJob): Promise<void> {
  await ensureDir(jobDir(job.batchId, job.id));
  await writeJsonAtomic(jobFile(job.batchId, job.id), {
    ...job,
    updatedAt: Date.now(),
  });
}

/**
 * Jobs in the order they were added, which is the order they were dropped.
 *
 * Read from the directory rather than from `batch.jobIds` so a job whose entry
 * failed to make it into the batch file still shows up. The files on disk are
 * the truth; the batch's list is an index that can lag.
 */
export async function listJobs(batchId: string): Promise<PosterJob[]> {
  let entries: string[];
  try {
    entries = await readdir(`${batchDir(batchId)}/jobs`);
  } catch {
    return [];
  }

  const jobs = await Promise.all(
    entries.map((jobId) => readJob(batchId, jobId).catch(() => null)),
  );

  return jobs
    .filter((job): job is PosterJob => job !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Per-job mutation queue.
 *
 * A Map of promise chains, not a file lock: only this dev server writes these
 * files, so cross-process locking would be ceremony. What genuinely needs
 * preventing is two stages of the SAME job completing at once, both having
 * read the old JSON, with the second write silently discarding the first —
 * a real risk the moment stages run with any concurrency.
 *
 * Entries are deleted once the chain drains, so a long session processing
 * hundreds of posters does not accumulate one entry per job forever.
 */
const jobLocks = new Map<string, Promise<unknown>>();

/**
 * Read, mutate and write a job atomically with respect to other callers.
 *
 * `mutate` must be pure with respect to the job — return a new object rather
 * than editing in place. It may be called at any point in the queue, so it has
 * to work from whatever the current state is rather than one captured earlier.
 */
export async function updateJob(
  batchId: string,
  jobId: string,
  mutate: (job: PosterJob) => PosterJob,
): Promise<PosterJob> {
  const key = `${batchId}/${jobId}`;
  const previous = jobLocks.get(key) ?? Promise.resolve();

  const run = previous.then(async () => {
    const current = await readJob(batchId, jobId);
    if (!current) {
      throw new Error(`Job not found: ${key}`);
    }
    const next = mutate(current);
    await writeJob(next);
    return next;
  });

  // The value stored in the map is deliberately a DIFFERENT promise: it never
  // rejects, so one failed update cannot poison every update queued behind it.
  // The caller still sees the real error, because they await `run` itself.
  const chained = run.then(
    () => undefined,
    () => undefined,
  );
  jobLocks.set(key, chained);

  // Prune once drained, but only if nobody queued behind us in the meantime —
  // otherwise a long session accumulates one dead entry per job forever.
  void chained.then(() => {
    if (jobLocks.get(key) === chained) jobLocks.delete(key);
  });

  return run;
}

/** Delete a batch and everything under it, including rendered files. */
export async function deleteBatch(batchId: string): Promise<void> {
  await rm(batchDir(batchId), { recursive: true, force: true });
}

export async function deleteJob(
  batchId: string,
  jobId: string,
): Promise<void> {
  await rm(jobDir(batchId, jobId), { recursive: true, force: true });
}
