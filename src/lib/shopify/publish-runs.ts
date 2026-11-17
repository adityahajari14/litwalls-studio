import "server-only";

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { batchDir } from "@/lib/pipeline/paths";

/**
 * Which batches are being published right now.
 *
 * Publishing a batch is one long request — about 12 seconds a poster, so a
 * Music batch of 93 is twenty minutes. The button that started it only knows
 * it is busy for as long as that page stays open: reload it, or open the batch
 * in a second tab, and "Publish to Shopify" was clickable again while the first
 * run was still going on the server. A second click started a second run over
 * the same posters, and every poster both runs reached was created on Shopify
 * twice — 78 duplicate products from one Music batch on 17 Nov 2026.
 *
 * So the server is the one that says no, at two levels:
 *   - in memory, checked and set with no await between, so two requests to
 *     this process cannot both get through;
 *   - a lock file in the batch's folder, created exclusively, so a second
 *     Studio server (another terminal, a production build beside the dev
 *     server) cannot start a run either. A lock left by a process that died
 *     is recognised and taken over, so a crash never blocks a batch for good.
 */

export type PublishRun = {
  mode: "publish" | "republish";
  total: number;
  done: number;
  failed: number;
  startedAt: number;
  /** The poster being sent right now, by name. */
  current: string | null;
};

type LockFile = { pid: number; heartbeat: number; run: PublishRun };

/** A run that has not reported progress for this long is dead. One poster
 *  takes seconds; this is far beyond any single slow upload. */
const STALE_MS = 10 * 60 * 1000;

const holder = globalThis as typeof globalThis & {
  __litwallsPublishRuns?: Map<string, PublishRun>;
  __litwallsPublishingJobs?: Set<string>;
};
const runs = (holder.__litwallsPublishRuns ??= new Map());
const jobs = (holder.__litwallsPublishingJobs ??= new Set());

const lockPath = (batchId: string) => join(batchDir(batchId), "publish.lock");

async function readLock(batchId: string): Promise<LockFile | null> {
  try {
    return JSON.parse(await readFile(lockPath(batchId), "utf8")) as LockFile;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0); // signal 0: existence check, sends nothing
    return true;
  } catch (cause) {
    // EPERM means it exists but belongs to someone else — still alive.
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isLive(lock: LockFile): boolean {
  return Date.now() - lock.heartbeat < STALE_MS && alive(lock.pid);
}

async function writeLock(batchId: string, run: PublishRun, exclusive: boolean) {
  const body: LockFile = { pid: process.pid, heartbeat: Date.now(), run };
  await writeFile(lockPath(batchId), JSON.stringify(body), {
    flag: exclusive ? "wx" : "w",
  });
}

/** Claim the batch for a run, or get back the run that already has it. */
export async function startRun(
  batchId: string,
  mode: PublishRun["mode"],
): Promise<{ ok: true; run: PublishRun } | { ok: false; running: PublishRun }> {
  const mine = runs.get(batchId);
  if (mine) return { ok: false, running: mine };

  const run: PublishRun = {
    mode,
    total: 0,
    done: 0,
    failed: 0,
    startedAt: Date.now(),
    current: null,
  };
  runs.set(batchId, run); // claimed in this process before anything awaits

  try {
    await writeLock(batchId, run, true);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
      runs.delete(batchId);
      throw cause;
    }
    const other = await readLock(batchId);
    if (other && isLive(other)) {
      runs.delete(batchId);
      return { ok: false, running: other.run };
    }
    // Left behind by a run that crashed or was killed: take it over.
    await writeLock(batchId, run, false);
  }
  return { ok: true, run };
}

/** Save progress, which is also the heartbeat that keeps the lock live. */
export async function saveProgress(batchId: string, run: PublishRun) {
  await writeLock(batchId, run, false).catch(() => undefined);
}

export async function finishRun(batchId: string): Promise<void> {
  // The file goes first: while the in-memory entry is still here, nothing in
  // this process can try to start a run and trip over our own lock file.
  const lock = await readLock(batchId);
  if (!lock || lock.pid === process.pid) {
    await rm(lockPath(batchId), { force: true }).catch(() => undefined);
  }
  runs.delete(batchId);
}

export async function currentRun(batchId: string): Promise<PublishRun | null> {
  const mine = runs.get(batchId);
  if (mine) return mine;
  const lock = await readLock(batchId);
  return lock && isLive(lock) ? lock.run : null;
}

/** One publish per poster at a time within this process, whichever run asks. */
export function claimJob(batchId: string, jobId: string): boolean {
  const key = `${batchId}/${jobId}`;
  if (jobs.has(key)) return false;
  jobs.add(key);
  return true;
}

export function releaseJob(batchId: string, jobId: string): void {
  jobs.delete(`${batchId}/${jobId}`);
}
