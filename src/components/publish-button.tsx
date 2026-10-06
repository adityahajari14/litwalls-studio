"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Publish approved posters to Shopify, or send already-published ones again.
 *
 * Defaults to DRAFT. Publishing straight to a live storefront should be a
 * deliberate tick rather than the path of least resistance — a bad title or a
 * wrong crop is far cheaper to fix before customers can see it.
 *
 * Republish updates the existing Shopify products in place with the poster's
 * current images, gallery, title parts, description and prices. It keeps each
 * product's current status and number, so it never pulls a live product back
 * to draft or renames it.
 */
export function PublishButton({
  batchId,
  unpublished,
  published,
}: {
  batchId: string;
  /** Approved posters with no Shopify product yet. */
  unpublished: number;
  /** Posters that already have a Shopify product. */
  published: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"publish" | "republish" | null>(null);
  const [live, setLive] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function run(mode: "publish" | "republish") {
    if (
      mode === "republish" &&
      !window.confirm(
        `Republish ${published} poster${published === 1 ? "" : "s"}?\n\n` +
          "Their Shopify products are updated in place with the current " +
          "images, title, description and prices. Live products stay live.",
      )
    ) {
      return;
    }

    setPending(mode);
    setResult(null);
    setErrors([]);
    try {
      const response = await fetch(`/api/batches/${batchId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: live ? "ACTIVE" : "DRAFT",
          republish: mode === "republish",
        }),
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
        mode === "republish"
          ? `${body.published} republished`
          : `${body.published} published as ${body.status}`,
      );
      if (body.failed) setResult((prev) => `${prev}, ${body.failed} failed`);
      setErrors(
        (body.results ?? [])
          .filter((r: { ok: boolean }) => !r.ok)
          .map((r: { job: string; detail: string }) => `${r.job}: ${r.detail}`),
      );
      router.refresh();
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        {unpublished > 0 ? (
          <Button variant="primary" onClick={() => run("publish")} disabled={busy}>
            {pending === "publish" ? (
              <>
                <span aria-hidden className="breathe size-1.5 rounded-full bg-white" />
                Publishing…
              </>
            ) : (
              "Publish to Shopify"
            )}
          </Button>
        ) : null}

        {published > 0 ? (
          <Button
            variant={unpublished > 0 ? "secondary" : "primary"}
            onClick={() => run("republish")}
            disabled={busy}
            title="Update the already-published products with the current images, title, description and prices"
          >
            {pending === "republish" ? (
              <>
                <span aria-hidden className="breathe size-1.5 rounded-full bg-current" />
                Republishing…
              </>
            ) : (
              `Republish ${published}`
            )}
          </Button>
        ) : null}

        {unpublished > 0 ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-500">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              className="accent-[var(--color-accent-500)]"
            />
            Go live (ACTIVE) instead of draft
          </label>
        ) : null}

        {result ? (
          <span className="animate-fade-rise text-xs text-ink-600">{result}</span>
        ) : null}
      </div>

      {live && unpublished > 0 ? (
        <p className="animate-fade-rise mt-2 text-xs text-warn-700">
          Live products appear on the storefront immediately. Worth publishing
          one as a draft first and checking it in Shopify before doing a whole
          batch.
        </p>
      ) : null}

      {errors.length > 0 ? (
        <ul className="animate-fade-rise mt-2 space-y-0.5 text-xs text-danger-700">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
