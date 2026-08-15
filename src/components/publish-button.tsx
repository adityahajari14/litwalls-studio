"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Publish approved posters to Shopify.
 *
 * Defaults to DRAFT. Publishing straight to a live storefront should be a
 * deliberate tick rather than the path of least resistance — a bad title or a
 * wrong crop is far cheaper to fix before customers can see it.
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
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="primary" onClick={publish} disabled={pending}>
          {pending ? "Publishing…" : "Publish to Shopify"}
        </Button>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-500">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="accent-[var(--color-accent-500)]"
          />
          Go live (ACTIVE) instead of draft
        </label>

        {result ? <span className="text-xs text-ink-600">{result}</span> : null}
      </div>

      {live ? (
        <p className="mt-2 text-xs text-warn-700">
          Live products appear on the storefront immediately. Worth publishing
          one as a draft first and checking it in Shopify before doing a whole
          batch.
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
