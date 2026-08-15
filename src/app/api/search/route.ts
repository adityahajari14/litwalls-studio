import { listBatches, listJobs } from "@/lib/pipeline/store";
import { listPublished } from "@/lib/pipeline/registry";

/**
 * Find a poster across every batch, and across everything published.
 *
 * You could previously only look inside a batch you had already opened, which
 * meant remembering which batch a poster was in — exactly the thing a tool
 * should remember for you.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase();
  if (!query) return Response.json({ jobs: [], published: [] });

  const batches = await listBatches();

  const jobs = (
    await Promise.all(
      batches.map(async (batch) => {
        const found = await listJobs(batch.id);
        return found
          .filter((job) =>
            [job.sourceName, job.metadata?.subject, ...(job.metadata?.tags ?? [])]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(query),
          )
          .map((job) => ({
            batchId: batch.id,
            batchName: batch.name,
            jobId: job.id,
            subject: job.metadata?.subject ?? null,
            sourceName: job.sourceName,
            stage: job.stage,
            // The first mockup is the most recognisable thumbnail; the A3
            // render stands in while mockups have not been made yet.
            preview:
              job.mockups[0]?.relPath ??
              job.assets.find((a) => a.sizeId === "A3")?.relPath ??
              null,
          }));
      }),
    )
  ).flat();

  const published = (await listPublished())
    .filter((record) =>
      [record.title, record.subject, record.sourceName]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .slice(0, 20);

  return Response.json({ jobs: jobs.slice(0, 40), published });
}
