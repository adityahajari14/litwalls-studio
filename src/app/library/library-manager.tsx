"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Card, Empty } from "@/components/ui";

type LibraryImage = {
  id: string;
  name: string;
  role: string;
  bytes: number;
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "size-guide", label: "Size guide" },
  { value: "quality", label: "Quality" },
  { value: "shipping", label: "Shipping" },
  { value: "other", label: "Other" },
];

const ACCEPT = ".jpg,.jpeg,.png,.webp,.avif";

export function LibraryManager({
  initialImages,
  initialProcessing,
}: {
  initialImages: LibraryImage[];
  initialProcessing: string[];
}) {
  const [images, setImages] = useState<LibraryImage[]>(initialImages);
  const [processing, setProcessing] = useState<string[]>(initialProcessing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const body = await fetch("/api/library", { cache: "no-store" }).then((r) =>
        r.json(),
      );
      setImages(body.images ?? []);
      setProcessing(body.processing ?? []);
    } catch {
      // Leave the current view; the next action will try again.
    }
  }, []);

  // Poll while anything is still being sharpened.
  useEffect(() => {
    if (processing.length === 0) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [processing.length, refresh]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of list) {
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch("/api/library", {
          method: "POST",
          body: form,
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error ?? `Could not add ${file.name}.`);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    await refresh();
    setBusy(false);
  }

  async function patch(
    id: string,
    body: { name?: string; role?: string },
  ) {
    setImages((current) =>
      current.map((image) =>
        image.id === id ? { ...image, ...body } : image,
      ),
    );
    await fetch(`/api/library/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  }

  async function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setImages(next);
    await fetch("/api/library/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((image) => image.id) }),
    }).catch(() => undefined);
  }

  async function remove(id: string) {
    if (!confirm("Remove this shared image? Published products keep their copy.")) {
      return;
    }
    setImages((current) => current.filter((image) => image.id !== id));
    await fetch(`/api/library/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    await refresh();
  }

  return (
    <div className="mt-6">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-[--radius-card] border border-dashed p-8 text-center transition-all duration-200 ${
          dragging
            ? "border-accent-500 bg-accent-500/[0.07]"
            : "border-paper-400/60 bg-paper-100/40 hover:border-accent-500/50 hover:bg-paper-100/70"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = "";
          }}
        />
        <p className="text-sm font-medium">
          {busy ? "Uploading…" : "Drop a shared image here"}
        </p>
        <p className="mt-1 text-sm text-ink-500">
          or click to choose — JPG, PNG, WebP or AVIF. Newly added images are
          sharpened automatically.
        </p>
      </div>

      {error ? (
        <p className="animate-fade-rise mt-3 text-sm text-warn-700">{error}</p>
      ) : null}

      <div className="mt-8">
        {images.length === 0 ? (
          <Empty title="No shared images yet">
            Products will publish with their mockups only. Add a size guide to
            give customers something to compare against.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {images.map((image, index) => (
              <li key={image.id}>
                <Card className="flex items-center gap-3 p-2.5">
                  <div className="checkerboard size-14 shrink-0 overflow-hidden rounded border border-paper-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/library/${encodeURIComponent(image.id)}`}
                      alt={image.name}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <input
                      defaultValue={image.name}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== image.name) {
                          void patch(image.id, { name: value });
                        }
                      }}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-ink-900 hover:border-paper-300 focus:border-accent-500 focus:outline-none"
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
                      <select
                        value={image.role}
                        onChange={(e) =>
                          void patch(image.id, { role: e.target.value })
                        }
                        className="rounded border border-paper-300 bg-paper-200 px-1.5 py-0.5 text-xs text-ink-700"
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="tnum text-xs text-ink-400">
                        {Math.max(1, Math.round(image.bytes / 1024))} KB
                      </span>
                      {processing.includes(image.id) ? (
                        <Badge tone="accent">sharpening…</Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center">
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
                      disabled={index === images.length - 1}
                      aria-label="Move down"
                      title="Move down"
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(image.id)}
                      aria-label="Remove"
                      title="Remove"
                    >
                      ×
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
