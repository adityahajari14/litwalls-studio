"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PlacementEditor } from "@/components/placement-editor";
import {
  BackLink,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Section,
  Segmented,
} from "@/components/ui";
import { SIZES } from "@/lib/print/sizes";
import {
  physicalScale,
  scaleQuad,
  scaleRect,
} from "@/lib/templates/placement";
import type {
  MockupTemplate,
  PlacementRect,
  Pt,
  SizeId,
} from "@/lib/print/types";

/**
 * Visual editor for a mockup template.
 *
 * Drag the area a poster occupies, per print size. The base area is drawn for
 * one reference size and the rest are derived by real-world scale, so an A5
 * automatically appears as a physically smaller poster on the same wall —
 * which is the honest thing to show a customer choosing between sizes.
 */
export function TemplateEditor({
  templateId,
  initial,
  errors,
}: {
  templateId: string;
  initial: MockupTemplate | null;
  errors: string[];
}) {
  const router = useRouter();

  const [template, setTemplate] = useState<MockupTemplate>(
    initial ?? blankTemplate(templateId),
  );
  const [sizeId, setSizeId] = useState<SizeId>(
    initial?.sizing?.referenceSize ?? "A3",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const perSize = template.sizing?.perSize ?? false;
  const referenceSize = template.sizing?.referenceSize ?? "A3";
  const backgroundUrl = `/api/templates/${templateId}/background?v=${busy ?? ""}`;

  /** The area currently being edited, derived if it has no override. */
  const currentRect = (): PlacementRect => {
    if (template.kind !== "flat") return { x: 0, y: 0, width: 1, height: 1 };
    const override = template.sizing?.overrides?.[sizeId];
    if (override) return override;
    if (!template.sizing || sizeId === referenceSize) return template.rect;
    return scaleRect(template.sizing.base, physicalScale(referenceSize, sizeId));
  };

  const currentQuad = (): [Pt, Pt, Pt, Pt] => {
    if (template.kind !== "perspective") {
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    }
    const override = template.sizing?.overrides?.[sizeId];
    if (override) return override;
    if (!template.sizing || sizeId === referenceSize) return template.corners;
    return scaleQuad(template.sizing.base, physicalScale(referenceSize, sizeId));
  };

  /**
   * Writing an area updates the BASE when editing the reference size, and an
   * OVERRIDE otherwise. Editing the reference therefore moves every derived
   * size with it, which is what makes "nudge the wall position" a one-drag
   * operation rather than four.
   */
  function setRect(area: PlacementRect) {
    setTemplate((current) => {
      if (current.kind !== "flat") return current;
      const sizing = current.sizing ?? { referenceSize, base: current.rect };

      // Editing the reference moves the base, and every derived size follows.
      // That is what makes "nudge the wall position" one drag rather than four.
      if (sizeId === sizing.referenceSize) {
        return {
          ...current,
          rect: area,
          sizing: { ...sizing, base: area },
        };
      }

      return {
        ...current,
        sizing: {
          ...sizing,
          overrides: { ...sizing.overrides, [sizeId]: area },
        },
      };
    });
    setMessage(null);
  }

  function setQuad(area: [Pt, Pt, Pt, Pt]) {
    setTemplate((current) => {
      if (current.kind !== "perspective") return current;
      const sizing = current.sizing ?? { referenceSize, base: current.corners };

      if (sizeId === sizing.referenceSize) {
        return {
          ...current,
          corners: area,
          sizing: { ...sizing, base: area },
        };
      }

      return {
        ...current,
        sizing: {
          ...sizing,
          overrides: { ...sizing.overrides, [sizeId]: area },
        },
      };
    });
    setMessage(null);
  }

  function resetOverride() {
    setTemplate((current) => {
      if (!current.sizing?.overrides) return current;
      if (current.kind === "flat") {
        const overrides = { ...current.sizing.overrides };
        delete overrides[sizeId];
        return { ...current, sizing: { ...current.sizing, overrides } };
      }
      const overrides = { ...current.sizing.overrides };
      delete overrides[sizeId];
      return { ...current, sizing: { ...current.sizing, overrides } };
    });
  }

  /** Switch between a straight-on rect and a four-corner quad. */
  function setKind(kind: "flat" | "perspective") {
    setTemplate((current) => {
      if (current.kind === kind) return current;

      if (kind === "perspective") {
        const r = current.kind === "flat" ? current.rect : null;
        const corners: [Pt, Pt, Pt, Pt] = r
          ? [
              { x: r.x, y: r.y },
              { x: r.x + r.width, y: r.y },
              { x: r.x + r.width, y: r.y + r.height },
              { x: r.x, y: r.y + r.height },
            ]
          : defaultCorners(current.canvas);
        const { ...rest } = current as MockupTemplate & { rect?: unknown };
        return {
          ...rest,
          kind: "perspective",
          corners,
          // Dropped: a rect override cannot be reinterpreted as a quad, and
          // silently keeping stale shapes is worse than starting clean.
          sizing: undefined,
        } as MockupTemplate;
      }

      const quad = current.kind === "perspective" ? current.corners : null;
      const xs = quad?.map((p) => p.x) ?? [];
      const ys = quad?.map((p) => p.y) ?? [];
      const rect: PlacementRect = quad
        ? {
            x: Math.round(Math.min(...xs)),
            y: Math.round(Math.min(...ys)),
            width: Math.round(Math.max(...xs) - Math.min(...xs)),
            height: Math.round(Math.max(...ys) - Math.min(...ys)),
          }
        : defaultRect(current.canvas);
      const { ...rest } = current as MockupTemplate & { corners?: unknown };
      return {
        ...rest,
        kind: "flat",
        rect,
        sizing: undefined,
      } as MockupTemplate;
    });
  }

  function togglePerSize(enabled: boolean) {
    setTemplate((current) => ({
      ...current,
      sizing: {
        referenceSize,
        base:
          current.sizing?.base ??
          (current.kind === "flat"
            ? current.rect
            : (current.corners as [Pt, Pt, Pt, Pt])),
        overrides: current.sizing?.overrides,
        perSize: enabled,
      },
    }) as MockupTemplate);
  }

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template),
      });
      const result = await response.json();
      if (!response.ok) setMessage(result.error ?? "Save failed.");
      else {
        setMessage("Saved");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function uploadBackground(file: File) {
    setBusy("background");
    const form = new FormData();
    form.append("background", file);
    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) setMessage(result.error ?? "Upload failed.");
      else {
        setTemplate((current) => ({ ...current, canvas: result.canvas }));
        setMessage("Background replaced — check the placement still fits.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete the "${template.name}" template?\n\nMockups already rendered into a poster stay where they are.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
    router.push("/templates");
  }

  const hasOverride = Boolean(template.sizing?.overrides?.[sizeId]);

  // Every other size, drawn faintly, so the relative scale is visible.
  const ghosts = SIZES.filter((s) => s.id !== sizeId).map((s) => {
    if (template.kind === "flat") {
      const override = template.sizing?.overrides?.[s.id];
      const rect =
        override ??
        (template.sizing && s.id !== referenceSize
          ? scaleRect(template.sizing.base, physicalScale(referenceSize, s.id))
          : template.rect);
      return { label: s.label, rect };
    }
    const override = template.sizing?.overrides?.[s.id];
    const corners =
      override ??
      (template.sizing && s.id !== referenceSize
        ? scaleQuad(template.sizing.base, physicalScale(referenceSize, s.id))
        : template.corners);
    return { label: s.label, corners };
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/templates">All mockups</BackLink>}
        title={template.name || templateId}
        meta={
          <>
            <Badge>{template.kind === "flat" ? "Straight on" : "Angled"}</Badge>
            <span className="tnum text-ink-400">
              {template.canvas.width} × {template.canvas.height}
            </span>
            {perSize ? <Badge tone="accent">one image per size</Badge> : null}
          </>
        }
        actions={
          <>
            <Button variant="danger" size="sm" onClick={remove} disabled={busy !== null}>
              Delete
            </Button>
            <Button variant="primary" onClick={save} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save template"}
            </Button>
          </>
        }
      />

      {errors.length > 0 && !initial ? (
        <Card className="mt-4 border-warn-500/30 bg-warn-50 p-3">
          <p className="text-sm text-warn-700">
            This template needs setting up: {errors.join(" ")}
          </p>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section
          title="Poster placement"
          action={
            <Segmented
              size="sm"
              value={sizeId}
              onChange={setSizeId}
              options={SIZES.map((s) => ({
                value: s.id,
                label:
                  s.id === referenceSize ? `${s.label} ★` : s.label,
              }))}
            />
          }
        >
          <PlacementEditor
            backgroundUrl={backgroundUrl}
            canvas={template.canvas}
            ghosts={ghosts}
            mode={
              template.kind === "flat"
                ? { kind: "flat", rect: currentRect(), onChange: setRect }
                : {
                    kind: "perspective",
                    corners: currentQuad(),
                    onChange: setQuad,
                  }
            }
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span>
              {template.kind === "flat"
                ? "Drag the box to move it; drag a corner to resize."
                : "Drag each numbered corner onto the wall, in order: top-left, top-right, bottom-right, bottom-left."}
            </span>
            {sizeId === referenceSize ? (
              <Badge tone="accent">
                reference size — other sizes scale from this
              </Badge>
            ) : hasOverride ? (
              <>
                <Badge tone="warn">custom for {sizeId}</Badge>
                <Button size="sm" variant="ghost" onClick={resetOverride}>
                  Reset to auto
                </Button>
              </>
            ) : (
              <Badge>
                auto — {Math.round(physicalScale(referenceSize, sizeId) * 100)}%
                of {referenceSize}
              </Badge>
            )}
          </div>
        </Section>

        <div className="space-y-6">
          <Section title="Details">
            <div className="space-y-2.5">
              <Field label="Name">
                <Input
                  value={template.name}
                  onChange={(e) =>
                    setTemplate({ ...template, name: e.target.value })
                  }
                />
              </Field>

              <Field label="Wall angle">
                <Segmented
                  value={template.kind}
                  onChange={setKind}
                  options={[
                    { value: "flat", label: "Straight on" },
                    { value: "perspective", label: "Angled" },
                  ]}
                />
              </Field>

              <Field
                label={`Shadow (${Math.round((template.shadow ?? 0) * 100)}%)`}
              >
                <input
                  type="range"
                  min={0}
                  max={60}
                  value={Math.round((template.shadow ?? 0) * 100)}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      shadow: Number(e.target.value) / 100,
                    })
                  }
                  className="w-full accent-[var(--color-accent-600)]"
                />
              </Field>
            </div>
          </Section>

          <Section title="Sizes">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-600">
              <input
                type="checkbox"
                checked={perSize}
                onChange={(e) => togglePerSize(e.target.checked)}
                className="mt-0.5 accent-[var(--color-accent-600)]"
              />
              <span>
                Render one mockup per size
                <span className="mt-0.5 block text-xs text-ink-400">
                  Each variant gets its own image showing the poster at its true
                  scale. Four times the render time, so use it on your best
                  template rather than all of them.
                </span>
              </span>
            </label>

            <Field label="Reference size">
              <select
                value={referenceSize}
                onChange={(e) => {
                  const next = e.target.value as SizeId;
                  setTemplate((current) => ({
                    ...current,
                    sizing: {
                      referenceSize: next,
                      base:
                        current.sizing?.base ??
                        (current.kind === "flat"
                          ? current.rect
                          : (current.corners as [Pt, Pt, Pt, Pt])),
                      overrides: current.sizing?.overrides,
                      perSize: current.sizing?.perSize,
                    },
                  }) as MockupTemplate);
                  setSizeId(next);
                }}
                className="w-full rounded-md border border-paper-300 bg-paper-200 px-2.5 py-1.5 text-sm"
              >
                {SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="mt-1 text-xs text-ink-400">
              The size you draw the box for. Everything else scales from it —
              an A5 is {Math.round(physicalScale("A3", "A5") * 100)}% of an A3.
            </p>
          </Section>

          <Section title="Background">
            <label className="block">
              <span className="sr-only">Replace background</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadBackground(file);
                  e.target.value = "";
                }}
                className="block w-full text-xs text-ink-500 file:mr-2 file:rounded file:border file:border-paper-300 file:bg-paper-200 file:px-2 file:py-1 file:text-xs file:text-ink-700"
              />
            </label>
            <p className="mt-1 text-xs text-ink-400">
              Replacing keeps the placement, but check it still lines up.
            </p>
          </Section>

          {message ? (
            <p className="text-sm text-ink-600">{message}</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function defaultRect(canvas: { width: number; height: number }): PlacementRect {
  const height = Math.round(canvas.height * 0.5);
  const width = Math.round(height * 0.707);
  return {
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
    width,
    height,
  };
}

function defaultCorners(canvas: {
  width: number;
  height: number;
}): [Pt, Pt, Pt, Pt] {
  const r = defaultRect(canvas);
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

function blankTemplate(id: string): MockupTemplate {
  // Only reached for a folder with a background but no template.json yet. The
  // canvas is corrected as soon as the background loads.
  const canvas = { width: 2000, height: 1500 };
  return {
    id,
    name: id.replace(/-/g, " "),
    kind: "flat",
    background: "background.jpg",
    canvas,
    rect: defaultRect(canvas),
    shadow: 0.22,
  };
}
