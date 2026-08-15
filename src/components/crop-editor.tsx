"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cropRectFor } from "@/lib/image/crop-rect";
import { cropAspectFor } from "@/lib/print/sizes";
import { seamPositions } from "@/lib/print/split";
import type {
  FocalPoint,
  NormRect,
  PosterKind,
  SizeId,
} from "@/lib/print/types";

/**
 * Drag a crop box over the artwork.
 *
 * Uses the SAME pure `cropRectFor` the render pipeline uses, so what is shown
 * here is exactly what will be cut — not an approximation that drifts as one
 * side or the other is edited.
 *
 * The box is constrained to the target aspect ratio at all times, because a
 * free-form box would let a user choose a crop the pipeline cannot honour.
 */
export function CropEditor({
  imageUrl,
  source,
  sizeId,
  kind,
  focal,
  value,
  onChange,
}: {
  imageUrl: string;
  source: { width: number; height: number };
  sizeId: SizeId;
  kind: PosterKind;
  focal: FocalPoint | null;
  /** The current override, or null to show the computed crop. */
  value: NormRect | null;
  onChange: (rect: NormRect) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; rect: NormRect } | null>(
    null,
  );

  const targetAspect = cropAspectFor(sizeId, kind);
  const computed = cropRectFor({
    source,
    targetAspect,
    subject: focal?.subject,
    anchor: focal?.anchor,
  });
  const rect = value ?? computed;

  const onPointerDown = (event: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      rect,
    };
    setDragging(true);
  };

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = dragState.current;
      const container = containerRef.current;
      if (!state || !container) return;

      const bounds = container.getBoundingClientRect();
      const dx = (event.clientX - state.startX) / bounds.width;
      const dy = (event.clientY - state.startY) / bounds.height;

      // Only the position moves — the size is fixed by the aspect ratio, so
      // dragging can never produce a crop the pipeline would have to distort.
      onChange({
        ...state.rect,
        x: clamp(state.rect.x + dx, 0, 1 - state.rect.width),
        y: clamp(state.rect.y + dy, 0, 1 - state.rect.height),
      });
    },
    [onChange],
  );

  const endDrag = () => {
    dragState.current = null;
    setDragging(false);
  };

  const seams = kind === "split3" ? seamPositions(rect) : [];

  return (
    <div
      ref={containerRef}
      className="relative mx-auto select-none overflow-hidden rounded border border-paper-300"
      style={{
        aspectRatio: `${source.width} / ${source.height}`,
        // Capped so a tall poster still fits on screen beside the form. Without
        // this a 3600x5000 source rendered taller than the viewport, and you
        // could not see the crop box and the controls at the same time — which
        // is the entire point of the screen.
        maxHeight: "min(62vh, 560px)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-40"
      />

      {/* The crop window: the artwork at full opacity, everything else dimmed. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={dragging ? onPointerMove : undefined}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`absolute overflow-hidden ring-2 ring-white ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Crop preview"
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{
            width: `${100 / rect.width}%`,
            height: `${100 / rect.height}%`,
            left: `${(-rect.x / rect.width) * 100}%`,
            top: `${(-rect.y / rect.height) * 100}%`,
          }}
        />

        {/* Panel seams, so a seam landing on a face is visible before publish. */}
        {seams.map((seam, index) => (
          <span
            key={index}
            className="absolute top-0 h-full w-px bg-paper-200/70"
            style={{ left: `${((seam - rect.x) / rect.width) * 100}%` }}
          />
        ))}
      </div>

      {/* Gemini's subject box, so it is clear WHY the crop sits where it does. */}
      {focal && focal.source !== "fallback" ? (
        <span
          className="pointer-events-none absolute border border-dashed border-warn-500"
          style={{
            left: `${focal.subject.x * 100}%`,
            top: `${focal.subject.y * 100}%`,
            width: `${focal.subject.width * 100}%`,
            height: `${focal.subject.height * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
