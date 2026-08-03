"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(`/api/batches/${batchId}/run`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        setResult(body.error ?? "Run failed.");
      } else if (body.failed > 0) {
        setResult(`${body.ran} processed, ${body.failed} failed`);
      } else if (body.ran === 0) {
        setResult("Nothing left to process");
      } else {
        setResult(`${body.ran} processed`);
      }
      router.refresh();
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {result ? <span className="text-xs text-zinc-500">{result}</span> : null}
      <button
        onClick={run}
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Processing…" : "Process all"}
      </button>
    </span>
  );
}
