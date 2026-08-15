"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  ACCEPTED_EXTENSIONS,
  checkFile,
  formatBytes,
  MAX_FILE_BYTES,
} from "@/lib/print/upload";

type Progress = { name: string; index: number; total: number };

export function DropZone({
  batchId,
  initialCount,
}: {
  batchId: string;
  initialCount: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [added, setAdded] = useState(0);

  async function upload(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    // Client-side check first so an obviously wrong file fails instantly
    // rather than after uploading 200MB. The server re-checks regardless.
    const rejected: string[] = [];
    const accepted = files.filter((file) => {
      const problem = checkFile(file);
      if (problem) {
        rejected.push(problem.message);
        return false;
      }
      return true;
    });

    setProblems(rejected);
    if (accepted.length === 0) return;

    let count = 0;

    // ONE AT A TIME, deliberately. Parallel uploads of 100MB files just fight
    // each other for the same bandwidth while making per-file progress
    // meaningless, and any failure becomes ambiguous about what landed.
    for (const [index, file] of accepted.entries()) {
      setProgress({ name: file.name, index: index + 1, total: accepted.length });

      const body = new FormData();
      body.append("files", file);

      try {
        const response = await fetch(`/api/batches/${batchId}/ingest`, {
          method: "POST",
          body,
        });
        const result = await response.json();

        if (!response.ok && response.status !== 207) {
          rejected.push(`${file.name}: ${result.error ?? response.statusText}`);
        } else {
          count += result.created?.length ?? 0;
          if (result.rejected?.length) rejected.push(...result.rejected);
        }
      } catch (cause) {
        rejected.push(
          `${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      setProblems([...rejected]);
    }

    setProgress(null);
    setAdded(count);
    // Re-fetch the server component so the list below reflects what landed.
    router.refresh();
  }

  return (
    <div>
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
        className={`cursor-pointer rounded-[--radius-card] border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? "border-accent-500 bg-accent-50"
            : "border-paper-300 bg-white/60 hover:border-paper-400 hover:bg-white"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = "";
          }}
        />

        {progress ? (
          <div className="text-sm">
            <p className="font-medium">
              Uploading {progress.index} of {progress.total}
            </p>
            <p className="mt-1 truncate text-ink-500">{progress.name}</p>
          </div>
        ) : (
          <div className="text-sm">
            <p className="font-medium">Drop poster artwork here</p>
            <p className="mt-1 text-ink-500">
              or click to choose files — JPG, PNG, WebP, TIFF, AVIF up to{" "}
              {formatBytes(MAX_FILE_BYTES)} each
            </p>
          </div>
        )}
      </div>

      {added > 0 && !progress ? (
        <p className="mt-3 text-sm text-ok-700">
          Added {added} poster{added === 1 ? "" : "s"}
          {initialCount > 0 ? ` — ${initialCount + added} in this batch` : ""}.
        </p>
      ) : null}

      {problems.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-warn-700">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
