import "server-only";

import { assemblePanels, composeMockup } from "@/lib/image/compose";
import { ensureDir, jobAsset, jobDir } from "@/lib/pipeline/paths";
import { SIZE_IDS } from "@/lib/print/sizes";
import { isPerSize, referenceSizeOf } from "@/lib/templates/placement";
import { DEFAULT_PANEL_GAP } from "@/lib/templates/schema";
import { usableTemplates } from "@/lib/templates/load";
import type { MockupTemplate, PosterJob, RenderedMockup } from "@/lib/print/types";

/**
 * Render a room mockup for each selected template.
 *
 * The A3 render is the source: it is the largest size that every poster has,
 * and re-rendering from the print file rather than the master means the mockup
 * shows exactly the crop that will be sold. Showing a customer a mockup built
 * from a different crop than the one they receive would be a lie, even an
 * accidental one.
 */
const MOCKUP_SOURCE_SIZE = "A3" as const;

/**
 * Which templates to render when the user has not chosen.
 *
 * Everything usable, capped, because a first run should show what the library
 * can do rather than an empty picker. The cap keeps a twenty-template library
 * from turning one batch into a twenty-minute render.
 */
const AUTO_TEMPLATE_LIMIT = 3;

export async function renderMockups(job: PosterJob): Promise<RenderedMockup[]> {
  const templates = await usableTemplates();
  if (templates.length === 0) return [];

  const chosen =
    job.selectedTemplateIds.length > 0
      ? templates.filter((t) => job.selectedTemplateIds.includes(t.id))
      : pickAutomatic(templates, job);

  if (chosen.length === 0) return [];

  await ensureDir(`${jobDir(job.batchId, job.id)}/mockups`);

  // Assembled per gap rather than once, because the gap is now a template
  // setting. Memoised so two templates sharing a gap do not pay for the
  // assembly twice — which for a split A3 is three 3508x4961 panels.
  const assembled = new Map<number, string | Buffer | null>();
  const posterFor = async (template: MockupTemplate) => {
    const gap = job.kind === "split3" ? (template.panelGap ?? DEFAULT_PANEL_GAP) : 0;
    if (!assembled.has(gap)) {
      assembled.set(gap, await buildPoster(job, gap));
    }
    return assembled.get(gap) ?? null;
  };

  const rendered: RenderedMockup[] = [];

  for (const template of chosen) {
    const poster = await posterFor(template);
    if (!poster) continue;

    // A per-size template produces one mockup per variant, each showing the
    // poster at its true relative scale on the wall. Everything else produces
    // a single shared image — four times the renders is not worth paying on
    // every template when most look identical across sizes.
    const sizes = isPerSize(template)
      ? SIZE_IDS
      : ([referenceSizeOf(template)] as const);

    for (const sizeId of sizes) {
      const perSize = isPerSize(template);
      const relPath = perSize
        ? `mockups/${template.id}-${sizeId}.jpg`
        : `mockups/${template.id}.jpg`;

      try {
        const size = await composeMockup({
          template,
          poster,
          sizeId,
          outPath: jobAsset(job.batchId, job.id, relPath),
        });
        rendered.push({
          templateId: template.id,
          relPath,
          width: size.width,
          height: size.height,
          sizeId: perSize ? sizeId : null,
        });
      } catch (cause) {
        // One broken template must not cost the job its other mockups. The
        // template page reports the reason; here we simply carry on.
        console.warn(
          `mockup: template "${template.id}" failed for ${job.sourceName}: ` +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      }
    }
  }

  return rendered;
}

/**
 * The poster image to place: one file, or three panels assembled with a gap.
 *
 * A split product is sold as a set, so the mockup has to show the set. A
 * single panel on a wall would misrepresent what arrives.
 */
async function buildPoster(
  job: PosterJob,
  gapPercent: number,
): Promise<string | Buffer | null> {
  if (job.kind === "split3") {
    const panels = job.assets
      .filter((a) => a.sizeId === MOCKUP_SOURCE_SIZE && a.panel !== null)
      .sort((a, b) => (a.panel ?? 0) - (b.panel ?? 0));

    if (panels.length !== 3) return null;

    return assemblePanels(
      panels.map((p) => jobAsset(job.batchId, job.id, p.relPath)),
      gapPercent,
    );
  }

  const asset = job.assets.find((a) => a.sizeId === MOCKUP_SOURCE_SIZE);
  return asset ? jobAsset(job.batchId, job.id, asset.relPath) : null;
}

/**
 * Pick templates automatically, preferring ones whose shape suits the poster.
 *
 * A portrait template flatters a portrait poster; a wide split set needs a
 * wide one. Templates without a declared `suitsAspect` are treated as
 * general-purpose and rank behind an explicit match.
 */
function pickAutomatic(
  templates: MockupTemplate[],
  job: PosterJob,
): MockupTemplate[] {
  const aspect =
    job.probe && job.probe.height > 0 ? job.probe.width / job.probe.height : 1;

  const scored = templates.map((template) => {
    const suits = template.suitsAspect;
    if (!suits || suits.length === 0) return { template, distance: 1 };
    const best = Math.min(...suits.map((value) => Math.abs(value - aspect)));
    return { template, distance: best };
  });

  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, AUTO_TEMPLATE_LIMIT)
    .map((entry) => entry.template);
}
