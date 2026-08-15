"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Publish approved posters to Shopify.
 *
 * Defaults to DRAFT and says so. Until the storefront handles size variants, a
 * live four-variant product sells A5 whatever the customer picks — so going
 * live has to be a deliberate choice rather than the path of least resistance.
 */
export function PublishButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [live, setLive] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function publish() {
    setPending(true);
    setResult(null);
    setErrors([]);
    try {
      const response = await fetch(`/api/batches/${batchId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: live ? "ACTIVE" : "DRAFT" }),
      });
      const body = await response.json();

      if (!response.ok) {
        setResult(body.error ?? "Publish failed.");
        return;
      }
      if (body.message) {
        setResult(body.message);
        return;
      }

      setResult(
        `${body.published} published as ${body.status}` +
          (body.failed ? `, ${body.failed} failed` : ""),
      );
      setErrors(
        (body.results ?? [])
          .filter((r: { ok: boolean }) => !r.ok)
          .map((r: { job: string; detail: string }) => `${r.job}: ${r.detail}`),
      );
      router.refresh();
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 rounded border border-paper-200 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={publish}
          disabled={pending}
          className="rounded bg-ink-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Publishing…" : "Publish approved to Shopify"}
        </button>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
          />
          Publish live (ACTIVE) instead of draft
        </label>

        {result ? (
          <span className="text-xs text-ink-600">
            {result}
          </span>
        ) : null}
      </div>

      {live ? (
        <p className="mt-2 text-xs text-amber-700">
          The storefront does not handle size variants yet — a live product will
          sell A5 whichever size a customer chooses. Keep this off until the
          storefront work is done.
        </p>
      ) : null}

      {errors.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-danger-700">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
