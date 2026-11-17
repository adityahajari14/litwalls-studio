"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";

type Status = {
  connected: boolean;
  published: number;
  filed: number;
  missing: number;
  pending: number;
  failed: number;
  queue: {
    uploading: string[];
    waiting: number;
    retrying: number;
    filedThisSession: number;
    etaSeconds: number | null;
    lastError: { job: string; message: string; at: number } | null;
    batch?: {
      uploading: string[];
      waiting: number;
      ahead: number;
      etaSeconds: number | null;
    };
  };
};

/** "about 25 min", "about 2 h 10 min" — rough on purpose. */
function duration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h${rest ? ` ${rest} min` : ""}`;
}

/**
 * How many posters on the storefront are actually on Drive, what the
 * background queue is doing about the rest, and a button to queue them all.
 *
 * Polls rather than streams: filing is minutes per batch, and a few seconds
 * of lag is irrelevant next to a dev server that restarts on every save.
 */
export function DriveQueuePanel({ batchId }: { batchId?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const url = batchId
    ? `/api/drive/queue?batchId=${encodeURIComponent(batchId)}`
    : "/api/drive/queue";

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) setStatus(await response.json());
    } catch {
      // Transient — the next tick retries.
    }
  }, [url]);

  const busy =
    status !== null &&
    (status.queue.uploading.length > 0 || status.queue.waiting > 0);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, busy ? 4000 : 15000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh, busy]);

  async function fileMissing() {
    setQueueing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/drive/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchId ? { batchId } : {}),
      });
      const body = await response.json();
      setNotice(
        response.ok
          ? `${body.queued} poster${body.queued === 1 ? "" : "s"} queued for Drive`
          : (body.error ?? "Could not queue."),
      );
      await refresh();
    } finally {
      setQueueing(false);
    }
  }

  if (!status || status.published === 0) return null;

  const { queue } = status;
  const allFiled = status.missing === 0;

  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0 space-y-1 text-xs">
        <p className="flex items-center gap-2 text-ink-600">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              allFiled ? "bg-ok-500" : busy ? "breathe bg-accent-500" : "bg-warn-500"
            }`}
          />
          <span className="tnum">
            Google Drive: {status.filed} of {status.published} published poster
            {status.published === 1 ? "" : "s"} filed
          </span>
          {!allFiled ? (
            <span className="tnum text-ink-400">· {status.missing} missing</span>
          ) : null}
        </p>

        {queue.batch ? (
          // A batch page: this batch's place in the line, not the whole queue,
          // so posters from other batches being uploaded do not read as this
          // batch being ignored.
          queue.batch.uploading.length > 0 ? (
            <p className="text-ink-500">
              Uploading {queue.batch.uploading.join(", ")}
              {queue.batch.waiting > 0 ? ` · ${queue.batch.waiting} more from this batch queued` : ""}
              {duration(queue.batch.etaSeconds) ? ` · ${duration(queue.batch.etaSeconds)} left` : ""}
            </p>
          ) : queue.batch.waiting > 0 ? (
            <p className="text-ink-500">
              {queue.batch.waiting} poster{queue.batch.waiting === 1 ? "" : "s"} from this
              batch queued
              {queue.batch.ahead > 0
                ? ` — ${queue.batch.ahead} from other batches go first`
                : " — starting next"}
              {duration(queue.batch.etaSeconds)
                ? ` · done in ${duration(queue.batch.etaSeconds)}`
                : ""}
            </p>
          ) : null
        ) : queue.uploading.length > 0 ? (
          <p className="text-ink-500">
            Uploading {queue.uploading.join(", ")}
            {queue.waiting > 0 ? ` · ${queue.waiting} waiting` : ""}
            {queue.retrying > 0 ? ` · ${queue.retrying} retrying soon` : ""}
            {duration(queue.etaSeconds) ? ` · ${duration(queue.etaSeconds)} left` : ""}
          </p>
        ) : null}

        {queue.retrying > 0 && queue.batch ? (
          <p className="text-ink-500">{queue.retrying} will retry shortly</p>
        ) : null}

        {!status.connected ? (
          <p className="text-warn-700">
            Drive is not connected — connect it on the dashboard and the queue
            picks up from where it stopped.
          </p>
        ) : null}

        {queue.lastError && !allFiled ? (
          <p className="text-danger-700" title={queue.lastError.message}>
            Last error ({queue.lastError.job}): {queue.lastError.message.slice(0, 160)}
          </p>
        ) : null}

        {notice ? <p className="animate-fade-rise text-ink-500">{notice}</p> : null}
      </div>

      {!allFiled && status.missing > status.pending ? (
        <Button size="sm" onClick={fileMissing} disabled={queueing}>
          {queueing
            ? "Queueing…"
            : `File ${status.missing - status.pending} missing to Drive`}
        </Button>
      ) : null}
    </Card>
  );
}
