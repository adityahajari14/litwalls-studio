"use client";

import { useActionState } from "react";

import { saveSettings, type SaveState } from "@/app/settings/actions";
import { PriceTable } from "@/components/price-table";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";

export function SettingsForm({
  prices,
  compareAt,
  fallbackPrices,
  fallbackCompare,
  saved,
}: {
  prices: PartialPriceTable;
  compareAt: PartialPriceTable;
  fallbackPrices: Prices;
  fallbackCompare: PartialPriceTable;
  saved: boolean;
}) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveSettings,
    null,
  );

  return (
    <form action={formAction}>
      <PriceTable
        values={prices}
        compareValues={compareAt}
        inherited={fallbackPrices}
        inheritedCompare={fallbackCompare}
        emptyMeans="Leave a field blank to fall back to the built-in placeholder shown in grey."
      />

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save defaults"}
        </button>

        {state ? (
          <span
            className={
              state.ok
                ? "text-sm text-emerald-600 dark:text-emerald-400"
                : "text-sm text-amber-600 dark:text-amber-400"
            }
          >
            {state.message}
          </span>
        ) : null}
      </div>

      {!saved && !state ? (
        <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
          These are placeholder figures. Every existing product sells at ₹149,
          so set real prices before the first publish.
        </p>
      ) : null}
    </form>
  );
}
