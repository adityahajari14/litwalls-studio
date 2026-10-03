/**
 * Runs 4x-UltraSharp ONNX inference for one poster at a time, in its own OS
 * process.
 *
 * onnxruntime-node's `session.run()` is scheduled via `setImmediate`, but the
 * inference call underneath it is synchronous native code: it blocks whatever
 * thread calls it for the call's full duration, which for a multi-megapixel
 * poster tiled at 128px is minutes. This app runs as a single Node process
 * (`next dev` / `next start`) serving every request, including the batch
 * page's own SSE stream — running that call in-process freezes the whole
 * server for as long as the model runs. Forking it out here is what keeps the
 * server able to answer requests while the heavy work happens elsewhere; see
 * upscale-pool.ts for the parent side that manages a pool of these.
 *
 * Talks to its parent over the IPC channel `fork()` sets up automatically:
 * receives `{ id, sourcePath, destPath }`, replies `{ id, result }` or
 * `{ id, error }`.
 */
import { InferenceSession, Tensor } from "onnxruntime-node";
import { join } from "node:path";
import sharp from "sharp";

const MODEL_PATH = join(process.cwd(), "models", "4x-UltraSharp.onnx");
const SCALE = 4;
const TILE_SIZE = 128;
const OVERLAP = 16;

/**
 * Where inference runs, chosen by the parent (see upscale-pool.ts): "gpu" asks
 * for DirectML, which ships inside onnxruntime-node on Windows and drives any
 * Direct3D 12 adapter, integrated graphics included.
 */
const useGpu = process.env.UPSCALE_DEVICE === "gpu";

/**
 * Set by the parent so N sibling CPU processes divide the machine's cores
 * between them instead of each defaulting to all of them and fighting over
 * cache and scheduler time.
 */
const intraOpNumThreads = Number(process.env.UPSCALE_INTRA_OP_THREADS) || undefined;

/** Set to pin one adapter by its DirectML index instead of timing them all. */
const pinnedAdapter =
  process.env.UPSCALE_GPU_DEVICE_ID === undefined ||
  process.env.UPSCALE_GPU_DEVICE_ID === ""
    ? null
    : Number(process.env.UPSCALE_GPU_DEVICE_ID);

/** More adapters than any machine this runs on will have; indexes past the last one just fail fast. */
const MAX_ADAPTERS = 4;

/** Small enough to cost a fraction of a second per adapter, big enough to tell them apart. */
const PROBE_SIZE = 64;

function createGpuSession(deviceId) {
  return InferenceSession.create(MODEL_PATH, {
    executionProviders: [{ name: "dml", deviceId }],
    // Both are requirements of the DirectML provider, not tuning.
    enableMemPattern: false,
    executionMode: "sequential",
  });
}

async function probeMs(session) {
  const feed = () => ({
    input: new Tensor(
      "float32",
      new Float32Array(3 * PROBE_SIZE * PROBE_SIZE),
      [1, 3, PROBE_SIZE, PROBE_SIZE],
    ),
  });
  // The first run pays for shader compilation, and on a laptop for waking a
  // sleeping discrete card; only the second says how fast the adapter is.
  await session.run(feed());
  const start = performance.now();
  await session.run(feed());
  return performance.now() - start;
}

/**
 * A session on whichever adapter actually runs the model fastest.
 *
 * DirectML's default is adapter 0, and on a laptop with both integrated
 * graphics and a discrete card that is normally the integrated one, because
 * it drives the display. The provider only takes an index — there is no "the
 * fast one" option, and no adapter names to match on — so each adapter is
 * timed on one small tile and the winner kept.
 */
async function fastestGpuSession() {
  let best = null;
  const timings = [];

  for (let deviceId = 0; deviceId < MAX_ADAPTERS; deviceId++) {
    let session;
    try {
      session = await createGpuSession(deviceId);
      const ms = await probeMs(session);
      timings.push(`#${deviceId} ${Math.round(ms)}ms`);
      if (!best || ms < best.ms) {
        await best?.session.release();
        best = { session, ms, deviceId };
        session = null;
      }
    } catch {
      // No adapter at this index, or one DirectML refuses (the software
      // renderer). Not necessarily the end of the list, so keep going.
    }
    await session?.release();
  }

  if (!best) throw new Error("no DirectML adapter could run the model");
  console.log(
    `[upscale] using GPU adapter #${best.deviceId} (probe: ${timings.join(", ")})`,
  );
  return best.session;
}

async function createSession() {
  if (useGpu) {
    try {
      return pinnedAdapter === null
        ? await fastestGpuSession()
        : await createGpuSession(pinnedAdapter);
    } catch (cause) {
      // No usable adapter or driver. Same weights on CPU give the same picture,
      // only slower, so that beats failing every poster in the batch.
      console.warn(
        `[upscale] GPU unavailable, falling back to CPU: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  return InferenceSession.create(MODEL_PATH, {
    executionProviders: ["cpu"],
    ...(intraOpNumThreads ? { intraOpNumThreads } : {}),
  });
}

let sessionPromise = null;
function getSession() {
  if (!sessionPromise) sessionPromise = createSession();
  return sessionPromise;
}

/** RGB planar float32 in 0..1, the layout both sharp's raw output and the model use once transposed. */
function toPlanarFloat(buffer, width, height) {
  const out = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    out[i] = buffer[i * 3] / 255;
    out[plane + i] = buffer[i * 3 + 1] / 255;
    out[2 * plane + i] = buffer[i * 3 + 2] / 255;
  }
  return out;
}

function fromPlanarFloat(data, width, height) {
  const out = Buffer.alloc(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    out[i * 3] = clamp255(data[i] * 255);
    out[i * 3 + 1] = clamp255(data[plane + i] * 255);
    out[i * 3 + 2] = clamp255(data[2 * plane + i] * 255);
  }
  return out;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

async function runTile(session, rgb, width, height) {
  const planar = toPlanarFloat(rgb, width, height);
  const input = new Tensor("float32", planar, [1, 3, height, width]);
  const result = await session.run({ input });
  const output = result.output;
  const outHeight = output.dims[2];
  const outWidth = output.dims[3];
  const data = fromPlanarFloat(output.data, outWidth, outHeight);
  return { data, width: outWidth, height: outHeight };
}

/**
 * Tile starts along one axis, stopping as soon as a tile reaches the far
 * edge rather than stepping past it — see ai-upscale.ts's original comment
 * on why a plain `for (t += stride)` loop is wrong here.
 */
function tileStarts(dim, stride) {
  const starts = [];
  for (let t = 0; t < dim; t += stride) {
    starts.push(t);
    if (t + TILE_SIZE >= dim) break;
  }
  return starts;
}

async function aiUpscale4x(sourcePath, destPath) {
  const session = await getSession();

  const image = sharp(sourcePath).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const outWidth = width * SCALE;
  const outHeight = height * SCALE;
  const outBuffer = Buffer.alloc(outWidth * outHeight * 3);

  const stride = TILE_SIZE - OVERLAP;

  for (const ty of tileStarts(height, stride)) {
    for (const tx of tileStarts(width, stride)) {
      const tileW = Math.min(TILE_SIZE, width - tx);
      const tileH = Math.min(TILE_SIZE, height - ty);

      const tileRgb = Buffer.alloc(tileW * tileH * 3);
      for (let row = 0; row < tileH; row++) {
        const srcOffset = ((ty + row) * width + tx) * 3;
        const dstOffset = row * tileW * 3;
        data.copy(tileRgb, dstOffset, srcOffset, srcOffset + tileW * 3);
      }

      const { data: upTile, width: upW, height: upH } = await runTile(
        session,
        tileRgb,
        tileW,
        tileH,
      );

      const marginPx = (OVERLAP / 2) * SCALE;
      const cropLeft = tx > 0 ? marginPx : 0;
      const cropTop = ty > 0 ? marginPx : 0;
      const cropRight = tx + tileW < width ? marginPx : 0;
      const cropBottom = ty + tileH < height ? marginPx : 0;

      const pasteX = tx * SCALE + cropLeft;
      const pasteY = ty * SCALE + cropTop;
      const pasteW = upW - cropLeft - cropRight;
      const pasteH = upH - cropTop - cropBottom;

      for (let row = 0; row < pasteH; row++) {
        const srcOffset = ((row + cropTop) * upW + cropLeft) * 3;
        const dstOffset = ((pasteY + row) * outWidth + pasteX) * 3;
        upTile.copy(outBuffer, dstOffset, srcOffset, srcOffset + pasteW * 3);
      }
    }
  }

  await sharp(outBuffer, { raw: { width: outWidth, height: outHeight, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toFile(destPath);

  return { width: outWidth, height: outHeight };
}

process.on("message", async (msg) => {
  const { id, sourcePath, destPath } = msg;
  try {
    const result = await aiUpscale4x(sourcePath, destPath);
    process.send({ id, result });
  } catch (cause) {
    process.send({
      id,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
});
