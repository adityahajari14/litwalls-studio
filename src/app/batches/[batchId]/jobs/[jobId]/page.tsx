import { notFound } from "next/navigation";

import { ReviewScreen } from "@/app/batches/[batchId]/jobs/[jobId]/review-screen";
import { loadLibrary } from "@/lib/library/load";
import { listJobs, readBatch, readJob } from "@/lib/pipeline/store";
import { readSettings } from "@/lib/pipeline/settings";
import { resolvePriceTable } from "@/lib/print/pricing";
import { usableTemplates } from "@/lib/templates/load";

export default async function JobPage(
  props: PageProps<"/batches/[batchId]/jobs/[jobId]">,
) {
  const { batchId, jobId } = await props.params;

  const [batch, job] = await Promise.all([
    readBatch(batchId),
    readJob(batchId, jobId),
  ]);
  if (!batch || !job) notFound();

  const [settings, templates, library, siblings] = await Promise.all([
    readSettings(),
    usableTemplates(),
    loadLibrary(),
    listJobs(batchId),
  ]);

  // What this poster would publish at with no per-poster override — shown as
  // the placeholder so "blank means inherit" is visible rather than explained.
  const inherited = resolvePriceTable({
    batch: batch.prices,
    settings: settings.prices,
  });

  // Only posters that have something to review can be stepped through, so
  // prev/next never lands on a blank screen.
  const reviewable = siblings.filter((sibling) => sibling.assets.length > 0);
  const index = reviewable.findIndex((sibling) => sibling.id === jobId);

  return (
    <ReviewScreen
      batch={batch}
      job={job}
      inheritedPrices={inherited}
      inheritedCompare={{ ...settings.compareAt, ...batch.compareAt }}
      templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      library={library.map((image) => ({
        id: image.id,
        name: image.name,
        role: image.role,
      }))}
      position={{
        index,
        total: reviewable.length,
        prevId: index > 0 ? reviewable[index - 1].id : null,
        nextId:
          index >= 0 && index < reviewable.length - 1
            ? reviewable[index + 1].id
            : null,
      }}
    />
  );
}
