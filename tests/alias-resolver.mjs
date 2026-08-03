/**
 * Resolver hook mapping "@/x" to "<project>/src/x", mirroring the `paths`
 * entry in tsconfig.json. Runs on Node's loader thread; see alias-hook.mjs.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);

/**
 * Source files import extensionless ("@/lib/print/sizes") because that is what
 * the bundler expects. Node resolves real files, so the extension has to be
 * put back — .ts first since that is what everything here is.
 */
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".json"];

export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const base = new URL(specifier.slice(2), SRC);

  // An explicit extension that exists wins outright.
  if (existsSync(fileURLToPath(base))) {
    return { url: base.href, shortCircuit: true };
  }

  for (const ext of EXTENSIONS) {
    const candidate = pathToFileURL(`${fileURLToPath(base)}${ext}`);
    if (existsSync(candidate)) {
      return { url: candidate.href, shortCircuit: true };
    }
  }

  // Fall through rather than throwing: a genuinely missing module should fail
  // with Node's own error, which names the importer.
  return nextResolve(specifier, context);
}
