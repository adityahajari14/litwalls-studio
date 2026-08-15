"use client";

import { useRef, useState } from "react";

import { validateTemplate } from "@/lib/templates/schema";
import type { Pt } from "@/lib/print/types";

const LABELS = ["top-left", "top-right", "bottom-right", "bottom-left"];

/**
 * Click the four corners of a wall area to generate template JSON.
 *
 * This is what makes the template library usable. Hand-authoring four pixel
 * coordinates by squinting at a cursor readout in an image editor is how a
 * library ends up with exactly one template in it.
 *
 * The picker only DISPLAYS the JSON — the user pastes it into template.json
 * themselves. Templates are git-tracked content, and a dashboard that silently
 * writes into the repo would be a surprise rather than a convenience.
 */
export function CornerPicker({ templateId }: { templateId: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [mode, setMode] = useState<"perspective" | "flat">("perspective");
  const [copied, setCopied] = useState(false);

  function onClick(event: React.MouseEvent<HTMLImageElement>) {
    if (points.length >= 4 || !natural) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // Scale from displayed size back to the image's real pixels — the template
    // is authored against the full-resolution background, not the preview.
    const x = Math.round(
      ((event.clientX - rect.left) / rect.width) * natural.width,
    );
    const y = Math.round(
      ((event.clientY - rect.top) / rect.height) * natural.height,
    );
    setPoints([...points, { x, y }]);
    setCopied(false);
  }

  const json = buildJson(templateId, mode, points, natural);
  const check = json ? validateTemplate(JSON.parse(json)) : null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 text-xs">
          {(["perspective", "flat"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setPoints([]);
              }}
              className={`rounded border px-2 py-1 ${
                mode === value
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-paper-300"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          {points.length < 4
            ? `Click the ${LABELS[points.length]} corner of the wall area`
            : "All four corners set"}
        </p>
        {points.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setPoints([]);
              setCopied(false);
            }}
            className="text-xs text-ink-500 underline underline-offset-4"
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="relative mt-3 inline-block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={`/api/templates/${templateId}/background`}
          alt=""
          onClick={onClick}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="max-h-[420px] w-auto cursor-crosshair rounded border border-paper-300"
        />
        {natural
          ? points.map((point, index) => (
              <span
                key={index}
                style={{
                  left: `${(point.x / natural.width) * 100}%`,
                  top: `${(point.y / natural.height) * 100}%`,
                }}
                className="pointer-events-none absolute -ml-2.5 -mt-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white"
              >
                {index + 1}
              </span>
            ))
          : null}
      </div>

      {json ? (
        <div className="mt-3">
          {check && !check.ok ? (
            <p className="mb-2 text-xs text-amber-700">
              {check.errors.join(" ")}
            </p>
          ) : null}
          <pre className="max-h-56 overflow-auto rounded bg-paper-100 p-3 text-[11px] leading-relaxed">
            {json}
          </pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(json);
              setCopied(true);
            }}
            className="mt-2 rounded bg-ink-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            {copied ? "Copied" : `Copy — paste into mockup-templates/${templateId}/template.json`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function buildJson(
  id: string,
  mode: "perspective" | "flat",
  points: Pt[],
  natural: { width: number; height: number } | null,
): string | null {
  if (points.length < 4 || !natural) return null;

  const base = {
    id,
    name: id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
    background: "background.jpg",
    canvas: { width: natural.width, height: natural.height },
    shadow: 0.25,
  };

  if (mode === "flat") {
    // A flat template is axis-aligned, so the four clicks become a bounding
    // box. Clicking roughly is fine — the rect is squared up for you.
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return JSON.stringify(
      {
        ...base,
        kind: "flat",
        rect: {
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    { ...base, kind: "perspective", corners: points },
    null,
    2,
  );
}
