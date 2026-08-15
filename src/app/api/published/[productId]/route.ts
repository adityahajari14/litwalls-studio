import { admin } from "@/lib/shopify/admin";
import { forgetPublished, listPublished } from "@/lib/pipeline/registry";
import { recordPublished } from "@/lib/pipeline/registry";

const PRODUCT_STATUS = /* GraphQL */ `
  mutation SetStatus($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Take a published product live, or pull it back to draft.
 *
 * Publishing was one-way before: once a product was out, fixing a typo or
 * pulling a bad crop meant leaving Studio for the Shopify admin — which is
 * precisely the round trip this tool exists to remove.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/published/[productId]">,
) {
  const { productId } = await ctx.params;
  const id = decodeURIComponent(productId);

  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  if (body.status !== "ACTIVE" && body.status !== "DRAFT") {
    return Response.json(
      { error: 'status must be "ACTIVE" or "DRAFT".' },
      { status: 400 },
    );
  }

  try {
    const data = await admin<{
      productUpdate: {
        product: { id: string; status: string } | null;
        userErrors: { message: string }[];
      };
    }>(PRODUCT_STATUS, { input: { id, status: body.status } });

    const errors = data.productUpdate.userErrors;
    if (errors.length > 0) {
      return Response.json(
        { error: errors.map((e) => e.message).join("; ") },
        { status: 400 },
      );
    }

    // Keep the local record in step, so the Published list does not claim a
    // product is live after it has been pulled.
    const record = (await listPublished()).find((r) => r.productId === id);
    if (record) {
      await recordPublished({ ...record, status: body.status });
    }

    return Response.json({ ok: true, status: body.status });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 500 },
    );
  }
}

/**
 * Forget a product locally WITHOUT touching Shopify.
 *
 * For a product deleted in the admin, or one that should stop counting toward
 * duplicate detection. Deliberately not a Shopify delete: this tool should not
 * be able to remove a live product a customer might be looking at, and the
 * name of the button would never make that risk obvious enough.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/published/[productId]">,
) {
  const { productId } = await ctx.params;
  await forgetPublished(decodeURIComponent(productId));
  return Response.json({ ok: true });
}
