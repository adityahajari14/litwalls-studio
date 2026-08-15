import { createBatch } from "@/lib/pipeline/create";
import { listBatches, writeBatch } from "@/lib/pipeline/store";
import {
  fetchCategories,
  fetchCategoriesFallback,
} from "@/lib/shopify/collections";
import type { PosterKind } from "@/lib/print/types";

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
    categoryId?: string;
    kind?: string;
    prices?: Record<string, string>;
    compareAt?: Record<string, string>;
  };

  if (input.kind !== "normal" && input.kind !== "split3") {
    return Response.json(
      { error: 'Unknown poster kind. Expected "normal" or "split3".' },
      { status: 400 },
    );
  }

  // The category is resolved against LIVE Shopify collections rather than
  // trusted from the client, then snapshotted onto the batch. Validating here
  // means a stale browser tab cannot create a batch pointing at a collection
  // that has since been renamed or deleted.
  let categories;
  try {
    categories = await fetchCategories();
  } catch {
    categories = await fetchCategoriesFallback().catch(() => []);
  }

  const category = categories.find((c) => c.id === input.categoryId);
  if (!category) {
    return Response.json(
      {
        error: categories.length
          ? `Unknown collection. Expected one of: ${categories.map((c) => c.id).join(", ")}`
          : "Could not read collections from Shopify. Check the Admin token.",
      },
      { status: 400 },
    );
  }

  const batch = createBatch({
    name: String(input.name ?? ""),
    category,
    kind: input.kind as PosterKind,
    prices: input.prices,
    compareAt: input.compareAt,
  });

  await writeBatch(batch);
  return Response.json({ batch }, { status: 201 });
}
