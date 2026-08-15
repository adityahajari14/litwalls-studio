"use client";

import { Badge, Button } from "@/components/ui";
import type { ProductImageRef, RenderedMockup } from "@/lib/print/types";

/**
 * Choose and order the images a product publishes with.
 *
 * Position 1 is the product thumbnail everywhere on Shopify — collection
 * cards, search results, checkout — so which image leads is a real merchandising
 * decision rather than a detail. Mockups default to the front because a poster
 * on a wall sells better than a flat scan of one.
 *
 * Reordering is buttons rather than drag-and-drop: a list of four to eight
 * items is faster to nudge than to drag, and it works with a keyboard.
 */
export type LibraryOption = { id: string; name: string; role: string };

export function GalleryEditor({
  mockups,
  library,
  value,
  onChange,
  assetUrl,
}: {
  mockups: RenderedMockup[];
  library: LibraryOption[];
  value: ProductImageRef[];
  onChange: (next: ProductImageRef[]) => void;
  assetUrl: (relPath: string) => string;
}) {
  const key = (ref: ProductImageRef) =>
    ref.kind === "mockup"
      ? `mockup:${ref.templateId}`
      : ref.kind === "library"
        ? `library:${ref.libraryId}`
        : `oneoff:${ref.relPath}`;

  const included = new Set(value.map(key));

  const available: ProductImageRef[] = [
    ...mockups.map((m) => ({ kind: "mockup" as const, templateId: m.templateId })),
    ...library.map((l) => ({ kind: "library" as const, libraryId: l.id })),
  ];

  const previewFor = (ref: ProductImageRef): string | null => {
    if (ref.kind === "mockup") {
      const mockup = mockups.find((m) => m.templateId === ref.templateId);
      return mockup ? assetUrl(mockup.relPath) : null;
    }
    if (ref.kind === "library") {
      return `/api/library/${encodeURIComponent(ref.libraryId)}`;
    }
    return assetUrl(ref.relPath);
  };

  const labelFor = (ref: ProductImageRef): string => {
    if (ref.kind === "mockup") return ref.templateId;
    if (ref.kind === "library") {
      return library.find((l) => l.id === ref.libraryId)?.name ?? ref.libraryId;
    }
    return ref.relPath.split("/").pop() ?? "image";
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const notIncluded = available.filter((ref) => !included.has(key(ref)));

  return (
    <div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-paper-300 px-3 py-4 text-center text-xs text-ink-400">
          No images chosen. Add some below — without any, the product publishes
          with only its per-size variant images.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {value.map((ref, index) => {
            const preview = previewFor(ref);
            return (
              <li
                key={key(ref)}
                className="flex items-center gap-2 rounded-md border border-paper-200 bg-white p-1.5"
              >
                <span className="tnum w-4 shrink-0 text-center text-xs text-ink-400">
                  {index + 1}
                </span>

                <div className="checkerboard size-10 shrink-0 overflow-hidden rounded border border-paper-200">
                  {preview ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={preview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink-700">
                    {labelFor(ref)}
                  </span>
                  {index === 0 ? (
                    <Badge tone="accent" className="mt-0.5">
                      thumbnail
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-ink-400">{ref.kind}</span>
                  )}
                </span>

                <span className="flex shrink-0 items-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    title="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, index + 1)}
                    disabled={index === value.length - 1}
                    aria-label="Move down"
                    title="Move down"
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onChange(value.filter((_, i) => i !== index))
                    }
                    aria-label="Remove"
                    title="Remove"
                  >
                    ×
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {notIncluded.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {notIncluded.map((ref) => (
            <Button
              key={key(ref)}
              size="sm"
              onClick={() => onChange([...value, ref])}
            >
              + {labelFor(ref)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
