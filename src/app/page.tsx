import Link from "next/link";

import { CATEGORY_LABEL, CATEGORY_IDS } from "@/lib/print/title";
import { SIZES } from "@/lib/print/sizes";
import { resolvePriceTable } from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";

/**
 * Placeholder home page.
 *
 * Phase 1 replaces this with the batch list. For now it renders the loaded
 * configuration, which is a genuinely useful smoke test: if the size table or
 * saved price defaults are malformed, this page shows it immediately rather
 * than the first upload failing three stages deep.
 */
export default async function Home() {
  const settings = await readSettings();
  const prices = resolvePriceTable({ settings: settings.prices });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Litwalls Studio</h1>
        <Link
          href="/settings"
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          Settings
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Poster processing and publishing. Local only — this never ships.
      </p>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Print sizes
        </h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-1 font-normal">Size</th>
              <th className="py-1 font-normal">Dimensions</th>
              <th className="py-1 font-normal">Min pixels</th>
              <th className="py-1 text-right font-normal">Price</th>
            </tr>
          </thead>
          <tbody>
            {SIZES.map((size) => (
              <tr key={size.id} className="border-t border-zinc-200/70 dark:border-zinc-800">
                <td className="py-1.5 font-medium">{size.label}</td>
                <td className="py-1.5 text-zinc-600 dark:text-zinc-400">{size.mm}</td>
                <td className="py-1.5 tabular-nums text-zinc-600 dark:text-zinc-400">
                  {size.minWidth} × {size.minHeight}
                </td>
                <td className="py-1.5 text-right tabular-nums">₹{prices[size.id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-zinc-500">
          {settings.updatedAt === 0
            ? "Placeholder defaults — set real prices in Settings before publishing."
            : "Default prices. A batch or an individual poster can override these."}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Categories
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {CATEGORY_IDS.map((id) => (
            <li
              key={id}
              className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800"
            >
              {CATEGORY_LABEL[id]}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 text-sm text-zinc-500">
        Next: batch creation and upload (Phase 1).
      </p>
    </main>
  );
}
