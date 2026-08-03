import "server-only";

import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { TEMPLATES_DIR } from "@/lib/pipeline/paths";
import { validateTemplate } from "@/lib/templates/schema";
import type { MockupTemplate } from "@/lib/print/types";

/**
 * Read the mockup template library from disk.
 *
 * Templates are committed content the user curates by hand — a folder with a
 * background image and a template.json. Read fresh on every call rather than
 * cached: this is a local tool, the library is small, and a stale cache after
 * editing a JSON file by hand would be far more annoying than the read.
 */

export type TemplateEntry =
  | { id: string; ok: true; template: MockupTemplate }
  /** A folder that exists but is not usable yet — surfaced in the UI so a
   *  half-authored template is visible rather than silently ignored. */
  | { id: string; ok: false; errors: string[]; hasBackground: boolean };

export async function loadTemplates(): Promise<TemplateEntry[]> {
  let folders: string[];
  try {
    folders = (
      await readdir(TEMPLATES_DIR, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  return Promise.all(folders.map(loadTemplate));
}

export async function loadTemplate(id: string): Promise<TemplateEntry> {
  const dir = join(TEMPLATES_DIR, id);
  const hasBackground = await firstExisting(dir, [
    "background.jpg",
    "background.jpeg",
    "background.png",
    "background.webp",
  ]);

  let raw: string;
  try {
    raw = await readFile(join(dir, "template.json"), "utf8");
  } catch {
    return {
      id,
      ok: false,
      hasBackground: hasBackground !== null,
      errors: hasBackground
        ? ["No template.json yet — use the corner picker to generate one."]
        : ["No template.json and no background image."],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      id,
      ok: false,
      hasBackground: hasBackground !== null,
      errors: [
        `template.json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      ],
    };
  }

  const result = validateTemplate(parsed);
  if (!result.ok) {
    return { id, ok: false, hasBackground: hasBackground !== null, errors: result.errors };
  }

  // The id in the file must match the folder, because the folder is what the
  // compositor joins paths against. A mismatch would load one template's JSON
  // and another's background.
  if (result.template.id !== id) {
    return {
      id,
      ok: false,
      hasBackground: hasBackground !== null,
      errors: [
        `"id" is "${result.template.id}" but the folder is "${id}". They must match.`,
      ],
    };
  }

  // Referenced files are checked here rather than in the shared schema, since
  // the browser cannot stat the filesystem.
  const missing: string[] = [];
  if (!(await exists(join(dir, result.template.background)))) {
    missing.push(result.template.background);
  }
  if (result.template.overlay && !(await exists(join(dir, result.template.overlay)))) {
    missing.push(result.template.overlay);
  }
  if (missing.length > 0) {
    return {
      id,
      ok: false,
      hasBackground: hasBackground !== null,
      errors: [`Missing referenced file(s): ${missing.join(", ")}`],
    };
  }

  return { id, ok: true, template: result.template };
}

/** Only the templates that are actually usable, for the render pipeline. */
export async function usableTemplates(): Promise<MockupTemplate[]> {
  const entries = await loadTemplates();
  return entries.flatMap((entry) => (entry.ok ? [entry.template] : []));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(
  dir: string,
  names: string[],
): Promise<string | null> {
  for (const name of names) {
    if (await exists(join(dir, name))) return name;
  }
  return null;
}
