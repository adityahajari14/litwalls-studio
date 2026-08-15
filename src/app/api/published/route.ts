import { listPublished } from "@/lib/pipeline/registry";
import { storeAdminUrl } from "@/lib/shopify/env";

export async function GET() {
  const records = await listPublished();
  return Response.json({
    published: records,
    // The admin origin is server-side config, and the client needs it to link
    // out to each product.
    adminUrl: storeAdminUrl(),
  });
}
