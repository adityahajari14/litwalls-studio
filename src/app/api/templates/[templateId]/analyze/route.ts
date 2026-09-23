import { join } from "node:path";

import { analyzeWallPlacement } from "@/lib/gemini/placement";
import { TEMPLATES_DIR } from "@/lib/pipeline/paths";
import { loadTemplate } from "@/lib/templates/load";
import { referenceSizeOf } from "@/lib/templates/placement";
import type { SizeId } from "@/lib/print/types";

/**
 * Re-run the AI wall analysis on demand.
 *
 * The same estimate `createTemplate` kicks off in the background, but
 * synchronous and non-destructive: it returns a suggested `sizing.base`, and
 * the editor applies it to local state so the author reviews the box before
 * saving. Nothing is written here.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/templates/[templateId]/analyze">,
) {
  const { templateId } = await ctx.params;

  const entry = await loadTemplate(templateId);
  if (!entry.ok) {
    return Response.json(
      { error: "This template has no valid setup to analyse yet." },
      { status: 400 },
    );
  }

  let referenceSize = referenceSizeOf(entry.template);
  try {
    const body = (await request.json()) as { referenceSize?: string };
    if (typeof body.referenceSize === "string") {
      referenceSize = body.referenceSize as SizeId;
    }
  } catch {
    // No body is fine — use the template's own reference size.
  }

  const placement = await analyzeWallPlacement({
    image: join(TEMPLATES_DIR, templateId, entry.template.background),
    canvas: entry.template.canvas,
    referenceSize,
  });

  return Response.json({ placement });
}
