import { fetchCategories, fetchCategoriesFallback } from "@/lib/shopify/collections";

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
