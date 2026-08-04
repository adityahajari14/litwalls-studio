import Link from "next/link";
import { notFound } from "next/navigation";

import { ReviewScreen } from "@/app/batches/[batchId]/jobs/[jobId]/review-screen";
import { readBatch, readJob } from "@/lib/pipeline/store";
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

  const [settings, templates] = await Promise.all([
    readSettings(),
    usableTemplates(),
  ]);

  // What this poster would publish at with no per-poster override — shown as
  // the placeholder so "blank means inherit" is visible rather than explained.
  const inherited = resolvePriceTable({
    batch: batch.prices,
    settings: settings.prices,
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <Link
        href={`/batches/${batchId}`}
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        ← {batch.name}
      </Link>

      <ReviewScreen
        batch={batch}
        job={job}
        inheritedPrices={inherited}
        inheritedCompare={{ ...settings.compareAt, ...batch.compareAt }}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      />
    </main>
  );
}
