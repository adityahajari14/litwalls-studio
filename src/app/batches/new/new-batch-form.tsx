"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PriceTable } from "@/components/price-table";
import { Button, Field, Input } from "@/components/ui";
import { sizesFor } from "@/lib/print/sizes";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";
import type { Category, PosterKind } from "@/lib/print/types";

export function NewBatchForm({
  inheritedPrices,
  inheritedCompare,
  inheritedSplitPrices,
  inheritedSplitCompare,
}: {
  inheritedPrices: Prices;
  inheritedCompare: PartialPriceTable;
  inheritedSplitPrices: PartialPriceTable;
  inheritedSplitCompare: PartialPriceTable;
}) {
  const router = useRouter();
  // null while loading — distinct from an empty list, which means Shopify has
  // no collections and the user needs to make one.
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [kind, setKind] = useState<PosterKind>("normal");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/categories")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const list: Category[] = body.categories ?? [];
        setCategories(list);
        // Preselect the first, so the common case is one fewer click.
        if (list.length > 0) setCategoryId((current) => current || list[0].id);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = categories?.find((c) => c.id === categoryId) ?? null;

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
          categoryId,
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
        <legend className="text-sm font-medium text-ink-700">Collection</legend>

        {categories === null ? (
          <p className="mt-2 text-xs text-ink-400">Loading collections…</p>
        ) : categories.length === 0 ? (
          <p className="mt-2 text-xs text-warn-700">
            No collections found in Shopify. Create one in the admin, then
            reload.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCategoryId(option.id)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  categoryId === option.id
                    ? "border-accent-500 bg-accent-500 text-white"
                    : "border-paper-300 bg-paper-200 text-ink-600 hover:border-paper-400"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {selected ? (
          <p className="mt-2 text-xs text-ink-500">
            Titles end{" "}
            <code className="rounded bg-paper-200 px-1 text-ink-700">
              | {selected.suffix}
            </code>
            {selected.tag ? (
              <>
                {" "}
                and the{" "}
                <code className="rounded bg-paper-200 px-1 text-ink-700">
                  {selected.tag}
                </code>{" "}
                tag is added, which is what puts the product in this collection.
              </>
            ) : (
              <>
                . This is a manual collection, so products are added to it
                directly rather than by tag.
              </>
            )}
          </p>
        ) : null}
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
            sizes={sizesFor(kind)}
            values={{}}
            compareValues={{}}
            inherited={kind === "split3" ? inheritedSplitPrices : inheritedPrices}
            inheritedCompare={
              kind === "split3" ? inheritedSplitCompare : inheritedCompare
            }
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
