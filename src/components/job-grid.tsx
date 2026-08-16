"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { BulkEditor } from "@/components/bulk-editor";
import { Badge, Button, Empty } from "@/components/ui";
import { useBatchStream } from "@/components/use-batch-stream";
import { COVERAGE_WARN, type PosterJob } from "@/lib/print/types";

/**
 * The batch's posters as a thumbnail grid.
 *
 * A list of filenames told you nothing about the thing you actually care
 * about — what the poster looks like cropped and mocked up. Seeing twenty
 * thumbnails at once is how you spot the one that went wrong without opening
 * twenty screens.
 */
export function JobGrid({
  batchId,
  initialJobs,
}: {
  batchId: string;
  initialJobs: PosterJob[];
}) {
  const router = useRouter();
  const jobs = useBatchStream(batchId, initialJobs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const counts = useMemo(() => {
    let ready = 0;
    let approved = 0;
    let published = 0;
    let failed = 0;
    for (const job of jobs) {
      if (job.status.kind === "failed") failed++;
      else if (job.stage === "published") published++;
      else if (job.stage === "approved") approved++;
      else if (job.status.kind === "needs-review") ready++;
    }
    return { ready, approved, published, failed };
  }, [jobs]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  async function approveSelected() {
    setBusy(true);
    try {
      await fetch(`/api/batches/${batchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: selected.size > 0 ? [...selected] : undefined,
        }),
      });
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeJob(job: PosterJob) {
    const published = Boolean(job.shopify?.productId);
    if (
      !confirm(
        `Remove "${job.metadata?.subject || job.sourceName}" from this batch?\n\n` +
          "Deletes the local artwork and rendered files." +
          (published
            ? "\n\nIt is already published — the Shopify product stays live."
            : ""),
      )
    ) {
      return;
    }

    await fetch(`/api/batches/${batchId}/jobs/${job.id}`, { method: "DELETE" });
    setSelected((current) => {
      const next = new Set(current);
      next.delete(job.id);
      return next;
    });
    router.refresh();
  }

  if (jobs.length === 0) {
    return (
      <Empty title="No posters yet">
        Drop artwork above to get started. JPG, PNG, WebP, TIFF or AVIF.
      </Empty>
    );
  }

  const approvable = jobs.filter(
    (job) => job.status.kind === "needs-review" && job.stage !== "approved",
  ).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span>{jobs.length} posters</span>
        {counts.ready > 0 ? <Badge tone="accent">{counts.ready} to review</Badge> : null}
        {counts.approved > 0 ? <Badge tone="ok">{counts.approved} approved</Badge> : null}
        {counts.published > 0 ? (
          <Badge tone="ok">{counts.published} published</Badge>
        ) : null}
        {counts.failed > 0 ? <Badge tone="danger">{counts.failed} failed</Badge> : null}

        <span className="ml-auto flex items-center gap-2">
          {selected.size > 0 ? (
            <>
              <span>{selected.size} selected</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
              <Button size="sm" onClick={() => setBulkOpen((v) => !v)}>
                Edit {selected.size}
              </Button>
            </>
          ) : null}
          {approvable > 0 ? (
            <Button size="sm" onClick={approveSelected} disabled={busy}>
              {busy
                ? "Approving…"
                : selected.size > 0
                  ? `Approve ${selected.size}`
                  : `Approve all ${approvable} ready`}
            </Button>
          ) : null}
        </span>
      </div>

      {bulkOpen && selected.size > 0 ? (
        <BulkEditor
          batchId={batchId}
          count={selected.size}
          jobIds={[...selected]}
          onDone={() => {
            setBulkOpen(false);
            setSelected(new Set());
            router.refresh();
          }}
        />
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            selected={selected.has(job.id)}
            onToggle={() => toggle(job.id)}
            onDelete={() => removeJob(job)}
          />
        ))}
      </ul>
    </>
  );
}

function JobCard({
  job,
  selected,
  onToggle,
  onDelete,
}: {
  job: PosterJob;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  // Prefer a mockup: it is what the product will actually look like. Fall
  // back to the A3 render, then to nothing while the job is still processing.
  const preview =
    job.mockups[0]?.relPath ??
    job.assets.find((a) => a.sizeId === "A3")?.relPath ??
    null;

  const lowRes = [...new Set(job.assets.filter((a) => a.lowRes).map((a) => a.sizeId))];
  const coverage = job.probe?.coverage ?? 1;
  const reviewable = job.assets.length > 0;
  const duplicates = job.probe?.duplicates ?? [];

  return (
    <li className="group relative">
      <div
        className={`overflow-hidden rounded-[--radius-card] border bg-gradient-to-b from-paper-200/80 to-paper-100 transition-all duration-200 ${
          selected
            ? "border-accent-500"
            : "border-paper-300/80 hover:border-paper-400"
        }`}
      >
        {/* A plain ground, not the checkerboard: these renders are opaque
            JPEGs, so a checker pattern only fills the letterbox bars with
            noise. The checkerboard belongs where transparency is real. */}
        <div className="relative aspect-[4/3] bg-paper-50">
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/assets/${job.batchId}/${job.id}/${preview}`}
              alt=""
              // Contain, not cover: a room mockup is mostly room, and cropping
              // it to fill the card can cut the poster itself out of frame —
              // which defeats the point of showing a thumbnail at all.
              className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center gap-1.5 text-xs text-ink-400">
              {job.status.kind === "running" ? (
                <>
                  <span className="breathe size-1.5 rounded-full bg-accent-500" />
                  <span className="font-mono uppercase tracking-[0.14em]">
                    processing
                  </span>
                </>
              ) : (
                <span className="font-mono uppercase tracking-[0.14em]">
                  queued
                </span>
              )}
            </div>
          )}

          {reviewable ? (
            <label
              className="absolute left-2 top-2 grid size-5 cursor-pointer place-items-center rounded border border-paper-300 bg-paper-200/90 shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggle}
                className="size-3.5 accent-[var(--color-accent-500)]"
                aria-label={`Select ${job.sourceName}`}
              />
            </label>
          ) : null}

          {/* Shown on hover only: a delete button always visible on every card
              in a grid of thirty is an accident waiting to happen. */}
          <button
            onClick={onDelete}
            aria-label={`Remove ${job.sourceName}`}
            title="Remove from batch"
            className="absolute right-2 top-2 grid size-6 place-items-center rounded border border-paper-400/70 bg-paper-100/90 text-ink-500 opacity-0 transition-opacity hover:border-danger-500/60 hover:text-danger-700 focus-visible:opacity-100 group-hover:opacity-100"
          >
            ×
          </button>
        </div>

        <div className="p-2.5">
          {reviewable ? (
            <Link
              href={`/batches/${job.batchId}/jobs/${job.id}`}
              className="block truncate text-sm font-medium text-ink-900 hover:text-accent-600"
              title={job.metadata?.subject || job.sourceName}
            >
              {job.metadata?.subject || job.sourceName}
            </Link>
          ) : (
            <span className="block truncate text-sm text-ink-500">
              {job.sourceName}
            </span>
          )}

          <div className="mt-1.5 flex flex-wrap gap-1">
            <StatusBadge job={job} />
            {duplicates.length > 0 ? (
              <Badge
                tone="warn"
                title={`Looks like: ${duplicates.map((d) => d.title).join(", ")}`}
              >
                possible duplicate
              </Badge>
            ) : null}
            {job.probe?.upscaled ? <Badge tone="warn">upscaled</Badge> : null}
            {coverage < COVERAGE_WARN ? (
              <Badge tone="warn">{Math.round(coverage * 100)}% used</Badge>
            ) : null}
            {lowRes.length > 0 ? (
              <Badge tone="danger" title={`Below 250dpi at ${lowRes.join(", ")}`}>
                low-res
              </Badge>
            ) : null}
            {job.drive ? <Badge tone="neutral">drive</Badge> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ job }: { job: PosterJob }) {
  if (job.status.kind === "failed") {
    return (
      <Badge tone="danger" title={job.status.message}>
        failed
      </Badge>
    );
  }
  if (job.stage === "published") return <Badge tone="ok">published</Badge>;
  if (job.stage === "approved") return <Badge tone="ok">approved</Badge>;
  if (job.status.kind === "needs-review") return <Badge tone="accent">review</Badge>;
  if (job.status.kind === "running") return <Badge>{job.status.stage}…</Badge>;
  return <Badge>{job.stage}</Badge>;
}
