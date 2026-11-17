/**
 * Runs 4x-UltraSharp ONNX inference for one poster at a time, in its own OS
 * process.
 *
 * onnxruntime-node's `session.run()` is scheduled via `setImmediate`, but the
 * inference call underneath it is synchronous native code: it blocks whatever
 * thread calls it for the call's full duration, which for a poster is the
 * better part of a minute. This app runs as a single Node process
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
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// onnxruntime-node hands a half-precision tensor to its native side as a
// Float16Array wherever the runtime has one, and on Node 24 the native side
// then reads that array as zero bytes long ("not enough space: expected N,
// got 0"). With the global gone it falls back to a Uint16Array of raw half
// bits, which works on every version. Nothing else in this process uses the
// type, and the import has to come after the delete, hence not a static one.
delete globalThis.Float16Array;
const { InferenceSession, Tensor } = await import("onnxruntime-node");

const MODELS_DIR = join(process.cwd(), "models");
const MODEL_FP32 = join(MODELS_DIR, "4x-UltraSharp.onnx");
/** Same weights at half precision — see fetch-upscale-model.mjs. */
const MODEL_FP16 = join(MODELS_DIR, "4x-UltraSharp-fp16.onnx");
const SCALE = 4;

/**
 * Largest tile edge fed to the model, in source pixels.
 *
 * The model costs the same per pixel at any tile size, so a bigger tile buys
 * nothing by itself — what it saves is overlap, which is pixels computed
 * twice. At 128 a third of all the work was overlap; at 256 it is an eighth.
 * Past 256 the saving flattens out while the memory one tile needs keeps
 * quadrupling. `UPSCALE_TILE_SIZE` lowers it for a GPU that runs out.
 */
const MAX_TILE = Math.max(64, Number(process.env.UPSCALE_TILE_SIZE) || 256);

/**
 * How far neighbouring tiles overlap, in source pixels.
 *
 * The model sees nothing past a tile's edge, so the texture it invents there
 * differs from what the neighbouring tile invents for the same pixels —
 * measured against an untiled run, by about four levels in every channel.
 * Butting two tiles together at a hard cut shows that as a faint grid, so the
 * overlap is cross-faded instead (see `rampWeights`), which also gives each
 * tile's least reliable pixels, the ones at its very edge, the least say.
 */
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

/**
 * Half precision on the GPU, full precision on CPU.
 *
 * A GPU runs the half-precision weights about 1.5x faster for a picture that
 * differs by a level here and there. A CPU has no half-precision arithmetic to
 * speak of and would only convert back and forth, so it keeps the original.
 */
function gpuModelPath() {
  return existsSync(MODEL_FP16) ? MODEL_FP16 : MODEL_FP32;
}

function createGpuSession(deviceId) {
  return InferenceSession.create(gpuModelPath(), {
    executionProviders: [{ name: "dml", deviceId }],
    // Both are requirements of the DirectML provider, not tuning.
    enableMemPattern: false,
    executionMode: "sequential",
  });
}

function isHalf(session) {
  return session.inputMetadata[0].type === "float16";
}

function inputTensor(session, data, width, height) {
  return new Tensor(isHalf(session) ? "float16" : "float32", data, [
    1,
    3,
    height,
    width,
  ]);
}

async function probeMs(session) {
  const length = 3 * PROBE_SIZE * PROBE_SIZE;
  const feed = () => ({
    input: inputTensor(
      session,
      isHalf(session) ? new Uint16Array(length) : new Float32Array(length),
      PROBE_SIZE,
      PROBE_SIZE,
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

  return InferenceSession.create(MODEL_FP32, {
    executionProviders: ["cpu"],
    ...(intraOpNumThreads ? { intraOpNumThreads } : {}),
  });
}

let sessionPromise = null;
function getSession() {
  if (!sessionPromise) sessionPromise = createSession();
  return sessionPromise;
}

const halfScratch = new Float32Array(1);
const halfScratchBits = new Uint32Array(halfScratch.buffer);

/** IEEE 754 half-precision bits for a number in the model's 0..1 input range. */
function toHalfBits(value) {
  halfScratch[0] = value;
  const bits = halfScratchBits[0];
  const exponent = ((bits >>> 23) & 0xff) - 112;
  if (exponent <= 0) return 0;
  // Round to nearest by adding half of the last bit kept; a carry out of the
  // mantissa lands in the exponent, which is exactly where it belongs.
  return ((exponent << 10) | ((bits >>> 13) & 0x3ff)) + ((bits >>> 12) & 1);
}

function fromHalfBits(bits) {
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  const magnitude =
    exponent === 0
      ? mantissa * 2 ** -24
      : exponent === 31
        ? mantissa
          ? NaN
          : Infinity
        : (1 + mantissa / 1024) * 2 ** (exponent - 15);
  return bits & 0x8000 ? -magnitude : magnitude;
}

function clampLevel(value) {
  // A NaN from the model becomes black rather than poisoning the blend.
  return value > 255 ? 255 : value > 0 ? value : 0;
}

/**
 * Every pixel is one of 256 bytes going in, and at half precision one of
 * 65536 bit patterns coming out, so both conversions are table lookups
 * instead of arithmetic repeated for each of a poster's fifty million values.
 */
const BYTE_TO_FLOAT = Float32Array.from({ length: 256 }, (_, i) => i / 255);
const BYTE_TO_HALF = Uint16Array.from(BYTE_TO_FLOAT, toHalfBits);
const HALF_TO_LEVEL = Float32Array.from({ length: 65536 }, (_, bits) =>
  clampLevel(fromHalfBits(bits) * 255),
);

/**
 * How one axis of the image is cut into tiles.
 *
 * Every tile is the same size, chosen so the row of them covers the axis
 * exactly with OVERLAP between neighbours. Fixed-size tiles stepped along at a
 * fixed stride leave a narrow remainder at the far edge instead — a sliver of
 * a tile, where the model has almost no context to work from.
 */
function tileLayout(dim) {
  if (dim <= MAX_TILE) return { size: dim, starts: [0] };
  const count = Math.ceil((dim - OVERLAP) / (MAX_TILE - OVERLAP));
  const size = Math.ceil((dim + (count - 1) * OVERLAP) / count);
  const starts = Array.from({ length: count }, (_, i) =>
    Math.round((i * (dim - size)) / (count - 1)),
  );
  return { size, starts };
}

/**
 * Blend weights along one axis of one tile's output: 1 through the middle,
 * ramping to 0 across whatever it shares with each neighbour.
 *
 * The ramps of two neighbours mirror each other, so they sum to 1 at every
 * pixel and the overlap comes out as a cross-fade from one tile to the next.
 */
function rampWeights({ size, starts }, index) {
  const weights = new Float32Array(size * SCALE).fill(1);
  if (index > 0) {
    const shared = (starts[index - 1] + size - starts[index]) * SCALE;
    for (let i = 0; i < shared; i++) weights[i] = (i + 0.5) / shared;
  }
  if (index < starts.length - 1) {
    const shared = (starts[index] + size - starts[index + 1]) * SCALE;
    for (let i = 0; i < shared; i++) {
      weights[weights.length - 1 - i] = (i + 0.5) / shared;
    }
  }
  return weights;
}

/** Interleaved RGB bytes out of the source, planar and 0..1 as the model wants. */
function tileInput(session, rgb, width, left, top, tileW, tileH) {
  const half = isHalf(session);
  const table = half ? BYTE_TO_HALF : BYTE_TO_FLOAT;
  const plane = tileW * tileH;
  const data = half ? new Uint16Array(3 * plane) : new Float32Array(3 * plane);
  for (let row = 0; row < tileH; row++) {
    let src = ((top + row) * width + left) * 3;
    let dst = row * tileW;
    for (let col = 0; col < tileW; col++, src += 3, dst++) {
      data[dst] = table[rgb[src]];
      data[plane + dst] = table[rgb[src + 1]];
      data[2 * plane + dst] = table[rgb[src + 2]];
    }
  }
  return inputTensor(session, data, tileW, tileH);
}

async function aiUpscale4x(sourcePath, destPath) {
  const session = await getSession();
  const half = isHalf(session);

  const image = sharp(sourcePath).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const outWidth = width * SCALE;
  const outHeight = height * SCALE;
  const outBuffer = Buffer.alloc(outWidth * outHeight * 3);

  const columns = tileLayout(width);
  const rows = tileLayout(height);
  const columnWeights = columns.starts.map((_, i) => rampWeights(columns, i));
  const upW = columns.size * SCALE;
  const upH = rows.size * SCALE;
  const upPlane = upW * upH;

  // One row of tiles at a time, cross-faded sideways into `band` at full
  // precision, then the finished band is cross-faded down onto the rows
  // already in the output. A blend is the same whichever axis goes first, and
  // doing it a band at a time needs a fraction of the memory that holding the
  // whole poster in floats would.
  const band = new Float32Array(outWidth * upH * 3);

  for (let rowIndex = 0; rowIndex < rows.starts.length; rowIndex++) {
    const top = rows.starts[rowIndex];
    band.fill(0);

    for (let colIndex = 0; colIndex < columns.starts.length; colIndex++) {
      const left = columns.starts[colIndex];
      const result = await session.run({
        input: tileInput(session, data, width, left, top, columns.size, rows.size),
      });
      const output = result.output.data;
      const weights = columnWeights[colIndex];

      for (let y = 0; y < upH; y++) {
        let src = y * upW;
        let dst = (y * outWidth + left * SCALE) * 3;
        for (let x = 0; x < upW; x++, src++) {
          const weight = weights[x];
          if (half) {
            band[dst++] += weight * HALF_TO_LEVEL[output[src]];
            band[dst++] += weight * HALF_TO_LEVEL[output[upPlane + src]];
            band[dst++] += weight * HALF_TO_LEVEL[output[2 * upPlane + src]];
          } else {
            band[dst++] += weight * clampLevel(output[src] * 255);
            band[dst++] += weight * clampLevel(output[upPlane + src] * 255);
            band[dst++] += weight * clampLevel(output[2 * upPlane + src] * 255);
          }
        }
      }
    }

    // Only the ramp shared with the row above matters here: the rows shared
    // with the row below are written whole now and faded over by that row
    // when its turn comes.
    const weights = rampWeights(rows, rowIndex);
    const shared =
      rowIndex === 0 ? 0 : (rows.starts[rowIndex - 1] + rows.size - top) * SCALE;
    const rowLength = outWidth * 3;
    for (let y = 0; y < upH; y++) {
      const src = y * rowLength;
      const dst = (top * SCALE + y) * rowLength;
      if (y < shared) {
        const weight = weights[y];
        for (let i = 0; i < rowLength; i++) {
          outBuffer[dst + i] =
            outBuffer[dst + i] * (1 - weight) + band[src + i] * weight + 0.5;
        }
      } else {
        for (let i = 0; i < rowLength; i++) outBuffer[dst + i] = band[src + i] + 0.5;
      }
    }
  }

  // Barely compressed: this file is read back once by the parent and deleted,
  // so the seconds a tighter PNG takes to write would buy nothing.
  await sharp(outBuffer, { raw: { width: outWidth, height: outHeight, channels: 3 } })
    .png({ compressionLevel: 1 })
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
