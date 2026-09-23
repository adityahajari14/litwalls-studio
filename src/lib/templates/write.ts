import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import { analyzeWallPlacement } from "@/lib/gemini/placement";
import { upscaleAssetInPlace } from "@/lib/image/upscale-asset";
import { TEMPLATES_DIR, writeJsonAtomic } from "@/lib/pipeline/paths";
import { loadTemplate } from "@/lib/templates/load";
import { referenceSizeOf } from "@/lib/templates/placement";
import {
  clearTemplateProcessing,
  markTemplateProcessing,
} from "@/lib/templates/processing";
import { validateTemplate } from "@/lib/templates/schema";
import { runBackground } from "@/lib/tasks";
import { err, ok, type Result } from "@/lib/result";
import type { MockupTemplate } from "@/lib/print/types";

/**
 * Create, update and delete mockup templates from the dashboard.
 *
 * These files are git-tracked content, and an earlier version of the template
 * page deliberately refused to write to them — it printed JSON for the user to
 * paste. That was the wrong trade in practice: authoring a template meant
 * copying coordinates into a file by hand, which is exactly the friction that
 * leaves a library with two templates in it forever.
 *
 * The safety property that matters is kept: a template is only ever written
 * after it validates, so the folder never ends up holding something the
 * renderer will choke on.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Turn a display name into a usable folder id. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function safeId(id: string): Result<string> {
  if (!ID_PATTERN.test(id)) {
    return err(
      "Id must be lowercase letters, digits and hyphens, and start with a letter or digit.",
    );
  }
  return ok(id);
}

export async function templateExists(id: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(join(TEMPLATES_DIR, id, "template.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a template folder from an uploaded background image.
 *
 * The background is normalised to JPEG at a sane size: template backgrounds
 * are room photos that arrive straight off a phone at 12MP, and compositing
 * against a 4000px canvas for an image nobody views above 2000px wastes both
 * render time and disk on every single poster.
 */
const MAX_CANVAS_EDGE = 2400;

export async function createTemplate(input: {
  name: string;
  background: Buffer;
}): Promise<Result<MockupTemplate>> {
  const id = slugify(input.name);
  const checked = safeId(id);
  if (!checked.ok) return checked;

  if (await templateExists(id)) {
    return err(`A template called "${id}" already exists.`);
  }

  const dir = join(TEMPLATES_DIR, id);
  await mkdir(dir, { recursive: true });

  const image = sharp(input.background).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    await rm(dir, { recursive: true, force: true });
    return err("That file could not be read as an image.");
  }

  const scale = Math.min(
    1,
    MAX_CANVAS_EDGE / Math.max(metadata.width, metadata.height),
  );
  const width = Math.round(metadata.width * scale);
  const height = Math.round(metadata.height * scale);

  await image
    .resize(width, height, { fit: "fill" })
    .jpeg({ quality: 88 })
    .toFile(join(dir, "background.jpg"));

  // A sensible starting placement — a centred portrait rect covering about
  // half the wall. It is almost always wrong, but it gives the editor
  // something to drag rather than making the user draw from nothing.
  const rectHeight = Math.round(height * 0.5);
  const rectWidth = Math.round(rectHeight * 0.707);

  const template: MockupTemplate = {
    id,
    name: input.name.trim() || id,
    kind: "flat",
    background: "background.jpg",
    canvas: { width, height },
    rect: {
      x: Math.round((width - rectWidth) / 2),
      y: Math.round((height - rectHeight) / 2),
      width: rectWidth,
      height: rectHeight,
    },
    shadow: 0.22,
  };

  const saved = await saveTemplate(template);
  if (!saved.ok) {
    await rm(dir, { recursive: true, force: true });
    return saved;
  }

  // The starter rect above is a placeholder. Hand off to a background job that
  // sharpens the photo and asks the model where a real poster hangs on it —
  // the editor shows an "analysing…" banner until it lands.
  enqueueBackgroundAnalysis(id);

  return ok(template);
}

/**
 * Upscale a freshly uploaded background and set its placement from the photo.
 *
 * Fire-and-forget: the upload response has already returned and the editor is
 * open, polling for the `.processing` marker this drops. Every step degrades
 * to a no-op on failure — a missing model file, no `GEMINI_API_KEY` — so the
 * worst case is the template keeps its centred starter rect.
 */
export function enqueueBackgroundAnalysis(id: string): void {
  const key = `template-analysis:${id}`;
  void markTemplateProcessing(id);
  void runBackground(key, async () => {
    try {
      const dir = join(TEMPLATES_DIR, id);
      const backgroundPath = join(dir, "background.jpg");

      // Upscale failure (no model file, a decode error) must not also cost the
      // AI placement — they are independent improvements.
      let dims: { width: number; height: number } | null = null;
      try {
        dims = await upscaleAssetInPlace(backgroundPath, {
          encode: "jpeg",
          maxLongEdge: MAX_CANVAS_EDGE,
        });
      } catch (cause) {
        console.warn(
          `template ${id}: background upscale failed — ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      const entry = await loadTemplate(id);
      if (!entry.ok) return;
      const template = entry.template;
      const canvas = dims ?? template.canvas;

      const placement = await analyzeWallPlacement({
        image: backgroundPath,
        canvas,
        referenceSize: referenceSizeOf(template),
      });

      const base = placement.base;
      const next: MockupTemplate =
        template.kind === "flat"
          ? {
              ...template,
              canvas,
              rect: base,
              sizing: {
                ...(template.sizing ?? {}),
                referenceSize: placement.referenceSize,
                base,
              },
            }
          : { ...template, canvas };

      await saveTemplate(next);
    } finally {
      await clearTemplateProcessing(id);
    }
  });
}

/** Write a template, refusing anything that would not render. */
export async function saveTemplate(
  template: unknown,
): Promise<Result<MockupTemplate>> {
  const result = validateTemplate(template);
  if (!result.ok) return err(result.errors.join(" "));

  const checked = safeId(result.template.id);
  if (!checked.ok) return checked;

  const dir = join(TEMPLATES_DIR, result.template.id);
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(join(dir, "template.json"), result.template);
  return ok(result.template);
}

export async function deleteTemplate(id: string): Promise<Result<null>> {
  const checked = safeId(id);
  if (!checked.ok) return checked;

  // Removes the background image too. Mockups already rendered into a job
  // stay where they are — they are that product's images now, and deleting a
  // template should not retroactively strip pictures from a published listing.
  await rm(join(TEMPLATES_DIR, id), { recursive: true, force: true });
  return ok(null);
}

/** Replace a template's background, keeping its placement where possible. */
export async function replaceBackground(
  id: string,
  background: Buffer,
): Promise<Result<{ width: number; height: number }>> {
  const checked = safeId(id);
  if (!checked.ok) return err(checked.error);

  const image = sharp(background).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return err("That file could not be read as an image.");
  }

  const scale = Math.min(
    1,
    MAX_CANVAS_EDGE / Math.max(metadata.width, metadata.height),
  );
  const width = Math.round(metadata.width * scale);
  const height = Math.round(metadata.height * scale);

  await image
    .resize(width, height, { fit: "fill" })
    .jpeg({ quality: 88 })
    .toFile(join(TEMPLATES_DIR, id, "background.jpg"));

  // A new photo means a new wall — upscale it and re-derive the placement,
  // same as a fresh template. The editor warns the author to check it.
  enqueueBackgroundAnalysis(id);

  return ok({ width, height });
}

/** Save a raw overlay file (glass glare, frame shadow) beside a template. */
export async function saveOverlay(
  id: string,
  overlay: Buffer,
  filename: string,
): Promise<Result<string>> {
  const checked = safeId(id);
  if (!checked.ok) return err(checked.error);

  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  await writeFile(join(TEMPLATES_DIR, id, safeName), overlay);
  return ok(safeName);
}
