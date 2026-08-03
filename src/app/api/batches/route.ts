import { createBatch } from "@/lib/pipeline/create";
import { listBatches, writeBatch } from "@/lib/pipeline/store";
import { CATEGORY_IDS } from "@/lib/print/title";
import type { CategoryId, PosterKind } from "@/lib/print/types";

export async function GET() {
  return Response.json({ batches: await listBatches() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const input = body as {
    name?: string;
    category?: string;
    kind?: string;
    prices?: Record<string, string>;
    compareAt?: Record<string, string>;
  };

  // Validated rather than cast: category decides the title suffix, the
  // collection tag and the Drive folder, so a bad value would produce a
  // product filed under nothing at all.
  if (!CATEGORY_IDS.includes(input.category as CategoryId)) {
    return Response.json(
      { error: `Unknown category. Expected one of: ${CATEGORY_IDS.join(", ")}` },
      { status: 400 },
    );
  }
  if (input.kind !== "normal" && input.kind !== "split3") {
    return Response.json(
      { error: 'Unknown poster kind. Expected "normal" or "split3".' },
      { status: 400 },
    );
  }

  const batch = createBatch({
    name: String(input.name ?? ""),
    category: input.category as CategoryId,
    kind: input.kind as PosterKind,
    prices: input.prices,
    compareAt: input.compareAt,
  });

  await writeBatch(batch);
  return Response.json({ batch }, { status: 201 });
}
