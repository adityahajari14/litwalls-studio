import { notFound } from "next/navigation";

import { DropZone } from "@/app/batches/[batchId]/drop-zone";
import { JobGrid } from "@/components/job-grid";
import { PublishButton } from "@/components/publish-button";
import { RunButton } from "@/components/run-button";
import { Badge, BackLink, PageHeader, Section } from "@/components/ui";
import { hasReached } from "@/lib/print/types";
import { listJobs, readBatch } from "@/lib/pipeline/store";
import { resolvePriceTable } from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";
import { CATEGORY_LABEL } from "@/lib/print/title";
import { SIZES } from "@/lib/print/sizes";

export default async function BatchPage(
  props: PageProps<"/batches/[batchId]">,
) {
  const { batchId } = await props.params;

  const batch = await readBatch(batchId);
  if (!batch) notFound();

  const [jobs, settings] = await Promise.all([
    listJobs(batchId),
    readSettings(),
  ]);

  // What this batch will actually publish at: its own overrides on top of the
  // dashboard defaults.
  const prices = resolvePriceTable({
    batch: batch.prices,
    settings: settings.prices,
  });

  const unprocessed = jobs.filter((job) => !hasReached(job.stage, "mocked"));
  const approved = jobs.filter(
    (job) => job.stage === "approved" || job.stage === "published",
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/">All batches</BackLink>}
        title={batch.name}
        meta={
          <>
            <Badge>{CATEGORY_LABEL[batch.category]}</Badge>
            <Badge>
              {batch.kind === "split3" ? "Split — 3 panels" : "Single sheet"}
            </Badge>
            <span className="tnum text-ink-400">
              {SIZES.map((size) => `${size.label} ₹${prices[size.id]}`).join(
                " · ",
              )}
            </span>
          </>
        }
        actions={
          <>
            {unprocessed.length > 0 ? (
              <RunButton batchId={batch.id} pending={unprocessed.length} />
            ) : null}
            {approved.length > 0 ? <PublishButton batchId={batch.id} /> : null}
          </>
        }
      />

      <div className="mt-6">
        <DropZone batchId={batch.id} initialCount={jobs.length} />
      </div>

      <Section title="Posters" className="mt-8">
        <JobGrid batchId={batch.id} initialJobs={jobs} />
      </Section>
    </main>
  );
}
