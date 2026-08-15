"use client";

import { useActionState } from "react";

import { saveSettings, type SaveState } from "@/app/settings/actions";
import { PriceTable } from "@/components/price-table";
import { Button } from "@/components/ui";
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
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save defaults"}
        </Button>

        {state ? (
          <span
            className={
              state.ok ? "text-sm text-ok-700" : "text-sm text-warn-700"
            }
          >
            {state.message}
          </span>
        ) : null}
      </div>

      {!saved && !state ? (
        <p className="mt-4 text-xs text-warn-700">
          These are placeholder figures. Every existing product sells at ₹149,
          so set real prices before the first publish.
        </p>
      ) : null}
    </form>
  );
}
