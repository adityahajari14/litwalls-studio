"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";

export function RunButton({
  batchId,
  pending,
}: {
  batchId: string;
  pending?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/batches/${batchId}/run`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) setResult(body.error ?? "Run failed");
      else if (body.failed > 0) setResult(`${body.failed} failed`);
      else if (body.ran === 0) setResult("Nothing to process");
      router.refresh();
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {result ? (
        <span className="animate-fade-rise text-xs text-ink-500">{result}</span>
      ) : null}
      <Button variant="primary" onClick={run} disabled={busy}>
        {busy ? (
          <>
            {/* The same breathing dot the job grid uses for "processing" —
                one motif for "something is running", not a different spinner
                per component. */}
            <span aria-hidden className="breathe size-1.5 rounded-full bg-white" />
            Processing…
          </>
        ) : pending ? (
          `Process ${pending}`
        ) : (
          "Process all"
        )}
      </Button>
    </span>
  );
}
