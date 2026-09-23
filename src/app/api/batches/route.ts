import { loadLibrary } from "@/lib/library/load";
import { createBatch } from "@/lib/pipeline/create";
import { listBatches, writeBatch } from "@/lib/pipeline/store";
import {
  fetchCategories,
  fetchCategoriesFallback,
} from "@/lib/shopify/collections";
import { AUTO_CATEGORY } from "@/lib/print/categories";
import { usableTemplates } from "@/lib/templates/load";
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
    /** A collection handle, or AUTO_CATEGORY to let each poster be filed on
     *  its own. */
    categoryId?: string | null;
    kind?: string;
    prices?: Record<string, string>;
    compareAt?: Record<string, string>;
    /** Mockup templates every poster in the batch renders with by default. */
    templateIds?: string[];
    /** Shared library images attached to every poster by default. */
    libraryIds?: string[];
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

  // Auto is a real choice, not a missing one: the batch stores no collection
  // and every poster gets its own at analyze time. Still validated against
  // live Shopify below for the fixed case, so a stale browser tab cannot
  // create a batch pointing at a collection that has since been deleted.
  const auto = input.categoryId === AUTO_CATEGORY;

  if (auto && categories.length === 0) {
    return Response.json(
      {
        error:
          "Auto needs collections to choose from, and Shopify returned none. " +
          "Create one in the admin, then reload.",
      },
      { status: 400 },
    );
  }

  const category = auto
    ? null
    : (categories.find((c) => c.id === input.categoryId) ?? null);

  if (!auto && !category) {
    return Response.json(
      {
        error: categories.length
          ? `Unknown collection. Expected ${AUTO_CATEGORY}, or one of: ${categories.map((c) => c.id).join(", ")}`
          : "Could not read collections from Shopify. Check the Admin token.",
      },
      { status: 400 },
    );
  }

  // Template and library selections are resolved against what actually exists
  // rather than trusted from the client — a stale tab must not pin a batch to
  // a template that has since been deleted. Unknowns are dropped, not a 400:
  // the batch is still valid, just with a shorter default set.
  const wantTemplates = Array.isArray(input.templateIds)
    ? input.templateIds.filter((id): id is string => typeof id === "string")
    : [];
  const wantLibrary = Array.isArray(input.libraryIds)
    ? input.libraryIds.filter((id): id is string => typeof id === "string")
    : [];

  const [templates, library] = await Promise.all([
    wantTemplates.length ? usableTemplates() : Promise.resolve([]),
    wantLibrary.length ? loadLibrary() : Promise.resolve([]),
  ]);
  const templateIds = wantTemplates.filter((id) =>
    templates.some((t) => t.id === id),
  );
  const libraryIds = wantLibrary.filter((id) =>
    library.some((l) => l.id === id),
  );

  const batch = createBatch({
    name: String(input.name ?? ""),
    category,
    kind: input.kind as PosterKind,
    prices: input.prices,
    compareAt: input.compareAt,
    defaultTemplateIds: templateIds,
    defaultLibraryIds: libraryIds,
  });

  await writeBatch(batch);
  return Response.json({ batch }, { status: 201 });
}
