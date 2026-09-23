import Link from "next/link";

import { DriveStatus } from "@/components/drive-status";
import {
  Badge,
  ButtonLink,
  Card,
  Empty,
  PageHeader,
  Section,
} from "@/components/ui";
import { listBatches, listJobs } from "@/lib/pipeline/store";
import { readSettings } from "@/lib/pipeline/settings";
import { hasReached, type PosterJob } from "@/lib/print/types";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ driveError?: string; driveNotice?: string }>;
}) {
  const [batches, settings, params] = await Promise.all([
    listBatches(),
    readSettings(),
    searchParams,
  ]);

  // Counts per batch, so the list answers "what still needs me?" at a glance
  // rather than only "what exists".
  const withCounts = await Promise.all(
    batches.map(async (batch) => ({
      batch,
      jobs: await listJobs(batch.id),
    })),
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Batches"
        meta="Upload artwork, review what the pipeline produced, publish to Shopify."
        actions={
          <ButtonLink href="/batches/new" variant="primary">
            New batch
          </ButtonLink>
        }
      />

      {settings.updatedAt === 0 ? (
        <Card className="mt-6 border-warn-500/30 bg-warn-50 p-4">
          <p className="text-sm text-warn-700">
            <strong className="font-semibold">Prices are placeholders.</strong>{" "}
            Set your real defaults in{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>{" "}
            before publishing anything.
          </p>
        </Card>
      ) : null}

      {params.driveError ? (
        <Card className="mt-6 border-danger-500/30 bg-danger-50 p-4">
          <p className="text-sm text-danger-700">{params.driveError}</p>
        </Card>
      ) : null}
      {params.driveNotice ? (
        <Card className="mt-6 border-ok-500/30 bg-ok-500/10 p-4">
          <p className="text-sm text-ok-700">{params.driveNotice}</p>
        </Card>
      ) : null}

      <div className="mt-6">
        <DriveStatus />
      </div>

      <Section title="All batches" className="mt-8">
        {withCounts.length === 0 ? (
          <Empty
            title="No batches yet"
            action={
              <ButtonLink href="/batches/new" variant="primary">
                Create your first batch
              </ButtonLink>
            }
          >
            A batch groups posters that share a category, format and prices.
          </Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {withCounts.map(({ batch, jobs }, index) => (
              <li
                key={batch.id}
                className="animate-fade-rise"
                style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
              >
                <Link href={`/batches/${batch.id}`} className="block">
                  <Card className="h-full p-4 transition-all duration-200 hover:border-paper-400">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate font-medium text-ink-900">
                        {batch.name}
                      </h3>
                      <Badge tone={batch.category ? "neutral" : "accent"}>
                        {batch.category?.label ?? "auto"}
                      </Badge>
                    </div>

                    <p className="tnum mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-400">
                      {jobs.length} poster{jobs.length === 1 ? "" : "s"}
                      {batch.kind === "split3" ? " · split" : ""}
                    </p>

                    <div className="mt-3.5 flex flex-wrap gap-1">
                      <Progress jobs={jobs} />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}

function Progress({ jobs }: { jobs: PosterJob[] }) {
  if (jobs.length === 0) {
    return <span className="text-xs text-ink-400">empty</span>;
  }

  const review = jobs.filter(
    (job) => job.status.kind === "needs-review" && job.stage !== "approved",
  ).length;
  const approved = jobs.filter((job) => job.stage === "approved").length;
  const published = jobs.filter((job) => hasReached(job.stage, "published")).length;
  const failed = jobs.filter((job) => job.status.kind === "failed").length;
  const waiting = jobs.length - review - approved - published - failed;

  return (
    <>
      {waiting > 0 ? <Badge>{waiting} to process</Badge> : null}
      {review > 0 ? <Badge tone="accent">{review} to review</Badge> : null}
      {approved > 0 ? <Badge tone="ok">{approved} approved</Badge> : null}
      {published > 0 ? <Badge tone="ok">{published} live</Badge> : null}
      {failed > 0 ? <Badge tone="danger">{failed} failed</Badge> : null}
    </>
  );
}
