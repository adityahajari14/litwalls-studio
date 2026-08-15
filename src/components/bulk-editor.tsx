"use client";

import { useState } from "react";

import { PriceTable } from "@/components/price-table";
import { Button, Card, Field, Input } from "@/components/ui";
import { FALLBACK_PRICES } from "@/lib/print/pricing";

/**
 * Apply tags and prices to several posters at once.
 *
 * A batch usually shares both, and setting them one review screen at a time
 * was the most repetitive thing left in the tool.
 *
 * Add and remove are separate fields rather than one "set tags" box, because
 * replacing every tag wholesale would wipe the per-poster subject tags the
 * model chose — which are the ones actually worth keeping.
 */
export function BulkEditor({
  batchId,
  count,
  jobIds,
  onDone,
}: {
  batchId: string;
  count: number;
  jobIds: string[];
  onDone: () => void;
}) {
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const prices: Record<string, string> = {};
    const compareAt: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string" || value.trim() === "") continue;
      if (key.startsWith("price.")) prices[key.slice(6)] = value;
      if (key.startsWith("compare.")) compareAt[key.slice(8)] = value;
    }

    const split = (value: string) =>
      value.split(",").map((t) => t.trim()).filter(Boolean);

    try {
      const response = await fetch(`/api/batches/${batchId}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds,
          addTags: split(addTags),
          removeTags: split(removeTags),
          // Only sent when something was typed, so an empty form does not
          // wipe existing per-poster overrides.
          ...(Object.keys(prices).length > 0 ? { prices } : {}),
          ...(Object.keys(compareAt).length > 0 ? { compareAt } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "Could not apply the changes.");
        return;
      }
      onDone();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={apply} className="space-y-4">
        <p className="text-sm text-ink-600">
          Applying to <strong className="text-ink-900">{count}</strong> selected
          poster{count === 1 ? "" : "s"}. Blank fields are left untouched.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Add tags" hint="Comma separated. Existing tags are kept.">
            <Input
              value={addTags}
              onChange={(e) => setAddTags(e.target.value)}
              placeholder="Marvel, Movies"
            />
          </Field>
          <Field label="Remove tags" hint="Matched case-insensitively.">
            <Input
              value={removeTags}
              onChange={(e) => setRemoveTags(e.target.value)}
              placeholder="Draft, Wip"
            />
          </Field>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-600">
            Prices for the selected posters
          </h3>
          <PriceTable
            values={{}}
            compareValues={{}}
            inherited={FALLBACK_PRICES}
            emptyMeans="Blank leaves each poster's current price alone."
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Applying…" : `Apply to ${count}`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          {message ? (
            <span className="text-xs text-danger-700">{message}</span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
