"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button, Card, Field, Input } from "@/components/ui";

/**
 * Add a mockup template by uploading a room photo.
 *
 * Straight to the editor afterwards, because an uploaded background with no
 * placement is useless — the poster would land in a default box in the middle
 * of the room. The two steps are really one job.
 */
export function NewTemplate() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a room photo.");
      return;
    }

    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("name", name);
    form.append("background", file);

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Could not create the template.");
        return;
      }
      router.push(`/templates/${result.template.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add mockup
      </Button>
    );
  }

  return (
    <Card className="w-full max-w-sm p-4">
      <form onSubmit={create} className="space-y-3">
        <Field label="Name" hint="Shown when picking mockups for a poster.">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Living room — straight on"
            required
            autoFocus
          />
        </Field>

        <Field label="Room photo" hint="Resized to 2400px; JPG, PNG or WebP.">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            required
            className="block w-full text-xs text-ink-500 file:mr-2 file:rounded file:border file:border-paper-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-ink-700"
          />
        </Field>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Uploading…" : "Create & place"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>

        {error ? <p className="text-xs text-danger-700">{error}</p> : null}
      </form>
    </Card>
  );
}
