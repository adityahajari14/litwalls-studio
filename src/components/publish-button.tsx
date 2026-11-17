"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
  // On by default: every poster on the storefront should have its print files
  // on Drive. Untick to publish or republish without touching Drive.
  const [toDrive, setToDrive] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // A run the SERVER is doing for this batch — possibly started from another
  // tab, or from this one before a reload. While it exists nothing here can
  // start another: that is how one Music batch got published twice.
  const [serverRun, setServerRun] = useState<{
    mode: "publish" | "republish";
    total: number;
    done: number;
    failed: number;
    current: string | null;
  } | null>(null);

  const wasRunning = useRef(false);
  const checkRun = useCallback(async () => {
    try {
      const response = await fetch(`/api/batches/${batchId}/publish`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = await response.json();
      // It just finished somewhere else: show the new state of the batch.
      if (wasRunning.current && !body.running) router.refresh();
      wasRunning.current = Boolean(body.running);
      setServerRun(body.running ?? null);
    } catch {
      // Transient; the next tick asks again.
    }
  }, [batchId, router]);

  useEffect(() => {
    const first = setTimeout(checkRun, 0);
    const timer = setInterval(checkRun, serverRun || pending ? 3000 : 15000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [checkRun, serverRun, pending]);

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
          drive: toDrive,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setResult(body.error ?? "Publish failed.");
        if (body.running) setServerRun(body.running);
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
      if (body.driveQueued) {
        setResult(
          (prev) =>
            `${prev} · ${body.driveQueued} filing to Drive in the background`,
        );
      }
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

  const busy = pending !== null || serverRun !== null;
  const progress = serverRun
    ? ` ${serverRun.done + serverRun.failed} of ${serverRun.total}`
    : "";
  const runMode = pending ?? serverRun?.mode ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        {unpublished > 0 ? (
          <Button
            variant="primary"
            onClick={() => run("publish")}
            disabled={busy}
          >
            {runMode === "publish" ? (
              <>
                <span
                  aria-hidden
                  className="breathe size-1.5 rounded-full bg-white"
                />
                Publishing…{progress}
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
            {runMode === "republish" ? (
              <>
                <span
                  aria-hidden
                  className="breathe size-1.5 rounded-full bg-current"
                />
                Republishing…{progress}
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

        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-500"
          title="Upload the original and lossless print files to Google Drive after publishing. Runs in the background and retries on its own."
        >
          <input
            type="checkbox"
            checked={toDrive}
            onChange={(e) => setToDrive(e.target.checked)}
            disabled={busy}
            className="accent-[var(--color-accent-500)]"
          />
          File to Google Drive
        </label>

        {serverRun && !pending ? (
          <span className="text-xs text-ink-500">
            Already running on the server
            {serverRun.current ? ` — now on ${serverRun.current}` : ""}. It
            carries on if you close this page.
          </span>
        ) : null}

        {result ? (
          <span className="animate-fade-rise text-xs text-ink-600">
            {result}
          </span>
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
