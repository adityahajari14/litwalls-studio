import Link from "next/link";
import { notFound } from "next/navigation";

import { DropZone } from "@/app/batches/[batchId]/drop-zone";
import { JobRow } from "@/components/job-row";
import { RunButton } from "@/components/run-button";
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

  // The prices this batch will actually publish at, with the batch's own
  // overrides on top of the dashboard defaults.
  const prices = resolvePriceTable({
    batch: batch.prices,
    settings: settings.prices,
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        ← Dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{batch.name}</h1>
        <div className="flex gap-2 text-xs text-zinc-500">
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">
            {CATEGORY_LABEL[batch.category]}
          </span>
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">
            {batch.kind === "split3" ? "Split — 3 panels" : "Normal"}
          </span>
        </div>
      </div>

      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {SIZES.map((size) => `${size.label} ₹${prices[size.id]}`).join("  ·  ")}
      </p>

      <section className="mt-10">
        <DropZone batchId={batch.id} initialCount={jobs.length} />
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Posters ({jobs.length})
          </h2>
          {jobs.length > 0 ? <RunButton batchId={batch.id} /> : null}
        </div>

        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing uploaded yet. Drop artwork above to get started.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
