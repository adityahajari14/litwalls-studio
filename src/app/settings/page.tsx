import Link from "next/link";

import { SettingsForm } from "@/app/settings/settings-form";
import { FALLBACK_COMPARE_AT, FALLBACK_PRICES } from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";

export const metadata = { title: "Settings · Litwalls Studio" };

export default async function SettingsPage() {
  const settings = await readSettings();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Default prices for every new product. A batch can override these at
        upload, and a single poster can override its batch.
      </p>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Default prices
        </h2>
        <div className="mt-3">
          <SettingsForm
            prices={settings.prices}
            compareAt={settings.compareAt}
            fallbackPrices={FALLBACK_PRICES}
            fallbackCompare={FALLBACK_COMPARE_AT}
            saved={settings.updatedAt > 0}
          />
        </div>
      </section>
    </main>
  );
}
