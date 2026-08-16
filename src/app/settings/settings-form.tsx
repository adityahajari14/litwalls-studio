"use client";

import { useActionState, useState } from "react";

import { saveSettings, type SaveState } from "@/app/settings/actions";
import { PriceTable } from "@/components/price-table";
import { Button } from "@/components/ui";
import { SPLIT_SIZES } from "@/lib/print/sizes";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";

export function SettingsForm({
  prices,
  compareAt,
  splitPrices,
  splitCompareAt,
  fallbackPrices,
  fallbackCompare,
  fallbackSplitPrices,
  fallbackSplitCompare,
  saved,
  border,
}: {
  prices: PartialPriceTable;
  compareAt: PartialPriceTable;
  splitPrices: PartialPriceTable;
  splitCompareAt: PartialPriceTable;
  fallbackPrices: Prices;
  fallbackCompare: PartialPriceTable;
  fallbackSplitPrices: PartialPriceTable;
  fallbackSplitCompare: PartialPriceTable;
  saved: boolean;
  border: { enabled: boolean; mm: number };
}) {
  const [borderOn, setBorderOn] = useState(border.enabled);
  const [borderMm, setBorderMm] = useState(border.mm);

  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveSettings,
    null,
  );

  return (
    <form action={formAction}>
      <h3 className="text-sm font-medium text-ink-700">Default prices</h3>
      <p className="mt-1 mb-3 text-xs text-ink-400">
        Applied to every new product unless a batch or a poster overrides them.
      </p>

      <PriceTable
        values={prices}
        compareValues={compareAt}
        inherited={fallbackPrices}
        inheritedCompare={fallbackCompare}
        emptyMeans="Leave a field blank to fall back to the built-in placeholder shown in grey."
      />

      <div className="mt-8 border-t border-paper-300 pt-6">
        <h3 className="text-sm font-medium text-ink-700">
          Default prices — split-3 sets
        </h3>
        <p className="mt-1 mb-3 text-xs text-ink-400">
          Applied to every new split-3 product. No A5 — a three-panel set
          isn&rsquo;t sold at that size.
        </p>

        <PriceTable
          sizes={SPLIT_SIZES}
          pricePrefix="splitPrice"
          comparePrefix="splitCompare"
          values={splitPrices}
          compareValues={splitCompareAt}
          inherited={fallbackSplitPrices}
          inheritedCompare={fallbackSplitCompare}
          emptyMeans="Leave a field blank to fall back to the built-in placeholder shown in grey."
        />
      </div>

      <div className="mt-8 border-t border-paper-300 pt-6">
        <h3 className="text-sm font-medium text-ink-700">
          White border in mockups
        </h3>
        <p className="mt-1 text-xs text-ink-400">
          The printer adds a white edge to every poster. Showing it makes the
          mockup match what arrives — turn it off if a template reads better
          without one.
        </p>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            name="borderEnabled"
            defaultChecked={border.enabled}
            onChange={(e) => setBorderOn(e.target.checked)}
            className="accent-[var(--color-accent-500)]"
          />
          Show the white border
        </label>

        <div className="mt-3 max-w-xs">
          <label className="block text-xs font-medium text-ink-600">
            Width — {borderMm.toFixed(1)} mm
            {Math.abs(borderMm - 0.5) < 0.05 ? (
              <span className="ml-1 font-normal text-ink-400">
                (matches the real print)
              </span>
            ) : null}
          </label>
          <input
            type="range"
            name="borderMm"
            min={0}
            max={40}
            step={1}
            value={Math.round(borderMm * 10)}
            onChange={(e) => setBorderMm(Number(e.target.value) / 10)}
            disabled={!borderOn}
            className="mt-1.5 w-full accent-[var(--color-accent-500)] disabled:opacity-40"
          />
          <p className="mt-1 text-xs text-ink-400">
            The real border is 0.5&nbsp;mm — a hairline that some templates
            swallow. Widen it only to make the edge legible in a mockup;
            it does not change what gets printed.
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save defaults"}
        </Button>

        {state ? (
          <span
            key={state.message}
            className={
              state.ok
                ? "animate-fade-rise text-sm text-ok-700"
                : "animate-fade-rise text-sm text-warn-700"
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
