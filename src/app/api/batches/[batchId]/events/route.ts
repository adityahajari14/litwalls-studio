import { watch } from "node:fs";

import { batchDir } from "@/lib/pipeline/paths";
import { listJobs, readBatch } from "@/lib/pipeline/store";

/**
 * Stream job progress as Server-Sent Events.
 *
 * Polling would work, but a twenty-poster batch runs for minutes and a
 * one-second poll re-reads twenty JSON files hundreds of times for
 * mostly-unchanged data. SSE here is just a streaming Response — no library,
 * no websocket server — and the browser reconnects on its own, which matters
 * because `next dev` restarts whenever a file is saved.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/batches/[batchId]/events">,
) {
  const { batchId } = await ctx.params;

  const batch = await readBatch(batchId);
  if (!batch) {
    return new Response("Batch not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let timer: NodeJS.Timeout | null = null;

      const send = async () => {
        if (closed) return;
        try {
          const jobs = await listJobs(batchId);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ jobs })}\n\n`),
          );
        } catch {
          // A read failing mid-stream is not worth tearing the connection
          // down for — the next event will pick it up.
        }
      };

      /**
       * Debounced, because sharp writes several files in quick succession and
       * an un-debounced watcher fires a dozen times per stage — each one
       * re-reading every job.json in the batch.
       */
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void send(), 150);
      };

      let watcher: ReturnType<typeof watch> | null = null;
      try {
        watcher = watch(batchDir(batchId), { recursive: true }, schedule);
      } catch {
        // Recursive watching is not available everywhere; the heartbeat below
        // keeps the UI updating regardless.
      }

      // Also acts as a keep-alive: without periodic traffic a proxy or the
      // browser may drop an idle event stream.
      const heartbeat = setInterval(() => void send(), 5000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        clearInterval(heartbeat);
        watcher?.close();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", cleanup);
      void send();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops a reverse proxy buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
