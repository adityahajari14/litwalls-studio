"use client";

import { useRef, useState } from "react";

import type { PlacementRect, Pt } from "@/lib/print/types";

/**
 * Drag the area a poster occupies on a mockup background.
 *
 * Two modes matching the two template kinds: a rectangle with resize handles
 * for a straight-on wall, and four independently-draggable corners for an
 * angled one. Both work in CANVAS pixels, so what is dragged here is literally
 * what the compositor uses.
 */

type Mode =
  | {
      kind: "flat";
      rect: PlacementRect;
      onChange: (rect: PlacementRect) => void;
      /**
       * Width:height ratio the resize handles are locked to — the real
       * physical shape of whatever is being placed (a sheet, or an assembled
       * split-3 set), not a shape a template author gets to invent. Omitting
       * it falls back to free resize, kept only so a caller that has not
       * computed a ratio yet does not crash.
       */
      lockRatio?: number;
    }
  | {
      kind: "perspective";
      corners: [Pt, Pt, Pt, Pt];
      onChange: (corners: [Pt, Pt, Pt, Pt]) => void;
    };

/** Shortest edge a locked resize will allow, in canvas pixels. Small enough
 *  to never bind in practice, just enough to stop a drag collapsing the box
 *  to nothing. */
const MIN_LOCKED_EDGE = 30;

const HANDLES = ["nw", "ne", "se", "sw"] as const;
type Handle = (typeof HANDLES)[number];

export function PlacementEditor({
  backgroundUrl,
  canvas,
  mode,
  /** Drawn faintly behind, to show how other sizes sit relative to this one. */
  ghosts,
}: {
  backgroundUrl: string;
  canvas: { width: number; height: number };
  mode: Mode;
  ghosts?: { label: string; rect?: PlacementRect; corners?: Pt[] }[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<
    | { type: "move"; startX: number; startY: number; origin: PlacementRect }
    | { type: "resize"; handle: Handle; origin: PlacementRect }
    | { type: "corner"; index: number }
    | null
  >(null);

  /** Pointer position in canvas pixels. */
  function toCanvas(event: React.PointerEvent | PointerEvent) {
    const bounds = boxRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  function onPointerMove(event: React.PointerEvent) {
    if (!drag) return;
    const point = toCanvas(event);

    if (drag.type === "corner" && mode.kind === "perspective") {
      const next = [...mode.corners] as [Pt, Pt, Pt, Pt];
      next[drag.index] = {
        x: Math.round(clamp(point.x, 0, canvas.width)),
        y: Math.round(clamp(point.y, 0, canvas.height)),
      };
      mode.onChange(next);
      return;
    }

    // Everything below is rect editing; a corner drag was handled above.
    if (mode.kind !== "flat" || drag.type === "corner") return;

    if (drag.type === "move") {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      mode.onChange({
        ...drag.origin,
        x: Math.round(
          clamp(drag.origin.x + dx, 0, canvas.width - drag.origin.width),
        ),
        y: Math.round(
          clamp(drag.origin.y + dy, 0, canvas.height - drag.origin.height),
        ),
      });
      return;
    }

    // Resize from the dragged corner, keeping the opposite one pinned.
    const o = drag.origin;
    const right = o.x + o.width;
    const bottom = o.y + o.height;

    if (mode.lockRatio) {
      const { x, y, width, height } = resizeLocked(
        drag.handle,
        o,
        point,
        mode.lockRatio,
        canvas,
      );
      mode.onChange({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
      return;
    }

    let x = o.x;
    let y = o.y;
    let width = o.width;
    let height = o.height;

    if (drag.handle === "nw" || drag.handle === "sw") {
      x = clamp(point.x, 0, right - 20);
      width = right - x;
    } else {
      width = clamp(point.x, o.x + 20, canvas.width) - o.x;
    }
    if (drag.handle === "nw" || drag.handle === "ne") {
      y = clamp(point.y, 0, bottom - 20);
      height = bottom - y;
    } else {
      height = clamp(point.y, o.y + 20, canvas.height) - o.y;
    }

    mode.onChange({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  return (
    <div
      ref={boxRef}
      onPointerMove={drag ? onPointerMove : undefined}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
      className="relative mx-auto select-none overflow-hidden rounded-md border border-paper-300 bg-paper-100"
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        width: "100%",
        // `aspect-ratio` alone only fixes height from width — it does not
        // stop the box growing to fill the column and then getting its
        // height clipped by maxHeight, which distorts the ratio it was just
        // told to keep. Capping width too, in proportion to maxHeight, is
        // what actually letterboxes the box at the canvas's true shape.
        maxWidth: `calc(min(62vh, 560px) * ${canvas.width} / ${canvas.height})`,
        maxHeight: "min(62vh, 560px)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backgroundUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-fill"
      />

      {/* Other sizes, faint — the whole point of per-size placement is seeing
          how they compare on the same wall. */}
      {ghosts?.map((ghost) =>
        ghost.rect ? (
          <span
            key={ghost.label}
            className="pointer-events-none absolute border border-dashed border-white/60"
            style={{
              left: pct(ghost.rect.x, canvas.width),
              top: pct(ghost.rect.y, canvas.height),
              width: pct(ghost.rect.width, canvas.width),
              height: pct(ghost.rect.height, canvas.height),
            }}
          >
            <span className="absolute -top-4 left-0 rounded bg-paper-50/80 px-1 text-[10px] text-white">
              {ghost.label}
            </span>
          </span>
        ) : ghost.corners ? (
          <svg
            key={ghost.label}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <polygon
              points={ghost.corners.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="rgba(255,255,255,0.6)"
              strokeDasharray="8 6"
              strokeWidth={2}
            />
          </svg>
        ) : null,
      )}

      {mode.kind === "flat" ? (
        <div
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = toCanvas(event);
            setDrag({
              type: "move",
              startX: point.x,
              startY: point.y,
              origin: mode.rect,
            });
          }}
          className="absolute cursor-grab border-2 border-accent-500 bg-accent-500/15 active:cursor-grabbing"
          style={{
            left: pct(mode.rect.x, canvas.width),
            top: pct(mode.rect.y, canvas.height),
            width: pct(mode.rect.width, canvas.width),
            height: pct(mode.rect.height, canvas.height),
          }}
        >
          {HANDLES.map((handle) => (
            <span
              key={handle}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({ type: "resize", handle, origin: mode.rect });
              }}
              className={`absolute size-3 rounded-sm border border-white bg-accent-600 ${
                handle === "nw"
                  ? "-left-1.5 -top-1.5 cursor-nwse-resize"
                  : handle === "ne"
                    ? "-right-1.5 -top-1.5 cursor-nesw-resize"
                    : handle === "se"
                      ? "-bottom-1.5 -right-1.5 cursor-nwse-resize"
                      : "-bottom-1.5 -left-1.5 cursor-nesw-resize"
              }`}
            />
          ))}
        </div>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <polygon
              points={mode.corners.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(59,110,245,0.15)"
              stroke="rgb(59,110,245)"
              strokeWidth={3}
            />
          </svg>

          {mode.corners.map((corner, index) => (
            <span
              key={index}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({ type: "corner", index });
              }}
              title={["top-left", "top-right", "bottom-right", "bottom-left"][index]}
              className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 cursor-move place-items-center rounded-full border-2 border-white bg-accent-600 text-[10px] font-bold text-white shadow"
              style={{
                left: pct(corner.x, canvas.width),
                top: pct(corner.y, canvas.height),
              }}
            >
              {index + 1}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resize a rect from one corner, opposite corner pinned, constrained to
 * `ratio` (width:height) the whole time — the box can grow or shrink, but
 * never distort into a shape the real object being placed does not have.
 *
 * The pointer only tells us "how far", not "along which axis" — dragging a
 * corner diagonally moves both. Two candidate widths are derived, one from
 * how far the pointer moved horizontally and one (via the ratio) from how
 * far it moved vertically, and whichever is bigger wins, so the box keeps up
 * with whichever direction is being dragged harder rather than always
 * tracking just one axis.
 *
 * The canvas bound is computed as a width CEILING up front, from the anchor
 * corner's fixed position, rather than clamping the resulting box afterward
 * — clamping x/y post hoc can only move the DRAGGED corner back in, which
 * near an edge would silently drag the ANCHOR corner along with it and break
 * the "opposite corner stays put" contract the handles promise.
 */
function resizeLocked(
  handle: Handle,
  origin: PlacementRect,
  point: Pt,
  ratio: number,
  canvas: { width: number; height: number },
): PlacementRect {
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;

  // The corner that stays put while the dragged one moves.
  const anchor: Pt =
    handle === "nw"
      ? { x: right, y: bottom }
      : handle === "ne"
        ? { x: origin.x, y: bottom }
        : handle === "se"
          ? { x: origin.x, y: origin.y }
          : { x: right, y: origin.y };

  const maxWidth = handle === "nw" || handle === "sw" ? right : canvas.width - origin.x;
  const maxHeight = handle === "nw" || handle === "ne" ? bottom : canvas.height - origin.y;
  // A ratio-locked box is bound by whichever axis runs out of canvas room
  // first, expressed as a single width ceiling since height follows from it.
  const ceiling = Math.max(0, Math.min(maxWidth, maxHeight * ratio));

  const rawWidth = clamp(Math.abs(point.x - anchor.x), 0, ceiling);
  const rawHeight = clamp(Math.abs(point.y - anchor.y), 0, ceiling / ratio);

  const fromWidth = rawWidth;
  const fromHeight = rawHeight * ratio;
  let width = fromWidth >= fromHeight ? fromWidth : fromHeight;

  const minWidth = Math.min(ratio >= 1 ? MIN_LOCKED_EDGE * ratio : MIN_LOCKED_EDGE, ceiling);
  width = clamp(width, minWidth, ceiling);
  const height = width / ratio;

  const x = handle === "nw" || handle === "sw" ? right - width : origin.x;
  const y = handle === "nw" || handle === "ne" ? bottom - height : origin.y;

  return { x, y, width, height };
}
