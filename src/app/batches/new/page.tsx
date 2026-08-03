import Link from "next/link";

import { NewBatchForm } from "@/app/batches/new/new-batch-form";
import { resolvePriceTable } from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";

export const metadata = { title: "New batch · Litwalls Studio" };

export default async function NewBatchPage() {
  const settings = await readSettings();

  // What each size costs if this batch overrides nothing — shown as the
  // placeholder in every field, so "blank means inherit" is visible rather
  // than something the user has to be told.
  const inherited = resolvePriceTable({ settings: settings.prices });

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New batch</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        A batch groups posters that share a category and format. These settings
        apply to every poster in it, and each one can still be adjusted
        individually before publishing.
      </p>

      <NewBatchForm
        inheritedPrices={inherited}
        inheritedCompare={settings.compareAt}
      />
    </main>
  );
}
