import { NewBatchForm } from "@/app/batches/new/new-batch-form";
import { BackLink, PageHeader } from "@/components/ui";
import { readSettings } from "@/lib/pipeline/settings";
import { FALLBACK_SPLIT_PRICES, resolvePriceTable } from "@/lib/print/pricing";
import { SPLIT_SIZE_IDS } from "@/lib/print/sizes";

export const metadata = { title: "New batch · Litwalls Studio" };

export default async function NewBatchPage() {
  const settings = await readSettings();

  // What each size costs if this batch overrides nothing — shown as the
  // placeholder in every field, so "blank means inherit" is visible rather
  // than something the user has to be told. Both formats are resolved up
  // front because the format picker is client-side; the form switches
  // between them as the user toggles it, without a round trip.
  const inherited = resolvePriceTable({ settings: settings.prices });
  const inheritedSplit = resolvePriceTable(
    { settings: settings.splitPrices },
    SPLIT_SIZE_IDS,
    FALLBACK_SPLIT_PRICES,
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/">All batches</BackLink>}
        title="New batch"
        meta="A batch groups posters that share a category, format and prices. Each poster can still be adjusted individually before publishing."
      />

      <NewBatchForm
        inheritedPrices={inherited}
        inheritedCompare={settings.compareAt}
        inheritedSplitPrices={inheritedSplit}
        inheritedSplitCompare={settings.splitCompareAt}
      />
    </main>
  );
}
