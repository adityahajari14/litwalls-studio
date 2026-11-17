import {
  createCategory,
  fetchCategories,
  fetchCategoriesFallback,
} from "@/lib/shopify/collections";

/** Create a new (smart, tag-based) collection from the batch form. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Give the category a name." }, { status: 400 });
  }

  try {
    return Response.json({ category: await createCategory(name) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

/**
 * The collections a batch can publish into.
 *
 * Read live from Shopify rather than hardcoded, so creating a collection in
 * the admin is all it takes for Studio to offer it.
 */
export async function GET() {
  try {
    return Response.json({ categories: await fetchCategories() });
  } catch (adminError) {
    // The Admin token may lack read_collections on an older install. The
    // Storefront token can still enumerate them, minus the tag rules — a
    // degraded answer beats an empty category picker.
    try {
      return Response.json({
        categories: await fetchCategoriesFallback(),
        degraded: true,
      });
    } catch {
      return Response.json(
        {
          error:
            adminError instanceof Error
              ? adminError.message
              : String(adminError),
          categories: [],
        },
        { status: 502 },
      );
    }
  }
}
