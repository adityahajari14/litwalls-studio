"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CropEditor } from "@/components/crop-editor";
import { PriceTable } from "@/components/price-table";
import { SIZES } from "@/lib/print/sizes";
import { CATEGORY_TAG, formatTitle } from "@/lib/print/title";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";
import type {
  Batch,
  NormRect,
  PosterJob,
  SizeId,
} from "@/lib/print/types";

export function ReviewScreen({
  batch,
  job: initialJob,
  inheritedPrices,
  inheritedCompare,
  templates,
}: {
  batch: Batch;
  job: PosterJob;
  inheritedPrices: Prices;
  inheritedCompare: PartialPriceTable;
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [sizeId, setSizeId] = useState<SizeId>("A3");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Local edits, applied on save. Kept separate from `job` so an unsaved crop
  // drag does not look persisted when it is not.
  const [crops, setCrops] = useState(job.cropOverrides);
  const [subject, setSubject] = useState(job.metadata?.subject ?? "");
  const [subtitle, setSubtitle] = useState(job.metadata?.subtitle ?? "");
  const [tags, setTags] = useState((job.metadata?.tags ?? []).join(", "));
  const [altText, setAltText] = useState(job.metadata?.altText ?? "");
  const [selected, setSelected] = useState(
    job.selectedTemplateIds.length > 0
      ? job.selectedTemplateIds
      : job.mockups.map((m) => m.templateId),
  );

  const asset = (relPath: string) =>
    `/api/assets/${job.batchId}/${job.id}/${relPath}`;
  const masterUrl = asset("master.png");

  const source = job.probe
    ? { width: job.probe.width, height: job.probe.height }
    : { width: 1000, height: 1400 };

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/batches/${job.batchId}/jobs/${job.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Save failed.");
        return null;
      }
      setJob(result.job);
      return result.job as PosterJob;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const saved = await patch(
      {
        metadata: {
          subject,
          subtitle,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          altText,
        },
        cropOverrides: crops,
        selectedTemplateIds: selected,
      },
      "save",
    );
    if (saved) setMessage("Saved.");
  }

  async function rerender() {
    // Saved first: re-rendering reads the job from disk, so unsaved crop
    // changes would otherwise be silently ignored.
    const saved = await patch(
      { cropOverrides: crops, selectedTemplateIds: selected },
      "rerender",
    );
    if (!saved) return;

    setBusy("rerender");
    try {
      const response = await fetch(
        `/api/batches/${job.batchId}/jobs/${job.id}/rerender`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Re-render failed.");
        return;
      }
      setJob(result.job);
      setMessage("Re-rendered.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    const saved = await patch({ approved: true }, "approve");
    if (saved) router.push(`/batches/${job.batchId}`);
  }

  const previewTitle = subject
    ? formatTitle(
        { subject, sequence: job.metadata?.sequence ?? 1, subtitle },
        batch.category,
      )
    : "—";

  const sizeAssets = job.assets.filter((a) => a.sizeId === sizeId);
  const lowRes = sizeAssets.some((a) => a.lowRes);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {job.sourceName}
        </h1>
        <span className="flex gap-1.5 text-[11px]">
          {job.metadata?.source === "fallback" ? (
            <Pill tone="warn">no AI — check the title</Pill>
          ) : null}
          {job.probe?.upscaled ? <Pill tone="warn">upscaled</Pill> : null}
          {job.probe && job.probe.coverage < 0.5 ? (
            <Pill tone="warn">
              {Math.round(job.probe.coverage * 100)}% of artwork used
            </Pill>
          ) : null}
        </span>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Left: crop and mockups ─────────────────────────────────── */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {SIZES.map((size) => (
              <button
                key={size.id}
                onClick={() => setSizeId(size.id)}
                className={`rounded border px-2.5 py-1 text-xs ${
                  sizeId === size.id
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {size.label}
              </button>
            ))}
            {crops[sizeId] ? (
              <button
                onClick={() => {
                  const next = { ...crops };
                  delete next[sizeId];
                  setCrops(next);
                }}
                className="text-xs text-zinc-500 underline underline-offset-4"
              >
                Reset to auto
              </button>
            ) : null}
            {lowRes ? (
              <span className="text-xs text-red-600 dark:text-red-400">
                below 250dpi at this size
              </span>
            ) : null}
          </div>

          <div className="mt-3">
            <CropEditor
              imageUrl={masterUrl}
              source={source}
              sizeId={sizeId}
              kind={job.kind}
              focal={job.focal}
              value={crops[sizeId] ?? null}
              onChange={(rect: NormRect) =>
                setCrops({ ...crops, [sizeId]: rect })
              }
            />
            <p className="mt-2 text-xs text-zinc-500">
              Drag to reposition. The box is locked to this size&rsquo;s aspect
              ratio.
              {job.kind === "split3"
                ? " Vertical lines show where the panels divide."
                : ""}
              {job.focal?.source === "gemini"
                ? " The dashed box is what the model identified as the subject."
                : ""}
            </p>
          </div>

          {job.mockups.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                Mockups
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {job.mockups.map((mockup) => (
                  <figure key={mockup.templateId}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset(mockup.relPath)}
                      alt={mockup.templateId}
                      className="w-full rounded border border-zinc-200 dark:border-zinc-800"
                    />
                    <figcaption className="mt-1 text-[11px] text-zinc-500">
                      {mockup.templateId}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Right: metadata, prices, actions ───────────────────────── */}
        <div className="space-y-6">
          <section>
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Title
            </h2>
            <label className="mt-2 block text-xs text-zinc-500">
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
              />
            </label>
            <label className="mt-2 block text-xs text-zinc-500">
              Subtitle (optional)
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="e.g. Star Boy"
                className="mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
              />
            </label>
            <p className="mt-2 rounded bg-zinc-100 px-2 py-1.5 text-xs dark:bg-zinc-900">
              {previewTitle}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              The number is assigned at publish, from the live catalogue — the
              one shown here is a placeholder.
            </p>
          </section>

          <section>
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Tags
            </h2>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Marvel, Spider Man"
              className="mt-2 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              <code>{CATEGORY_TAG[batch.category]}</code> is added
              automatically — it is what puts this in the collection.
            </p>
          </section>

          <section>
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Alt text
            </h2>
            <textarea
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              rows={2}
              maxLength={125}
              className="mt-2 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
            />
          </section>

          {templates.length > 0 ? (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                Mockup templates
              </h2>
              <div className="mt-2 space-y-1">
                {templates.map((template) => (
                  <label
                    key={template.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(template.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, template.id]
                            : selected.filter((id) => id !== template.id),
                        )
                      }
                    />
                    {template.name}
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Prices for this poster
            </h2>
            <div className="mt-2">
              <PriceTable
                values={job.priceOverrides}
                compareValues={job.compareAtOverrides}
                inherited={inheritedPrices}
                inheritedCompare={inheritedCompare}
                emptyMeans="Blank uses the batch or dashboard price shown in grey."
              />
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              onClick={save}
              disabled={busy !== null}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              onClick={rerender}
              disabled={busy !== null}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
            >
              {busy === "rerender" ? "Rendering…" : "Save & re-render"}
            </button>
            <button
              onClick={approve}
              disabled={busy !== null}
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Approve
            </button>
            {message ? (
              <span className="text-xs text-zinc-500">{message}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warn" | "bad";
}) {
  const tones = {
    warn: "border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-400",
    bad: "border-red-400 text-red-700 dark:border-red-800 dark:text-red-400",
  };
  return (
    <span className={`rounded-full border px-1.5 py-0.5 ${tones[tone]}`}>
      {children}
    </span>
  );
}
