import "server-only";

import { fork, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
import { join } from "node:path";

/**
 * Runs AI upscaling in a small pool of separate OS processes.
 *
 * `aiUpscale4x` (see ../ai-upscale.ts) used to run inline, and its ONNX
 * inference call blocks whatever thread calls it for the whole time it runs —
 * minutes per poster. This app is a single Node process serving every
 * request, so that blocked the server itself: no other page, no other batch,
 * and not even this batch's own SSE progress stream could respond until the
 * model finished. A pool of forked processes fixes both halves of that: the
 * server stays free to keep answering while the heavy work happens elsewhere,
 * and — on CPU, unlike one thread doing everything in turn — several posters
 * can genuinely upscale at once on separate cores.
 */

const WORKER_PATH = join(process.cwd(), "scripts", "upscale-worker.mjs");

/**
 * Run the model on the GPU through DirectML wherever that exists.
 *
 * Measured on the 6-core laptop this runs on, integrated graphics alone get
 * through about 2.5x the tiles per second of four CPU workers, with output
 * that matches to within one 8-bit level on a few values per hundred
 * thousand. `UPSCALE_DEVICE=cpu` in .env.local forces the CPU pool instead.
 */
const USE_GPU =
  process.platform === "win32" && process.env.UPSCALE_DEVICE !== "cpu";

/**
 * One worker on GPU: there is a single adapter, so a second session only
 * queues behind the first while holding its own copy of the model in memory —
 * and CPU workers alongside it gain nothing either, as they slow the GPU by
 * as much as they add. On CPU, leave a couple of cores for the server itself
 * and whatever else is running.
 */
const POOL_SIZE = USE_GPU ? 1 : Math.max(1, Math.min(4, cpus().length - 2));

/** Each CPU worker's own ONNX session defaults to using every core; told to share instead. */
const THREADS_PER_WORKER = Math.max(1, Math.floor(cpus().length / POOL_SIZE));

type UpscaleResult = { width: number; height: number };

type Task = {
  id: number;
  sourcePath: string;
  destPath: string;
  resolve: (value: UpscaleResult) => void;
  reject: (reason: unknown) => void;
};

type Slot = { child: ChildProcess; current: Task | null };

let slots: Slot[] | null = null;
const queue: Task[] = [];
let nextId = 0;

function spawnChild(): ChildProcess {
  return fork(WORKER_PATH, {
    env: {
      ...process.env,
      UPSCALE_DEVICE: USE_GPU ? "gpu" : "cpu",
      // Only the CPU pool shares cores. A lone GPU worker that had to fall
      // back to CPU is better off with ONNX's default of all of them.
      ...(USE_GPU
        ? {}
        : { UPSCALE_INTRA_OP_THREADS: String(THREADS_PER_WORKER) }),
    },
  });
}

function attach(slot: Slot): void {
  slot.child.on(
    "message",
    (msg: { id: number; result?: UpscaleResult; error?: string }) => {
      const task = slot.current;
      if (!task || task.id !== msg.id) return;
      slot.current = null;
      if (msg.error) task.reject(new Error(msg.error));
      else task.resolve(msg.result as UpscaleResult);
      pump();
    },
  );

  // A crashed worker's task cannot be recovered — its partial output is
  // unknown — so it fails like any other stage error (see pipeline.ts) rather
  // than hanging the job forever. The slot is replaced so the pool keeps its
  // size for the rest of the session.
  slot.child.once("exit", (code) => {
    const task = slot.current;
    slot.current = null;
    task?.reject(new Error(`Upscale worker exited unexpectedly (code ${code}).`));
    slot.child = spawnChild();
    attach(slot);
    pump();
  });
}

function ensurePool(): Slot[] {
  if (!slots) {
    slots = Array.from({ length: POOL_SIZE }, () => {
      const slot: Slot = { child: spawnChild(), current: null };
      attach(slot);
      return slot;
    });
  }
  return slots;
}

function pump(): void {
  for (const slot of ensurePool()) {
    if (slot.current || queue.length === 0) continue;
    const task = queue.shift()!;
    slot.current = task;
    slot.child.send({
      id: task.id,
      sourcePath: task.sourcePath,
      destPath: task.destPath,
    });
  }
}

export function runAiUpscale4x(
  sourcePath: string,
  destPath: string,
): Promise<UpscaleResult> {
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, sourcePath, destPath, resolve, reject });
    pump();
  });
}
