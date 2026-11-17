/**
 * Download the 4x-UltraSharp ONNX weights used by the AI upscale stage.
 *
 * Not committed to git: they are binaries of 34MB and 67MB, unlike everything
 * else in this repo, and they never change once fetched. `npm run
 * models:fetch` (or the postinstall hook) pulls them from Hugging Face
 * straight into `models/`, which is gitignored the same way `workspace/` is.
 *
 * Two copies of the same weights: full precision, which is what a CPU runs,
 * and half precision, which a GPU gets through about 1.5x faster for the same
 * picture (see scripts/upscale-worker.mjs).
 *
 * Requires a commercial license for 4x-UltraSharp (CC-BY-NC-SA-4.0 is
 * non-commercial) — see MODEL_LICENSE.md before deploying this anywhere the
 * output is sold.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODELS_DIR = join(ROOT, "models");

const BASE_URL = "https://huggingface.co/Kim2091/UltraSharp/resolve/main/ONNX";

const MODELS = [
  { file: "4x-UltraSharp.onnx", remote: "4x-UltraSharp-fp32-opset14.onnx", size: "~67MB" },
  { file: "4x-UltraSharp-fp16.onnx", remote: "4x-UltraSharp-fp16-opset17.onnx", size: "~34MB" },
];

async function fetchModel({ file, remote, size }) {
  const dest = join(MODELS_DIR, file);
  if (existsSync(dest)) {
    console.log(`Model already present at ${dest}, skipping download.`);
    return;
  }

  console.log(`Downloading ${file} (${size})...`);

  const res = await fetch(`${BASE_URL}/${remote}`);
  if (!res.ok || !res.body) {
    throw new Error(`Download of ${file} failed: ${res.status} ${res.statusText}`);
  }

  const tmp = `${dest}.download`;
  await pipeline(res.body, createWriteStream(tmp));
  renameSync(tmp, dest);

  console.log(`Saved to ${dest}`);
}

async function main() {
  mkdirSync(MODELS_DIR, { recursive: true });
  for (const model of MODELS) await fetchModel(model);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
