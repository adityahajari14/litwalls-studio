"use client";

import { useEffect, useState } from "react";

import type { PosterJob } from "@/lib/print/types";

/**
 * Live job state for a batch.
 *
 * Prefers Server-Sent Events, falling back to polling after repeated failures.
 * The fallback is not theoretical: `next dev` restarts on every file save, and
 * an EventSource that cannot reconnect would leave the page silently frozen
 * mid-batch — which looks exactly like the pipeline having hung.
 */
export function useBatchStream(
  batchId: string,
  initial: PosterJob[],
): PosterJob[] {
  const [jobs, setJobs] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const startPolling = () => {
      if (poll || cancelled) return;
      poll = setInterval(async () => {
        try {
          const response = await fetch(`/api/batches/${batchId}`, {
            cache: "no-store",
          });
          if (!response.ok) return;
          const body = await response.json();
          if (!cancelled && Array.isArray(body.jobs)) setJobs(body.jobs);
        } catch {
          // Transient; the next tick will retry.
        }
      }, 2000);
    };

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(`/api/batches/${batchId}/events`);

      source.onmessage = (event) => {
        failures = 0;
        try {
          const data = JSON.parse(event.data);
          if (!cancelled && Array.isArray(data.jobs)) setJobs(data.jobs);
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      };

      source.onerror = () => {
        failures += 1;
        // EventSource retries on its own; two failures means it is not coming
        // back on its own terms, so stop fighting it and poll instead.
        if (failures >= 2) {
          source?.close();
          source = null;
          startPolling();
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      source?.close();
      if (poll) clearInterval(poll);
    };
  }, [batchId]);

  return jobs;
}
