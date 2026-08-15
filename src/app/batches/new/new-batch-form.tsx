"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PriceTable } from "@/components/price-table";
import { Button, Field, Input } from "@/components/ui";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";
import { CATEGORY_LABEL, CATEGORY_IDS, CATEGORY_TAG } from "@/lib/print/title";
import type { CategoryId, PosterKind } from "@/lib/print/types";

export function NewBatchForm({
  inheritedPrices,
  inheritedCompare,
}: {
  inheritedPrices: Prices;
  inheritedCompare: PartialPriceTable;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<CategoryId>("marvel");
  const [kind, setKind] = useState<PosterKind>("normal");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const prices: Record<string, string> = {};
    const compareAt: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string") continue;
      if (key.startsWith("price.")) prices[key.slice(6)] = value;
      if (key.startsWith("compare.")) compareAt[key.slice(8)] = value;
    }

    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          category,
          kind,
          prices,
          compareAt,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not create the batch.");
        setPending(false);
        return;
      }
      router.push(`/batches/${body.batch.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-8">
      <Field
        label="Batch name"
        hint="For your reference only — never shown to customers."
      >
        <Input name="name" required placeholder="Marvel drop — March" />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-ink-700">Category</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORY_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setCategory(id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                category === id
                  ? "border-accent-600 bg-accent-600 text-white"
                  : "border-paper-300 bg-paper-200 text-ink-600 hover:border-paper-400"
              }`}
            >
              {CATEGORY_LABEL[id]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Sets the title suffix and adds the{" "}
          <code className="rounded bg-paper-100 px-1">
            {CATEGORY_TAG[category]}
          </code>{" "}
          tag, which is what puts the product in the {CATEGORY_LABEL[category]}{" "}
          collection.
        </p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Format</legend>
        <div className="mt-2 space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name="kind"
              checked={kind === "normal"}
              onChange={() => setKind("normal")}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium">Normal</span>
              <span className="block text-xs text-ink-500">
                One sheet per poster.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name="kind"
              checked={kind === "split3"}
              onChange={() => setKind("split3")}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium">Split — 3 panels</span>
              <span className="block text-xs text-ink-500">
                One artwork across three sheets, sold as one product. The size
                chosen is the size of each panel.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div>
        <h2 className="text-sm font-medium">Prices for this batch</h2>
        <div className="mt-2">
          <PriceTable
            values={{}}
            compareValues={{}}
            inherited={inheritedPrices}
            inheritedCompare={inheritedCompare}
            emptyMeans="Leave blank to use the dashboard default shown in grey. Individual posters can still override these."
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create batch"}
        </Button>
        {error ? (
          <span className="text-sm text-danger-700">{error}</span>
        ) : null}
      </div>
    </form>
  );
}
