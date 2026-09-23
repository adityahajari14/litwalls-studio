"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { SIZES, SPLIT_SIZE_IDS } from "@/lib/print/sizes";
import { MAX_PANEL_GAP } from "@/lib/templates/schema";
import {
  hasLandscapePlacement,
  hasSplitPlacement,
  hasSplitVerticalPlacement,
  physicalScale,
  quadForSize,
  rectForSize,
  trueAspectRatio,
} from "@/lib/templates/placement";
import type {
  MockupTemplate,
  PlacementRect,
  PosterKind,
  Pt,
  SizeId,
} from "@/lib/print/types";

const SUIT_FORMATS: { value: PosterKind; label: string }[] = [
  { value: "normal", label: "Single poster" },
  { value: "split3", label: "Split-3 set" },
];
const SUIT_ORIENTATIONS: { value: "portrait" | "landscape"; label: string }[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

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
  defaultGap,
  initialProcessing = false,
}: {
  templateId: string;
  initial: MockupTemplate | null;
  errors: string[];
  /** The dashboard's split-panel gap default — what a template with no
   *  `panelGap` of its own actually renders at, so this editor's "blank
   *  means" story stays true after that default is changed in Settings. */
  defaultGap: number;
  /** True when a background job (upscale + AI placement) is still running for
   *  this template. The editor polls until it clears, then re-loads. */
  initialProcessing?: boolean;
}) {
  const router = useRouter();

  const [template, setTemplate] = useState<MockupTemplate>(
    initial ?? blankTemplate(templateId),
  );
  const [sizeId, setSizeId] = useState<SizeId>(
    initial?.sizing?.referenceSize ?? "A3",
  );
  /**
   * Which poster format the placement box below is being edited for. A
   * split-3 set is an assembled triptych — roughly twice as wide as it is
   * tall — and needs its own box on the wall, not the single sheet's
   * portrait one. It has no separate reference size: it is authored against
   * the same one as the normal placement.
   */
  const [format, setFormat] = useState<"normal" | "split3">("normal");
  /**
   * Which way round the box being placed is - read against `format` to know
   * which pair of fields it picks between.
   *
   * For a SINGLE poster this is the landscape placement selector: Vertical
   * ("portrait") edits `sizing`, Horizontal ("landscape") edits
   * `landscapeSizing`. It used to be a third tab beside "Single poster",
   * with this toggle merely flipping whichever box was on screen, and the
   * two overlapped badly: flipping the box under "Single poster" wrote a
   * landscape-shaped rect into `sizing`, the box the renderer uses for
   * PORTRAIT posters. One control, one meaning.
   *
   * For a SPLIT-3 set the SAME control, and the same two values, pick
   * between `splitSizing` (Horizontal - the default, roughly 2.12:1 wide)
   * and `splitVerticalSizing` (Vertical - the same assembled panel set shown
   * turned on a particular wall photo). These used to be ONE field that the
   * toggle flipped in place, which meant repositioning the box for a
   * vertical preview overwrote whatever had been authored for the
   * horizontal one. Two independent fields means editing one never touches
   * the other - see `setRect` / `setQuad`.
   */
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "portrait",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(initialProcessing);

  /**
   * While a background job is running, poll for it to finish and then pull in
   * whatever it wrote — the upscaled canvas and the AI-chosen placement.
   */
  useEffect(() => {
    if (!processing) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(`/api/templates/${templateId}`, {
          cache: "no-store",
        });
        const body = await response.json();
        if (cancelled) return;
        if (!body.processing) {
          setProcessing(false);
          if (body.entry?.ok) {
            setTemplate(body.entry.template as MockupTemplate);
            setSizeId(
              (body.entry.template as MockupTemplate).sizing?.referenceSize ??
                "A3",
            );
            setMessage(
              "AI set the poster size from this photo — check the placement below.",
            );
          }
          router.refresh();
        }
      } catch {
        // Transient — the next tick tries again.
      }
    };

    const id = setInterval(tick, 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [processing, templateId, router]);

  const perSize = template.sizing?.perSize ?? false;
  const referenceSize = template.sizing?.referenceSize ?? "A3";
  const isSplit = format === "split3";
  const isLandscapeFormat = !isSplit && orientation === "landscape";
  // "Vertical" turns the split box - the same value the single-poster toggle
  // uses for "edit the other field" - see the `orientation` doc above.
  const isSplitVerticalFormat = isSplit && orientation === "portrait";
  const backgroundUrl = `/api/templates/${templateId}/background?v=${busy ?? ""}`;
  /**
   * Sizes worth drawing a placement box for. Split-3 does not sell at A5 —
   * a panel is a full sheet, so a "split A5" would be three 148mm-wide
   * panels nobody would print as a set (see `SPLIT_SIZE_IDS`) — so offering
   * it here would let a template author draw a box that can never render.
   */
  const editableSizes = isSplit
    ? SIZES.filter((s) => (SPLIT_SIZE_IDS as readonly string[]).includes(s.id))
    : SIZES;

  /**
   * Switch format, off A5 if the split view cannot use it, and back to the
   * default orientation for whichever format is now showing - "portrait"
   * (Vertical) is `sizing` for a single poster but would silently mean
   * `splitVerticalSizing` for a split-3 set, so a stray toggle left over
   * from editing the other format must not carry across.
   */
  function changeFormat(next: "normal" | "split3") {
    setFormat(next);
    if (next === "split3") {
      if (sizeId === "A5") setSizeId(referenceSize);
      setOrientation("landscape");
    } else {
      setOrientation("portrait");
    }
  }

  /** The area currently being edited, derived if it has no override. */
  const currentRect = (): PlacementRect => {
    if (template.kind !== "flat") return { x: 0, y: 0, width: 1, height: 1 };
    return rectForSize(
      template,
      sizeId,
      isSplit,
      isLandscapeFormat,
      isSplitVerticalFormat,
    );
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
    return quadForSize(
      template,
      sizeId,
      isSplit,
      isLandscapeFormat,
      isSplitVerticalFormat,
    );
  };

  const panelGap = template.panelGap ?? defaultGap;

  /**
   * Whether the current selection expects the box turned AWAY from the
   * object's natural print shape.
   *
   * A single sheet's natural shape is tall (portrait) — so "turned" means
   * WIDE, and `isLandscapeFormat` (Horizontal selected) names it. A split-3
   * set's natural shape is wide (three sheets side by side) — so "turned"
   * means TALL, and `isSplitVerticalFormat` (Vertical selected) names it.
   * Named once and reused by both `lockRatio` and the mismatch warning
   * below, so the two cannot silently disagree about which shape is
   * expected.
   */
  const wantsTurnedBox = isSplit ? isSplitVerticalFormat : isLandscapeFormat;

  /**
   * The ratio resize handles are locked to — the real physical proportions
   * of the object being placed, in the orientation currently selected.
   *
   * Always taken from the SELECTION now, for both formats, never inferred
   * from the box's current shape. Inferring used to be how a flip-in-place
   * control worked, and it was the source of a real bug for the
   * single-poster case: flipping the box under "Single poster" could lock
   * it to a shape that belonged to a different field. Split-3 used to be
   * exempt from that risk only because it had one field to infer from; now
   * that it has two — `splitSizing` and `splitVerticalSizing` — it is
   * exposed to the exact same risk, so it gets the exact same fix.
   */

  const lockRatio =
    template.kind === "flat"
      ? (() => {
          const natural = trueAspectRatio(sizeId, isSplit, panelGap);
          return wantsTurnedBox ? 1 / natural : natural;
        })()
      : undefined;

  /**
   * Writing an area updates the BASE when editing the reference size, and an
   * OVERRIDE otherwise. Editing the reference therefore moves every derived
   * size with it, which is what makes "nudge the wall position" a one-drag
   * operation rather than four.
   */
  function setRect(area: PlacementRect) {
    setTemplate((current) => {
      if (current.kind !== "flat") return current;

      if (isSplit) {
        // Two independent fields, one for each turn of the same box — see
        // the `orientation` doc above. Writing into whichever one is
        // selected never touches the other.
        if (isSplitVerticalFormat) {
          const vertical = current.splitVerticalSizing ?? { base: area };
          if (sizeId === referenceSize) {
            return {
              ...current,
              splitVerticalSizing: { ...vertical, base: area },
            };
          }
          return {
            ...current,
            splitVerticalSizing: {
              ...vertical,
              overrides: { ...vertical.overrides, [sizeId]: area },
            },
          };
        }
        const split = current.splitSizing ?? { base: area };
        if (sizeId === referenceSize) {
          return { ...current, splitSizing: { ...split, base: area } };
        }
        return {
          ...current,
          splitSizing: {
            ...split,
            overrides: { ...split.overrides, [sizeId]: area },
          },
        };
      }

      if (isLandscapeFormat) {
        const landscape = current.landscapeSizing ?? { base: area };
        if (sizeId === referenceSize) {
          return { ...current, landscapeSizing: { ...landscape, base: area } };
        }
        return {
          ...current,
          landscapeSizing: {
            ...landscape,
            overrides: { ...landscape.overrides, [sizeId]: area },
          },
        };
      }

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

      if (isSplit) {
        if (isSplitVerticalFormat) {
          const vertical = current.splitVerticalSizing ?? { base: area };
          if (sizeId === referenceSize) {
            return {
              ...current,
              splitVerticalSizing: { ...vertical, base: area },
            };
          }
          return {
            ...current,
            splitVerticalSizing: {
              ...vertical,
              overrides: { ...vertical.overrides, [sizeId]: area },
            },
          };
        }
        const split = current.splitSizing ?? { base: area };
        if (sizeId === referenceSize) {
          return { ...current, splitSizing: { ...split, base: area } };
        }
        return {
          ...current,
          splitSizing: {
            ...split,
            overrides: { ...split.overrides, [sizeId]: area },
          },
        };
      }

      if (isLandscapeFormat) {
        const landscape = current.landscapeSizing ?? { base: area };
        if (sizeId === referenceSize) {
          return { ...current, landscapeSizing: { ...landscape, base: area } };
        }
        return {
          ...current,
          landscapeSizing: {
            ...landscape,
            overrides: { ...landscape.overrides, [sizeId]: area },
          },
        };
      }

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
      if (isSplit && isSplitVerticalFormat) {
        if (!current.splitVerticalSizing?.overrides) return current;
        // Branched on `current.kind`, not merged, even though the two arms
        // are identical: `splitVerticalSizing` is a different generic
        // instantiation per kind, and TS can only tell which one `current`
        // carries once `current.kind` has been checked in this exact scope.
        if (current.kind === "flat") {
          const overrides = { ...current.splitVerticalSizing.overrides };
          delete overrides[sizeId];
          return {
            ...current,
            splitVerticalSizing: { ...current.splitVerticalSizing, overrides },
          };
        }
        const overrides = { ...current.splitVerticalSizing.overrides };
        delete overrides[sizeId];
        return {
          ...current,
          splitVerticalSizing: { ...current.splitVerticalSizing, overrides },
        };
      }
      if (isSplit) {
        if (!current.splitSizing?.overrides) return current;
        if (current.kind === "flat") {
          const overrides = { ...current.splitSizing.overrides };
          delete overrides[sizeId];
          return { ...current, splitSizing: { ...current.splitSizing, overrides } };
        }
        const overrides = { ...current.splitSizing.overrides };
        delete overrides[sizeId];
        return { ...current, splitSizing: { ...current.splitSizing, overrides } };
      }
      if (isLandscapeFormat) {
        if (!current.landscapeSizing?.overrides) return current;
        if (current.kind === "flat") {
          const overrides = { ...current.landscapeSizing.overrides };
          delete overrides[sizeId];
          return {
            ...current,
            landscapeSizing: { ...current.landscapeSizing, overrides },
          };
        }
        const overrides = { ...current.landscapeSizing.overrides };
        delete overrides[sizeId];
        return {
          ...current,
          landscapeSizing: { ...current.landscapeSizing, overrides },
        };
      }
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
          // silently keeping stale shapes is worse than starting clean. The
          // same goes for the split-3 (both turns) and landscape boxes.
          sizing: undefined,
          splitSizing: undefined,
          splitVerticalSizing: undefined,
          landscapeSizing: undefined,
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
        splitSizing: undefined,
        splitVerticalSizing: undefined,
        landscapeSizing: undefined,
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

  /**
   * Whether a `suits` facet value is active. An absent or empty array means
   * "no restriction", so every value reads as ticked.
   */
  function suitActive(
    facet: "formats" | "orientations",
    value: string,
  ): boolean {
    const suits = (template.suits ?? {}) as Record<string, string[] | undefined>;
    const active = suits[facet];
    return !active || active.length === 0 || active.includes(value);
  }

  /**
   * Toggle one value of a `suits` facet. Stored minimally: the facet is
   * dropped when every value is active, and the whole `suits` object is
   * dropped when both facets are unrestricted. Turning the last value off is
   * treated as "all on" — a template that suits nothing would simply never be
   * offered, which is never what the toggle meant.
   */
  function toggleSuit(
    facet: "formats" | "orientations",
    value: string,
    all: readonly string[],
  ) {
    setTemplate((current) => {
      const suits: Record<string, string[] | undefined> = {
        ...(current.suits ?? {}),
      };
      const stored = suits[facet];
      const active = new Set(stored && stored.length > 0 ? stored : all);
      if (active.has(value)) active.delete(value);
      else active.add(value);

      suits[facet] =
        active.size === 0 || active.size === all.length
          ? undefined
          : all.filter((v) => active.has(v));

      const cleaned =
        suits.formats === undefined && suits.orientations === undefined
          ? undefined
          : (suits as MockupTemplate["suits"]);

      return { ...current, suits: cleaned } as MockupTemplate;
    });
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

  async function runAiSizing() {
    setBusy("ai-size");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/templates/${templateId}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referenceSize }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "AI sizing failed.");
        return;
      }
      const placement = result.placement as {
        base: PlacementRect;
        referenceSize: SizeId;
        source: "gemini" | "fallback";
        reason: string;
      };
      setTemplate((current) => {
        if (current.kind !== "flat") return current;
        return {
          ...current,
          rect: placement.base,
          sizing: {
            ...(current.sizing ?? {}),
            referenceSize: placement.referenceSize,
            base: placement.base,
          },
        } as MockupTemplate;
      });
      setSizeId(placement.referenceSize);
      setMessage(
        placement.source === "gemini"
          ? `AI placement applied${placement.reason ? ` — ${placement.reason}` : ""}. Save to keep it.`
          : "AI was unavailable — applied a centred default instead.",
      );
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
        setMessage("Background replaced — AI is re-analysing the new photo.");
        setProcessing(true);
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

  /**
   * Whether the stored box disagrees with the orientation selected — the
   * shape `wantsTurnedBox` says it should NOT be. Only possible on a
   * template authored before its toggle meant this — the split-3 case in
   * particular, which used to flip one shared box in place rather than
   * picking between two fields. A single drag snaps it back, since
   * `lockRatio` now fixes the shape going forward.
   */
  const boxIsTurned = (() => {
    if (template.kind !== "flat" || lockRatio === undefined) return false;
    const rect = currentRect();
    return rect.width >= rect.height !== lockRatio >= 1;
  })();

  const hasOverride = isSplit
    ? isSplitVerticalFormat
      ? Boolean(template.splitVerticalSizing?.overrides?.[sizeId])
      : Boolean(template.splitSizing?.overrides?.[sizeId])
    : isLandscapeFormat
      ? Boolean(template.landscapeSizing?.overrides?.[sizeId])
      : Boolean(template.sizing?.overrides?.[sizeId]);

  // Every other size, drawn faintly, so the relative scale is visible. Reuses
  // the same placement functions the server renders with, rather than
  // re-deriving the fallback logic here — so a ghost never disagrees with
  // what actually gets composited.
  const ghosts = editableSizes.filter((s) => s.id !== sizeId).map((s) => {
    if (template.kind === "flat") {
      return {
        label: s.label,
        rect: rectForSize(
          template,
          s.id,
          isSplit,
          isLandscapeFormat,
          isSplitVerticalFormat,
        ),
      };
    }
    return {
      label: s.label,
      corners: quadForSize(
        template,
        s.id,
        isSplit,
        isLandscapeFormat,
        isSplitVerticalFormat,
      ),
    };
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

      {processing ? (
        <Card className="mt-4 border-accent-500/30 bg-accent-500/[0.06] p-3">
          <p className="flex items-center gap-2 text-sm text-ink-700">
            <span
              aria-hidden
              className="breathe size-2 rounded-full bg-accent-500"
            />
            Sharpening this photo and working out where a real poster hangs on
            it. The placement will update here when it&rsquo;s done.
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
              options={editableSizes.map((s) => ({
                value: s.id,
                label:
                  s.id === referenceSize ? `${s.label} ★` : s.label,
              }))}
            />
          }
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              size="sm"
              value={format}
              onChange={changeFormat}
              options={[
                { value: "normal", label: "Single poster" },
                { value: "split3", label: "Split-3 set" },
              ]}
            />
            {isSplit && !isSplitVerticalFormat && !hasSplitPlacement(template) ? (
              <Badge tone="warn">
                not set — falling back to the single-poster box
              </Badge>
            ) : null}
            {isSplit && isSplitVerticalFormat && !hasSplitVerticalPlacement(template) ? (
              <Badge tone="warn">
                not set — falls back to the horizontal box turned on its side
              </Badge>
            ) : null}
            {/* Either box can be authored the wrong way round — a legacy
                template from before this had two independent fields, or a
                hand-edited JSON file. Said plainly rather than silently
                rewritten: the fix is one drag, and rewriting someone's
                authored placement without asking would be worse. */}
            {template.kind === "flat" && boxIsTurned ? (
              <Badge tone="warn">
                this box is{" "}
                {wantsTurnedBox ? "taller than it is wide" : "wider than it is tall"} —
                drag a corner to reshape it
              </Badge>
            ) : null}
            {isLandscapeFormat && !hasLandscapePlacement(template) ? (
              <Badge tone="warn">
                not set — a landscape poster falls back to the vertical box
                turned on its side
              </Badge>
            ) : null}
            {/*
              Same control, two different meanings underneath, both now a
              plain field selector — no in-place flipping either way. For a
              single poster this picks `sizing` vs `landscapeSizing`; for a
              split-3 set it picks `splitSizing` vs `splitVerticalSizing`.
              The physical product is unchanged either way; this only
              decides how it is drawn on a particular wall photo, and
              editing one box can never touch the other — see `orientation`.
            */}
            {template.kind === "flat" ? (
              <Segmented
                size="sm"
                value={orientation}
                onChange={setOrientation}
                options={[
                  { value: "portrait", label: "Vertical" },
                  { value: "landscape", label: "Horizontal" },
                ]}
              />
            ) : null}
          </div>

          <PlacementEditor
            backgroundUrl={backgroundUrl}
            canvas={template.canvas}
            ghosts={ghosts}
            mode={
              template.kind === "flat"
                ? { kind: "flat", rect: currentRect(), onChange: setRect, lockRatio }
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
                ? "Drag the box to move it; drag a corner to resize — locked to the real shape of what's selected."
                : "Drag each numbered corner onto the wall, in order: top-left, top-right, bottom-right, bottom-left."}
            </span>
            <Badge>
              {isSplit
                ? isSplitVerticalFormat
                  ? "split-3 set — turned vertical"
                  : "split-3 set — horizontal"
                : isLandscapeFormat
                  ? "horizontal poster"
                  : "vertical poster"}
            </Badge>
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
                  className="w-full accent-[var(--color-accent-500)]"
                />
              </Field>

              <Field
                label={`Split panel gap (${panelGap.toFixed(1)}%)`}
                hint={
                  template.panelGap === undefined
                    ? `Only affects split posters. Following the dashboard default (${defaultGap.toFixed(1)}%) — drag to set one for this template specifically.`
                    : "Only affects split posters. A percentage of panel width, so it stays the same on screen whatever the print size."
                }
              >
                <input
                  type="range"
                  min={0}
                  max={MAX_PANEL_GAP * 10}
                  value={Math.round(panelGap * 10)}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      panelGap: Number(e.target.value) / 10,
                    })
                  }
                  className="w-full accent-[var(--color-accent-500)]"
                />
              </Field>
            </div>
          </Section>

          <Section title="Suited for">
            <p className="text-xs text-ink-400">
              Which posters this mockup is offered for automatically. Untick a
              row to keep it out of that case — you can still pick it by hand on
              a poster or a batch. All ticked means no restriction.
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs font-medium text-ink-600">Format</p>
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {SUIT_FORMATS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-600"
                    >
                      <input
                        type="checkbox"
                        checked={suitActive("formats", option.value)}
                        onChange={() =>
                          toggleSuit(
                            "formats",
                            option.value,
                            SUIT_FORMATS.map((f) => f.value),
                          )
                        }
                        className="accent-[var(--color-accent-600)]"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-600">
                  Source orientation
                </p>
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {SUIT_ORIENTATIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-600"
                    >
                      <input
                        type="checkbox"
                        checked={suitActive("orientations", option.value)}
                        onChange={() =>
                          toggleSuit(
                            "orientations",
                            option.value,
                            SUIT_ORIENTATIONS.map((o) => o.value),
                          )
                        }
                        className="accent-[var(--color-accent-600)]"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
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

            {template.kind === "flat" ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={runAiSizing}
                  disabled={busy !== null || processing}
                >
                  {busy === "ai-size" ? "Analysing…" : "Auto-size with AI"}
                </Button>
                <p className="mt-1 text-xs text-ink-400">
                  Reads the photo for scale cues and sets the box to a real{" "}
                  {referenceSize} on that wall. Review it before saving.
                </p>
              </div>
            ) : null}
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
