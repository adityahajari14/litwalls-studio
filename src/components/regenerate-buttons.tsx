"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";

type Field = "title" | "description";

const COPY: Record<Field, { button: string; busy: string; confirm: string }> = {
  title: {
    button: "Regenerate titles",
    busy: "Regenerating titles…",
    confirm:
      "Regenerate the title of every poster in this batch?\n\n" +
      "Gemini picks a new subject (and subtitle) for each one, replacing what " +
      "is there now — including any you edited by hand. Already-published " +
      "posters keep their title. Costs one Gemini call per poster.",
  },
  description: {
    button: "Regenerate descriptions",
    busy: "Regenerating descriptions…",
    confirm:
      "Regenerate the description of every poster in this batch?\n\n" +
      "Gemini writes a new paragraph for each one, replacing what is there " +
      "now — including any you edited by hand. Published products only change " +
      "once you republish. Costs one Gemini call per poster.",
  },
};

/**
 * Rewrite every poster's title, or every poster's description, with Gemini.
 *
 * Two buttons rather than one "regenerate metadata": the title feeds the
 * product's number and URL, the description is just prose, and being able to
 * redo one without risking the other is the whole point.
 */
export function RegenerateButtons({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<Field | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function run(field: Field) {
    if (!window.confirm(COPY[field].confirm)) return;

    setPending(field);
    setMessage(null);
    setErrors([]);
    try {
      const response = await fetch(`/api/batches/${batchId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "Could not regenerate.");
        return;
      }

      const parts = [`${body.updated} updated`];
      if (body.skipped) parts.push(`${body.skipped} skipped`);
      if (body.failed) parts.push(`${body.failed} failed`);
      setMessage(parts.join(", "));
      setErrors(body.failures ?? []);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        {(["title", "description"] as const).map((field) => (
          <Button
            key={field}
            onClick={() => run(field)}
            disabled={pending !== null}
          >
            {pending === field ? COPY[field].busy : COPY[field].button}
          </Button>
        ))}
        {message ? (
          <span className="animate-fade-rise text-xs text-ink-600">{message}</span>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <ul className="animate-fade-rise mt-2 space-y-0.5 text-xs text-danger-700">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
