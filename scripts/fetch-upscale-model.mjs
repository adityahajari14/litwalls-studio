/**
 * Download the 4x-UltraSharp ONNX weights used by the AI upscale stage.
 *
 * Not committed to git: it is a ~67MB binary, unlike everything else in this
 * repo, and it never changes once fetched. `npm run models:fetch` (or the
 * postinstall hook) pulls it from Hugging Face straight into `models/`, which
 * is gitignored the same way `workspace/` is.
 *
 * Requires a commercial license for 4x-UltraSharp (CC-BY-NC-SA-4.0 is
 * non-commercial) — see MODEL_LICENSE.md before deploying this anywhere the
 * output is sold.
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODELS_DIR = join(ROOT, "models");
const DEST = join(MODELS_DIR, "4x-UltraSharp.onnx");

const URL =
  "https://huggingface.co/Kim2091/UltraSharp/resolve/main/ONNX/4x-UltraSharp-fp32-opset14.onnx";

async function main() {
  if (existsSync(DEST)) {
    console.log(`Model already present at ${DEST}, skipping download.`);
    return;
  }

  mkdirSync(MODELS_DIR, { recursive: true });
  console.log(`Downloading 4x-UltraSharp ONNX weights (~67MB)...`);

  const res = await fetch(URL);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const tmp = `${DEST}.download`;
  await pipeline(res.body, createWriteStream(tmp));
  const { renameSync } = await import("node:fs");
  renameSync(tmp, DEST);

  console.log(`Saved to ${DEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
