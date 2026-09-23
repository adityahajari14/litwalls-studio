import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { upscaleAssetInPlace } from "@/lib/image/upscale-asset";
import {
  libraryPath,
  libraryUploadId,
  loadLibrary,
} from "@/lib/library/load";
import {
  clearLibraryProcessing,
  libraryProcessingIds,
  markLibraryProcessing,
} from "@/lib/library/processing";
import { PRODUCT_IMAGES_DIR, ensureDir } from "@/lib/pipeline/paths";
import { runBackground } from "@/lib/tasks";

export async function GET() {
  const [images, processing] = await Promise.all([
    loadLibrary(),
    libraryProcessingIds(),
  ]);
  return Response.json({ images, processing });
}

/**
 * Add a shared image from the dashboard.
 *
 * A Route Handler, not a Server Action: a quality panel can be a full-size
 * photo, well past the 1MB Server Action body cap. Streamed to disk like the
 * batch ingest route for the same reason.
 *
 * The file is written first, then an upscale is kicked off in the background —
 * the response returns immediately with the new entry and a `processing` flag,
 * and the library page polls until the sharpening finishes.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (cause) {
    return Response.json(
      { error: `Could not read the upload: ${cause instanceof Error ? cause.message : String(cause)}` },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose an image file." }, { status: 400 });
  }

  let id: string;
  try {
    id = await libraryUploadId(file.name);
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 400 },
    );
  }

  try {
    await ensureDir(PRODUCT_IMAGES_DIR);
    const source = Readable.fromWeb(
      file.stream() as NodeWebReadableStream,
    );
    await pipeline(source, createWriteStream(libraryPath(id)));
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 500 },
    );
  }

  // Sanity-check it decodes, and read the entry back for the response.
  const entry = (await loadLibrary()).find((image) => image.id === id);
  if (!entry) {
    return Response.json(
      { error: "That file could not be read as an image." },
      { status: 400 },
    );
  }

  void markLibraryProcessing(id);
  void runBackground(`library-upscale:${id}`, async () => {
    try {
      await upscaleAssetInPlace(libraryPath(id), { encode: "keep" });
    } finally {
      await clearLibraryProcessing(id);
    }
  });

  return Response.json({ image: entry, processing: true }, { status: 201 });
}
