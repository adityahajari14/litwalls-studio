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
  | { kind: "flat"; rect: PlacementRect; onChange: (rect: PlacementRect) => void }
  | {
      kind: "perspective";
      corners: [Pt, Pt, Pt, Pt];
      onChange: (corners: [Pt, Pt, Pt, Pt]) => void;
    };

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
            <span className="absolute -top-4 left-0 rounded bg-black/50 px-1 text-[10px] text-white">
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
