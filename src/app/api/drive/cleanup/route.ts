import { previewCleanup, runCleanup } from "@/lib/drive/cleanup";

/**
 * Old shared Drive folders: GET previews what would go, POST moves the
 * confirmed ones to the Drive trash. The plan is worked out again on POST,
 * so only folders that are still safe to remove are touched.
 */
export async function GET() {
  const preview = await previewCleanup();
  if (!preview.ok) return Response.json({ error: preview.error }, { status: 502 });
  return Response.json(preview.value);
}

export async function POST(request: Request) {
  let ids: string[] = [];
  try {
    const body = (await request.json()) as { ids?: unknown };
    if (Array.isArray(body.ids)) ids = body.ids.filter((id) => typeof id === "string");
  } catch {
    // No body: nothing confirmed.
  }
  if (ids.length === 0) {
    return Response.json({ error: "No folders confirmed." }, { status: 400 });
  }
  const result = await runCleanup(ids);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json(result.value);
}
