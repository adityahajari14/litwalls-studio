"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CropEditor } from "@/components/crop-editor";
import { GalleryEditor, type LibraryOption } from "@/components/gallery-editor";
import { PriceTable } from "@/components/price-table";
import {
  Badge,
  BackLink,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Section,
  Segmented,
  Textarea,
} from "@/components/ui";
import { sizesFor } from "@/lib/print/sizes";
import { formatTitle } from "@/lib/print/title";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";
import type {
  Batch,
  NormRect,
  PosterJob,
  ProductImageRef,
  SizeId,
} from "@/lib/print/types";

export function ReviewScreen({
  batch,
  job: initialJob,
  inheritedPrices,
  inheritedCompare,
  templates,
  library,
  position,
}: {
  batch: Batch;
  job: PosterJob;
  inheritedPrices: Prices;
  inheritedCompare: PartialPriceTable;
  templates: { id: string; name: string }[];
  library: LibraryOption[];
  position: {
    index: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
  };
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [sizeId, setSizeId] = useState<SizeId>("A3");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Local edits, applied on save. Kept apart from `job` so an unsaved crop
  // drag never looks persisted when it is not.
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
  // Default the gallery to every rendered mockup, so a poster nobody curates
  // still publishes with proper images rather than none.
  const [images, setImages] = useState<ProductImageRef[]>(
    job.images.length > 0
      ? job.images
      : job.mockups.map((m) => ({
          kind: "mockup" as const,
          templateId: m.templateId,
        })),
  );

  const assetUrl = useCallback(
    (relPath: string) => `/api/assets/${job.batchId}/${job.id}/${relPath}`,
    [job.batchId, job.id],
  );

  const source = job.probe
    ? { width: job.probe.width, height: job.probe.height }
    : { width: 1000, height: 1400 };

  const body = useCallback(
    () => ({
      metadata: {
        subject,
        subtitle,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        altText,
      },
      cropOverrides: crops,
      selectedTemplateIds: selected,
      images,
    }),
    [subject, subtitle, tags, altText, crops, selected, images],
  );

  const patch = useCallback(
    async (payload: Record<string, unknown>, label: string) => {
      setBusy(label);
      setMessage(null);
      try {
        const response = await fetch(
          `/api/batches/${job.batchId}/jobs/${job.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
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
    },
    [job.batchId, job.id],
  );

  const save = useCallback(async () => {
    if (await patch(body(), "save")) setMessage("Saved");
  }, [patch, body]);

  async function rerender() {
    // Saved first: re-render reads the job from disk, so unsaved crop changes
    // would otherwise be silently ignored.
    if (!(await patch(body(), "rerender"))) return;

    setBusy("rerender");
    try {
      const response = await fetch(
        `/api/batches/${job.batchId}/jobs/${job.id}/rerender`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) setMessage(result.error ?? "Re-render failed.");
      else {
        setJob(result.job);
        setMessage("Re-rendered");
      }
    } finally {
      setBusy(null);
    }
  }

  const go = useCallback(
    (id: string | null) => {
      if (id) router.push(`/batches/${job.batchId}/jobs/${id}`);
    },
    [router, job.batchId],
  );

  const approve = useCallback(async () => {
    if (!(await patch({ ...body(), approved: true }, "approve"))) return;
    // Straight on to the next poster: approving twenty in a row should not
    // mean twenty round trips through the batch list.
    if (position.nextId) go(position.nextId);
    else router.push(`/batches/${job.batchId}`);
  }, [patch, body, position.nextId, go, router, job.batchId]);

  async function fileToDrive() {
    if (!(await patch(body(), "drive"))) return;
    setBusy("drive");
    try {
      const response = await fetch(
        `/api/batches/${job.batchId}/jobs/${job.id}/drive`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) setMessage(result.error ?? "Drive upload failed.");
      else {
        setJob(result.job);
        setMessage(`Filed ${result.files} files to Drive`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remove "${job.sourceName}" from this batch?\n\nDeletes the local files. Anything already published to Shopify or filed to Drive stays where it is.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    await fetch(`/api/batches/${job.batchId}/jobs/${job.id}`, {
      method: "DELETE",
    });
    router.push(`/batches/${job.batchId}`);
  }

  /**
   * Keyboard shortcuts. Reviewing a batch is a repetitive two-key job —
   * glance, approve, next — and reaching for the mouse each time is most of
   * the effort.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Never hijack a key while someone is typing into a field.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j" || event.key === "ArrowRight") go(position.nextId);
      else if (event.key === "k" || event.key === "ArrowLeft") go(position.prevId);
      else if (event.key === "a") void approve();
      else if (event.key === "s") void save();
      else return;

      event.preventDefault();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, position.nextId, position.prevId, approve, save]);

  const previewTitle = subject
    ? formatTitle(
        { subject, sequence: job.metadata?.sequence ?? 1, subtitle },
        batch.category,
      )
    : "—";

  const lowRes = job.assets.some((a) => a.sizeId === sizeId && a.lowRes);
  const aiCrop = job.aiCrops?.[sizeId];
  const published = Boolean(job.shopify?.productId);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href={`/batches/${job.batchId}`}>{batch.name}</BackLink>}
        title={job.metadata?.subject || job.sourceName}
        meta={
          <>
            <span className="truncate text-ink-400">{job.sourceName}</span>
            {job.metadata?.source === "fallback" ? (
              <Badge tone="warn">AI unavailable — check the title</Badge>
            ) : null}
            {job.probe?.upscaled ? <Badge tone="warn">upscaled</Badge> : null}
            {job.probe && job.probe.coverage < 0.5 ? (
              <Badge tone="warn">
                {Math.round(job.probe.coverage * 100)}% of artwork used
              </Badge>
            ) : null}
            {/* The batch picks one collection, but batches are often mixed.
                A suggestion is never applied automatically — moving a product
                changes its title suffix, and doing that silently would be
                worse than the occasional misfile. */}
            {job.metadata?.suggestedCategoryId &&
            job.metadata.suggestedCategoryId !== batch.category.id ? (
              <Badge
                tone="warn"
                title={`The model thinks this belongs in "${job.metadata.suggestedCategoryId}" rather than ${batch.category.label}.`}
              >
                maybe {job.metadata.suggestedCategoryId}?
              </Badge>
            ) : null}
            {published ? <Badge tone="ok">published</Badge> : null}
            {job.drive ? <Badge tone="ok">on Drive</Badge> : null}
          </>
        }
        actions={
          <>
            {position.total > 1 ? (
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={() => go(position.prevId)}
                  disabled={!position.prevId}
                  title="Previous (K)"
                >
                  ←
                </Button>
                <span className="tnum px-1 text-xs text-ink-400">
                  {position.index + 1} / {position.total}
                </span>
                <Button
                  size="sm"
                  onClick={() => go(position.nextId)}
                  disabled={!position.nextId}
                  title="Next (J)"
                >
                  →
                </Button>
              </span>
            ) : null}
            <Button variant="danger" size="sm" onClick={remove} disabled={busy !== null}>
              Delete
            </Button>
          </>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Left: crop and mockups ──────────────────────────────────── */}
        <div className="space-y-6">
          <Section
            title="Crop"
            action={
              <span className="flex items-center gap-2">
                {lowRes ? <Badge tone="danger">below 250dpi</Badge> : null}
                {aiCrop && !crops[sizeId] ? (
                  <Badge tone="accent" title={aiCrop.reason}>
                    AI reframed
                  </Badge>
                ) : null}
                {crops[sizeId] ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = { ...crops };
                      delete next[sizeId];
                      setCrops(next);
                    }}
                  >
                    Reset to auto
                  </Button>
                ) : null}
                <Segmented
                  size="sm"
                  value={sizeId}
                  onChange={setSizeId}
                  options={sizesFor(job.kind).map((s) => ({
                    value: s.id,
                    label: s.label,
                  }))}
                />
              </span>
            }
          >
            <Card className="overflow-hidden p-2">
              <CropEditor
                imageUrl={assetUrl("master.png")}
                source={source}
                sizeId={sizeId}
                kind={job.kind}
                focal={job.focal}
                value={crops[sizeId] ?? null}
                onChange={(rect: NormRect) =>
                  setCrops({ ...crops, [sizeId]: rect })
                }
              />
            </Card>
            <p className="mt-2 text-xs text-ink-400">
              Drag to reposition; the box is locked to this size&rsquo;s aspect
              ratio.
              {job.kind === "split3"
                ? " Vertical lines mark where the three panels divide."
                : ""}
              {job.focal?.source === "gemini"
                ? " The dashed box is what the model identified as the subject."
                : ""}
            </p>
          </Section>

          {job.mockups.length > 0 ? (
            <Section title="Mockups">
              <div className="grid grid-cols-2 gap-3">
                {job.mockups.map((mockup) => (
                  <Card key={mockup.templateId} className="overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={assetUrl(mockup.relPath)}
                      alt={mockup.templateId}
                      className="w-full"
                    />
                    <p className="truncate px-2.5 py-1.5 text-xs text-ink-400">
                      {mockup.templateId}
                    </p>
                  </Card>
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        {/* ── Right: metadata, gallery, prices ────────────────────────── */}
        <div className="space-y-6">
          <Section title="Product title">
            <div className="space-y-2.5">
              <Field label="Subject">
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Spider Man"
                />
              </Field>
              <Field
                label="Subtitle"
                hint="Only for a specific album or storyline. Usually blank."
              >
                <Input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Star Boy"
                />
              </Field>
              <div className="rounded-md bg-paper-100 px-2.5 py-2">
                <p className="text-sm font-medium text-ink-900">{previewTitle}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">
                  The number is assigned at publish from the live catalogue.
                </p>
              </div>
            </div>
          </Section>

          <Section title="Tags">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Spider Man, Movies"
            />
            <p className="mt-1 text-xs text-ink-400">
              <code className="font-mono">{batch.category.tag ?? "none"}</code>{" "}
              is added automatically — it is what puts this in the collection.
            </p>
          </Section>

          <Section title="Alt text">
            <Textarea
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              rows={2}
              maxLength={125}
              placeholder="Spider-Man swinging between skyscrapers at sunset"
            />
          </Section>

          <Section title="Product images">
            <GalleryEditor
              mockups={job.mockups}
              library={library}
              value={images}
              onChange={setImages}
              assetUrl={assetUrl}
            />
          </Section>

          {templates.length > 0 ? (
            <Section title="Render with">
              <div className="space-y-1">
                {templates.map((template) => (
                  <label
                    key={template.id}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink-600"
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
                      className="accent-[var(--color-accent-600)]"
                    />
                    {template.name}
                  </label>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Prices">
            <PriceTable
              sizes={sizesFor(job.kind)}
              values={job.priceOverrides}
              compareValues={job.compareAtOverrides}
              inherited={inheritedPrices}
              inheritedCompare={inheritedCompare}
              emptyMeans="Blank uses the batch or dashboard price shown in grey."
            />
          </Section>
        </div>
      </div>

      {/* Sticky action bar: approving is the whole point of this screen, so it
          must never be scrolled off. */}
      <div className="sticky bottom-0 mt-8 -mx-6 border-t border-paper-200 bg-paper-50/90 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button onClick={rerender} disabled={busy !== null}>
            {busy === "rerender" ? "Rendering…" : "Save & re-render"}
          </Button>
          <Button onClick={fileToDrive} disabled={busy !== null}>
            {busy === "drive" ? "Filing…" : job.drive ? "Re-file to Drive" : "File to Drive"}
          </Button>

          <Button
            variant="primary"
            onClick={approve}
            disabled={busy !== null}
            className="ml-auto"
          >
            {busy === "approve"
              ? "Approving…"
              : position.nextId
                ? "Approve & next"
                : "Approve"}
          </Button>

          {message ? (
            <span className="w-full text-xs text-ink-500 sm:w-auto">{message}</span>
          ) : (
            <span className="hidden text-[11px] text-ink-400 sm:inline">
              J / K to move · A to approve · S to save
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
