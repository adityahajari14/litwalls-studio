import { COVERAGE_WARN, type PosterJob } from "@/lib/print/types";

/** Small coloured pill for a warning or state. */
function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "bad" | "good";
  title?: string;
}) {
  const tones = {
    neutral: "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400",
    warn: "border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-400",
    bad: "border-red-400 text-red-700 dark:border-red-800 dark:text-red-400",
    good: "border-emerald-400 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  };
  return (
    <span
      title={title}
      className={`rounded-full border px-1.5 py-0.5 text-[11px] leading-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * One poster in the batch list, with everything that would make a human want
 * to look before publishing.
 *
 * The badges are the honest output of the pipeline: an upscale that did not
 * add detail, a size below the print floor, a source that is the wrong shape
 * for the format. None of these stop a publish — they are judgement calls, and
 * the judgement is the user's.
 */
export function JobRow({ job }: { job: PosterJob }) {
  const lowResSizes = [...new Set(job.assets.filter((a) => a.lowRes).map((a) => a.sizeId))];
  const coverage = job.probe?.coverage ?? 1;

  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1 truncate">{job.sourceName}</span>

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {job.probe?.upscaled ? (
          <Badge tone="warn" title="Source was below the print floor and was resampled up. This does not add detail that was never captured.">
            upscaled
          </Badge>
        ) : null}

        {coverage < COVERAGE_WARN ? (
          <Badge
            tone="warn"
            title={`Only ${Math.round(coverage * 100)}% of the artwork survives the crop — the source is likely the wrong shape for this format.`}
          >
            {Math.round(coverage * 100)}% used
          </Badge>
        ) : null}

        {lowResSizes.length > 0 ? (
          <Badge tone="bad" title={`Below 250dpi at: ${lowResSizes.join(", ")}`}>
            low-res {lowResSizes.join(" ")}
          </Badge>
        ) : null}

        {job.status.kind === "failed" ? (
          <Badge tone="bad" title={job.status.message}>
            failed
          </Badge>
        ) : job.status.kind === "needs-review" ? (
          <Badge tone="good">ready</Badge>
        ) : job.status.kind === "running" ? (
          <Badge>{job.status.stage}…</Badge>
        ) : (
          <Badge>{job.stage}</Badge>
        )}
      </span>
    </li>
  );
}
