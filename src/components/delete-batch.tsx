"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Delete a whole batch.
 *
 * Typed confirmation rather than a plain OK, because this removes original
 * artwork that exists nowhere else — the workspace is gitignored and has no
 * history. I have deleted a batch by accident on this project once already;
 * making the destructive path require reading and typing is the cheapest
 * insurance there is.
 */
export function DeleteBatch({
  batchId,
  name,
  posterCount,
  publishedCount,
}: {
  batchId: string;
  name: string;
  posterCount: number;
  publishedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete batch
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-danger-500/40 bg-danger-50 p-3">
      <p className="text-sm text-danger-700">
        Delete <strong>{name}</strong> and all {posterCount} poster
        {posterCount === 1 ? "" : "s"}?
      </p>
      <p className="mt-1 text-xs text-ink-500">
        Removes the original artwork and every rendered file. This cannot be
        undone — export the batch first if you might want it back.
        {publishedCount > 0 ? (
          <>
            {" "}
            The {publishedCount} already published to Shopify stay live.
          </>
        ) : null}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type the batch name to confirm"
          aria-label="Type the batch name to confirm"
          className="h-8 flex-1 rounded-lg border border-paper-300 bg-paper-200 px-2.5 text-sm text-ink-900 placeholder:text-ink-400"
        />
        <Button
          variant="danger"
          size="sm"
          disabled={busy || typed.trim() !== name.trim()}
          onClick={remove}
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
