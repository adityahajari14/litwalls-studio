"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui";

type JobHit = {
  batchId: string;
  batchName: string;
  jobId: string;
  subject: string | null;
  sourceName: string;
  stage: string;
  preview: string | null;
};

type PublishedHit = {
  productId: string;
  title: string;
  categoryLabel: string;
};

/**
 * Find a poster anywhere.
 *
 * Lives in the nav because "which batch was that in?" is a question that comes
 * up from any screen. Cmd/Ctrl-K opens it, which is the shortcut people
 * already try.
 */
export function Search() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [published, setPublished] = useState<PublishedHit[]>([]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setJobs([]);
      setPublished([]);
      return;
    }

    // Debounced: every keystroke otherwise walks every batch directory on disk.
    const timer = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(needle)}`)
        .then((response) => response.json())
        .then((body) => {
          setJobs(body.jobs ?? []);
          setPublished(body.published ?? []);
        })
        .catch(() => undefined);
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  const hasResults = jobs.length > 0 || published.length > 0;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // A click inside the results list would otherwise be cancelled by the
        // blur closing the panel before the link fires.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search posters…"
        aria-label="Search posters"
        className="h-8 w-44 rounded-lg border border-paper-300 bg-paper-100 px-2.5 text-sm text-ink-900 placeholder:text-ink-400 transition-all focus:w-64 focus:border-accent-500 focus:outline-none lg:w-56 lg:focus:w-72"
      />

      {open && query.trim().length >= 2 ? (
        <div className="absolute right-0 top-10 z-40 max-h-[60vh] w-80 overflow-auto rounded-xl border border-paper-300 bg-paper-100 p-1.5 shadow-[--shadow-pop]">
          {!hasResults ? (
            <p className="px-2.5 py-3 text-sm text-ink-400">No matches.</p>
          ) : null}

          {jobs.map((hit) => (
            <Link
              key={hit.jobId}
              href={`/batches/${hit.batchId}/jobs/${hit.jobId}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-paper-200"
            >
              <span className="size-8 shrink-0 overflow-hidden rounded bg-paper-300">
                {hit.preview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/assets/${hit.batchId}/${hit.jobId}/${hit.preview}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-900">
                  {hit.subject || hit.sourceName}
                </span>
                <span className="block truncate text-[11px] text-ink-400">
                  {hit.batchName}
                </span>
              </span>
              <Badge>{hit.stage}</Badge>
            </Link>
          ))}

          {published.length > 0 ? (
            <p className="mt-1 px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
              Published
            </p>
          ) : null}

          {published.map((hit) => (
            <Link
              key={hit.productId}
              href="/published"
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-paper-200"
            >
              <span className="min-w-0 truncate text-sm text-ink-700">
                {hit.title}
              </span>
              <Badge tone="ok">live</Badge>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
