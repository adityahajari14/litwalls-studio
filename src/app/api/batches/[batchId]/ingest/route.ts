import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { createJob } from "@/lib/pipeline/create";
import { ensureDir, jobAsset, jobDir } from "@/lib/pipeline/paths";
import { readBatch, writeBatch, writeJob } from "@/lib/pipeline/store";
import { checkFile, safeFilename } from "@/lib/print/upload";
import type { PosterJob } from "@/lib/print/types";

/**
 * Accept dropped artwork and create one job per file.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION. Server Actions cap request bodies at
 * 1MB by default; these files are 10-200MB. Route handlers have no such limit,
 * and this is the single reason the upload path is shaped this way.
 *
 * Related hazard, documented in the README: adding a `proxy.ts` would make
 * Next buffer the entire body in memory (10MB default) and SILENTLY TRUNCATE
 * anything larger — the request would still succeed, with a corrupt file. Do
 * not add one.
 */

/**
 * Streaming is not an optimisation here. `await file.arrayBuffer()` on a
 * 200MB TIFF materialises the whole thing in the heap, and a handful of those
 * in one batch is an out-of-memory crash. Piping keeps memory flat regardless
 * of file size.
 */
async function writeUpload(file: File, destination: string): Promise<number> {
  const source = Readable.fromWeb(file.stream() as NodeWebReadableStream);
  await pipeline(source, createWriteStream(destination));
  return file.size;
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/ingest">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return Response.json({ error: "Batch not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return Response.json(
      { error: `Could not read the upload: ${message}` },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files were sent." }, { status: 400 });
  }

  const created: PosterJob[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    // Re-validated server-side. The browser checks the same rules to fail
    // fast, but it is not a trust boundary.
    const problem = checkFile({
      name: file.name,
      type: file.type,
      size: file.size,
    });
    if (problem) {
      rejected.push(problem.message);
      continue;
    }

    const filename = `original${safeFilename(file.name).match(/\.[^.]+$/)?.[0] ?? ".bin"}`;
    const job = createJob({
      batch,
      sourceName: file.name,
      sourceRelPath: filename,
    });

    try {
      await ensureDir(jobDir(batchId, job.id));
      await writeUpload(file, jobAsset(batchId, job.id, filename));
      // Written only AFTER the bytes land, so a job.json never points at a
      // file that does not exist.
      await writeJob(job);
      created.push(job);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      rejected.push(`${file.name}: ${message}`);
    }
  }

  if (created.length > 0) {
    await writeBatch({
      ...batch,
      jobIds: [...batch.jobIds, ...created.map((job) => job.id)],
    });
  }

  // 207: some files may have landed while others were refused, and the UI
  // needs to show both rather than treating the whole drop as pass or fail.
  const status = rejected.length > 0 && created.length > 0 ? 207 : 200;
  return Response.json({ created, rejected }, { status });
}
