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

/**
 * Every Drive call has a deadline. A fetch with none can hang forever on a
 * half-dead connection, and one hung upload would hold a queue slot — and so
 * every poster behind it — indefinitely, which looks exactly like "nothing
 * is uploading" with no error anywhere.
 */
const METADATA_TIMEOUT_MS = 60_000;
const CHUNK_TIMEOUT_MS = 5 * 60_000;

const DRIVE_FULL =
  "Google Drive is full (storageQuotaExceeded). Free up space or add storage, then re-file.";

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
      {
        headers: { Authorization: `Bearer ${token.value}` },
        cache: "no-store",
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      },
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
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
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
 * The id of a file already in a folder with this name AND exactly this size.
 *
 * A resumable upload only creates the file once its last byte lands, so a
 * file that exists is a complete one. That makes this the guard against
 * duplicates: if the process dies after Drive finished a file but before its
 * id was saved locally, the retry finds it here instead of uploading it again.
 *
 * The size has to match too, not just the name: every poster's files are
 * called A3.png, A4.png… so a name alone cannot tell this poster's file from
 * another's that ended up in the same folder.
 */
export async function findFile(
  name: string,
  parentId: string,
  size: number,
): Promise<Result<string | null>> {
  const token = await getAccessToken();
  if (!token.ok) return token;

  const query = [
    `name = '${escapeQuery(name)}'`,
    `'${escapeQuery(parentId)}' in parents`,
    `mimeType != '${FOLDER_MIME}'`,
    "trashed = false",
  ].join(" and ");

  try {
    const search = await fetch(
      `${API}/files?q=${encodeURIComponent(query)}&fields=files(id,size)&pageSize=50`,
      {
        headers: { Authorization: `Bearer ${token.value}` },
        cache: "no-store",
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      },
    );
    const found = await search.json();
    if (!search.ok) {
      return err(`Drive file lookup failed: ${found.error?.message ?? search.statusText}`);
    }
    const match = (found.files as { id: string; size?: string }[] | undefined)?.find(
      (file) => Number(file.size) === size,
    );
    return ok(match?.id ?? null);
  } catch (cause) {
    return err(
      `Drive file lookup error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** The private property that ties a Drive folder to one poster's product. */
const PRODUCT_PROPERTY = "litwallsProduct";

async function driveJson(
  url: string,
  init: RequestInit & { label: string },
): Promise<Result<Record<string, unknown>>> {
  const token = await getAccessToken();
  if (!token.ok) return token;
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.value}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    const body = await response.json();
    if (!response.ok) {
      return err(`${init.label}: ${body.error?.message ?? response.statusText}`);
    }
    return ok(body);
  } catch (cause) {
    return err(`${init.label}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * The folder tagged as this product's, under a parent.
 *
 * Found by an app-private property rather than by name: two products can carry
 * the same title, and Drive matches names case-insensitively, so a name lookup
 * can hand one poster another poster's folder — which is how files from three
 * different "Ferrari F1" posters ended up side by side in one.
 */
export async function findProductFolder(
  productKey: string,
  parentId: string,
): Promise<Result<string | null>> {
  const query = [
    `appProperties has { key='${PRODUCT_PROPERTY}' and value='${escapeQuery(productKey)}' }`,
    `'${escapeQuery(parentId)}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
  ].join(" and ");
  const found = await driveJson(
    `${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`,
    { label: "Drive folder lookup failed" },
  );
  if (!found.ok) return found;
  const files = found.value.files as { id: string }[] | undefined;
  return ok(files?.[0]?.id ?? null);
}

/** The ids of every file (not folder) directly inside a folder. */
export async function listFolderFileIds(folderId: string): Promise<Result<string[]>> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const query = [
      `'${escapeQuery(folderId)}' in parents`,
      `mimeType != '${FOLDER_MIME}'`,
      "trashed = false",
    ].join(" and ");
    const page = await driveJson(
      `${API}/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id)&pageSize=1000${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
      }`,
      { label: "Drive folder listing failed" },
    );
    if (!page.ok) return page;
    ids.push(...((page.value.files as { id: string }[] | undefined) ?? []).map((f) => f.id));
    pageToken = (page.value.nextPageToken as string | undefined) ?? "";
  } while (pageToken);
  return ok(ids);
}

/** Create a folder tagged as this product's. */
export async function createProductFolder(
  name: string,
  parentId: string,
  productKey: string,
): Promise<Result<string>> {
  const created = await driveJson(`${API}/files?fields=id`, {
    label: `Could not create Drive folder "${name}"`,
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties: { [PRODUCT_PROPERTY]: productKey },
    }),
  });
  if (!created.ok) return created;
  return ok(created.value.id as string);
}

/**
 * Take over an existing folder for this product: rename it and tag it. Only
 * succeeds if the folder still exists, is not trashed, and sits under the
 * expected parent — otherwise the caller makes a fresh one.
 */
export async function claimFolder(
  folderId: string,
  name: string,
  parentId: string,
  productKey: string,
): Promise<Result<boolean>> {
  const current = await driveJson(
    `${API}/files/${encodeURIComponent(folderId)}?fields=id,parents,trashed,mimeType`,
    { label: "Drive folder check failed" },
  );
  if (!current.ok) return ok(false); // gone, or not ours to see
  const parents = current.value.parents as string[] | undefined;
  if (
    current.value.trashed ||
    current.value.mimeType !== FOLDER_MIME ||
    !parents?.includes(parentId)
  ) {
    return ok(false);
  }
  const updated = await driveJson(
    `${API}/files/${encodeURIComponent(folderId)}?fields=id`,
    {
      label: "Could not update Drive folder",
      method: "PATCH",
      body: JSON.stringify({ name, appProperties: { [PRODUCT_PROPERTY]: productKey } }),
    },
  );
  if (!updated.ok) return updated;
  return ok(true);
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

/** Retries per chunk before the upload is given up (the queue retries later). */
const CHUNK_RETRIES = 5;

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
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      },
    );

    if (!start.ok) {
      const body = await start.text();
      // Spelled out because the raw 403 reads like a permissions problem, and
      // it is the one failure no retry or reconnect will fix.
      if (/storageQuotaExceeded/i.test(body)) return err(DRIVE_FULL);
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
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });

      if (response.status === 200 || response.status === 201) {
        const body = await response.json();
        options.onProgress?.(total, total);
        return ok(body.id as string);
      }

      if (response.status === 308) {
        // Resume from what Drive says it has, not from what we sent.
        const range = response.headers.get("range");
        const received = range ? Number(range.split("-")[1]) + 1 : 0;
        offset = Number.isFinite(received) ? received : 0;
        attempts = 0;
        options.onProgress?.(offset, total);
        continue;
      }

      const body = await response.text();
      if (/storageQuotaExceeded/i.test(body)) return err(DRIVE_FULL);

      // 5xx, 429 and Drive's rate-limit 403s are transient; anything else is
      // a request problem that would fail identically however often we sent it.
      const transient =
        response.status >= 500 ||
        response.status === 429 ||
        (response.status === 403 && /rateLimitExceeded/i.test(body));
      if (transient && attempts < CHUNK_RETRIES) {
        attempts += 1;
        await sleep(2000 * 2 ** attempts);
        offset = await confirmedOffset(sessionUrl, total, offset);
        continue;
      }

      return err(
        `Upload of ${options.name} failed: ${response.status} ${body.slice(0, 200)}`,
      );
    } catch (cause) {
      // A timeout or dropped connection: ask Drive how much actually landed
      // and carry on from there rather than resending what it already has.
      if (attempts < CHUNK_RETRIES) {
        attempts += 1;
        await sleep(2000 * 2 ** attempts);
        offset = await confirmedOffset(sessionUrl, total, offset);
        continue;
      }
      return err(
        `Upload of ${options.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  return err(`Upload of ${options.name} ended without confirmation`);
}

/**
 * Ask a resumable session how many bytes it holds — an empty PUT with
 * `bytes * /total`. Falls back to the caller's offset if Drive cannot say.
 */
async function confirmedOffset(
  sessionUrl: string,
  total: number,
  fallback: number,
): Promise<number> {
  try {
    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Length": "0", "Content-Range": `bytes */${total}` },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (response.status !== 308) return fallback;
    const range = response.headers.get("range");
    if (!range) return 0;
    const received = Number(range.split("-")[1]) + 1;
    return Number.isFinite(received) ? received : fallback;
  } catch {
    return fallback;
  }
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
