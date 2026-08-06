import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { getAccessToken } from "@/lib/drive/auth";
import { err, ok, type Result } from "@/lib/result";

/**
 * Drive folder and file operations, hand-rolled.
 *
 * No `googleapis` dependency: that package is tens of megabytes to make a
 * handful of HTTPS calls, and the calls themselves are three fetches.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Drive's query syntax uses single quotes, so they must be escaped. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Find a folder by name under a parent, or create it.
 *
 * Idempotent by construction: a re-run finds the folder it made last time
 * instead of creating "Product Name (1)" beside it. Drive happily allows
 * duplicate names, so this has to be enforced here rather than relied upon.
 */
export async function ensureFolder(
  name: string,
  parentId: string,
): Promise<Result<string>> {
  const token = await getAccessToken();
  if (!token.ok) return token;

  const query = [
    `name = '${escapeQuery(name)}'`,
    `'${escapeQuery(parentId)}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
  ].join(" and ");

  try {
    const search = await fetch(
      `${API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${token.value}` }, cache: "no-store" },
    );
    const found = await search.json();
    if (!search.ok) {
      return err(
        `Drive folder lookup failed: ${found.error?.message ?? search.statusText}`,
      );
    }
    if (found.files?.[0]?.id) return ok(found.files[0].id as string);

    const created = await fetch(`${API}/files?fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    const body = await created.json();
    if (!created.ok) {
      return err(
        `Could not create Drive folder "${name}": ${body.error?.message ?? created.statusText}`,
      );
    }
    return ok(body.id as string);
  } catch (cause) {
    return err(
      `Drive folder error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * The root folder everything is filed under.
 *
 * An explicit GOOGLE_DRIVE_ROOT_FOLDER_ID wins; otherwise a "Litwalls Posters"
 * folder is found or created at the top of My Drive.
 */
export async function ensureRootFolder(): Promise<Result<string>> {
  const configured = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (configured) return ok(configured);
  return ensureFolder("Litwalls Posters", "root");
}

/** Walk a path of folder names, creating what is missing. */
export async function ensureFolderPath(
  segments: string[],
): Promise<Result<string>> {
  const root = await ensureRootFolder();
  if (!root.ok) return root;

  let parent = root.value;
  for (const segment of segments) {
    const folder = await ensureFolder(segment, parent);
    if (!folder.ok) return folder;
    parent = folder.value;
  }
  return ok(parent);
}

/** 8MB chunks — a multiple of Drive's required 256KB granularity. */
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Upload a file with a resumable session.
 *
 * These are 10-40MB masters. A single multipart POST of that size over a
 * domestic connection fails often enough to matter, and losing an upload
 * halfway through a twenty-poster batch with no way to resume is a bad
 * evening.
 *
 * Two steps: POST for a session URI, then PUT the bytes in chunks with
 * Content-Range. A 308 means "keep going", and the Range header in that 308
 * says how much actually landed — which is what we resume from, NOT what we
 * think we sent. Those can differ, and trusting the local count is how a file
 * ends up silently truncated.
 */
export async function uploadFile(options: {
  localPath: string;
  name: string;
  parentId: string;
  mimeType: string;
  onProgress?: (sent: number, total: number) => void;
}): Promise<Result<string>> {
  const token = await getAccessToken();
  if (!token.ok) return token;

  let total: number;
  try {
    total = (await stat(options.localPath)).size;
  } catch (cause) {
    return err(
      `Cannot read ${options.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  let sessionUrl: string;
  try {
    const start = await fetch(
      `${UPLOAD_API}/files?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.value}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": options.mimeType,
          "X-Upload-Content-Length": String(total),
        },
        body: JSON.stringify({
          name: options.name,
          parents: [options.parentId],
        }),
      },
    );

    if (!start.ok) {
      const body = await start.text();
      return err(
        `Could not start upload of ${options.name}: ${start.status} ${body.slice(0, 200)}`,
      );
    }

    const location = start.headers.get("location");
    if (!location) return err("Drive returned no upload session URL");
    sessionUrl = location;
  } catch (cause) {
    return err(
      `Upload start failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  let offset = 0;
  let attempts = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total) - 1;
    const chunk = await readRange(options.localPath, offset, end);

    try {
      const response = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${offset}-${end}/${total}`,
        },
        body: new Uint8Array(chunk),
      });

      if (response.status === 200 || response.status === 201) {
        const body = await response.json();
        options.onProgress?.(total, total);
        return ok(body.id as string);
      }

      if (response.status === 308) {
        // Resume from what Drive says it has, not from what we sent.
        const range = response.headers.get("range");
        const received = range ? Number(range.split("-")[1]) + 1 : end + 1;
        offset = Number.isFinite(received) ? received : end + 1;
        attempts = 0;
        options.onProgress?.(offset, total);
        continue;
      }

      // 5xx is worth retrying; anything else is a request problem that would
      // fail identically however many times we send it.
      if (response.status >= 500 && attempts < 3) {
        attempts += 1;
        await sleep(1000 * attempts);
        continue;
      }

      const body = await response.text();
      return err(
        `Upload of ${options.name} failed: ${response.status} ${body.slice(0, 200)}`,
      );
    } catch (cause) {
      if (attempts < 3) {
        attempts += 1;
        await sleep(1000 * attempts);
        continue;
      }
      return err(
        `Upload of ${options.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  return err(`Upload of ${options.name} ended without confirmation`);
}

function readRange(path: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(path, { start, end })
      .on("data", (chunk) => chunks.push(chunk as Buffer))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
