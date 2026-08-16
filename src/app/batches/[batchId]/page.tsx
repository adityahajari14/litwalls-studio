import { notFound } from "next/navigation";

import { DropZone } from "@/app/batches/[batchId]/drop-zone";
import { DeleteBatch } from "@/components/delete-batch";
import { JobGrid } from "@/components/job-grid";
import { PublishButton } from "@/components/publish-button";
import { RunButton } from "@/components/run-button";
import { Badge, BackLink, PageHeader, Section } from "@/components/ui";
import { hasReached } from "@/lib/print/types";
import { listJobs, readBatch } from "@/lib/pipeline/store";
import { FALLBACK_SPLIT_PRICES, resolvePriceTable } from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";
import { sizeIdsFor, sizesFor } from "@/lib/print/sizes";

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
  // dashboard defaults. Split-3 batches resolve against the split price table
  // and its own fallback, and never touch A5 — it isn't a size split-3 sells.
  const isSplit = batch.kind === "split3";
  const prices = resolvePriceTable(
    {
      batch: batch.prices,
      settings: isSplit ? settings.splitPrices : settings.prices,
    },
    sizeIdsFor(batch.kind),
    isSplit ? FALLBACK_SPLIT_PRICES : undefined,
  );

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
            <Badge>{batch.category.label}</Badge>
            <Badge>
              {batch.kind === "split3" ? "Split — 3 panels" : "Single sheet"}
            </Badge>
            <span className="tnum text-ink-400">
              {sizesFor(batch.kind)
                .map((size) => `${size.label} ₹${prices[size.id]}`)
                .join(" · ")}
            </span>
          </>
        }
        actions={
          <>
            {/* A plain link, not fetch: the browser's own download handling
                streams a multi-gigabyte archive without buffering it in JS. */}
            {jobs.length > 0 ? (
              <a
                href={`/api/batches/${batch.id}/export`}
                className="inline-flex h-9 items-center rounded-lg border border-paper-400/70 bg-paper-200 px-3.5 text-sm font-medium text-ink-700 transition-colors hover:border-paper-500 hover:bg-paper-300 hover:text-ink-900"
                title="Originals, print files and mockups as a ZIP"
              >
                Export
              </a>
            ) : null}
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

      <Section title="Danger zone" className="mt-12">
        <DeleteBatch
          batchId={batch.id}
          name={batch.name}
          posterCount={jobs.length}
          publishedCount={
            jobs.filter((job) => job.shopify?.productId).length
          }
        />
      </Section>
    </main>
  );
}
