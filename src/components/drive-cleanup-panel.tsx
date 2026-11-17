"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

type Folder = { id: string; name: string; collection: string; files: number };
type Preview = {
  remove: Folder[];
  keep: (Folder & { reason: string })[];
  blocked: string | null;
};

/**
 * Clearing out the old shared "… #01" folders on Drive, once every poster has
 * been re-filed into a folder of its own.
 *
 * Nothing is fetched until asked: listing everything Studio has on Drive is a
 * few seconds of API calls, not something to run on every dashboard load. And
 * nothing is removed without a second click on the exact list shown — the
 * folders go to the Drive trash, where they can be restored for 30 days.
 */
export function DriveCleanupPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"checking" | "trashing" | null>(null);
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setBusy("checking");
    setMessage(null);
    setArmed(false);
    try {
      const response = await fetch("/api/drive/cleanup", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setPreview(null);
        setMessage(body.error ?? "Could not read Drive.");
      } else {
        setPreview(body);
      }
    } catch {
      setMessage("Could not reach Studio.");
    } finally {
      setBusy(null);
    }
  }

  async function trash() {
    if (!preview) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy("trashing");
    setArmed(false);
    try {
      const response = await fetch("/api/drive/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: preview.remove.map((f) => f.id) }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "Cleanup failed.");
      } else {
        const failed = body.failed as { name: string; error: string }[];
        setMessage(
          `Moved ${body.trashed.length} folder${body.trashed.length === 1 ? "" : "s"} to the Drive trash` +
            (failed.length ? ` · ${failed.length} failed: ${failed[0].error}` : ""),
        );
        setPreview(null);
      }
    } catch {
      setMessage("Could not reach Studio.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-2 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-600">
          Old shared Drive folders
          {preview ? (
            <span className="tnum text-ink-400">
              {" "}
              · {preview.remove.length} can go
              {preview.keep.length ? ` · ${preview.keep.length} kept` : ""}
            </span>
          ) : (
            <span className="text-ink-400">
              {" "}
              · left behind when posters moved into folders of their own
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={check} disabled={busy !== null}>
            {busy === "checking" ? "Checking…" : preview ? "Check again" : "Check"}
          </Button>
          {preview && preview.remove.length > 0 && !preview.blocked ? (
            <Button size="sm" variant="danger" onClick={trash} disabled={busy !== null}>
              {busy === "trashing"
                ? "Moving…"
                : armed
                  ? `Confirm: move ${preview.remove.length} to Drive trash`
                  : `Move ${preview.remove.length} to Drive trash`}
            </Button>
          ) : null}
        </div>
      </div>

      {preview?.blocked ? <p className="text-warn-700">{preview.blocked}</p> : null}
      {preview && preview.remove.length === 0 && preview.keep.length === 0 ? (
        <p className="text-ink-500">Nothing to clean up — every folder belongs to one poster.</p>
      ) : null}

      {preview && preview.remove.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-ink-500">
            Folders that would be moved to the trash
          </summary>
          <ul className="mt-1 max-h-60 space-y-0.5 overflow-auto pl-4 text-ink-600">
            {preview.remove.map((f) => (
              <li key={f.id} className="tnum">
                {f.collection} / {f.name} <span className="text-ink-400">({f.files} files)</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {preview && preview.keep.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-ink-500">Folders kept, and why</summary>
          <ul className="mt-1 max-h-60 space-y-0.5 overflow-auto pl-4 text-ink-600">
            {preview.keep.map((f) => (
              <li key={f.id}>
                {f.collection} / {f.name} <span className="text-ink-400">— {f.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {message ? <p className="animate-fade-rise text-ink-500">{message}</p> : null}
    </Card>
  );
}
