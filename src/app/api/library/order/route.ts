import { reorderLibrary } from "@/lib/library/load";

/** Persist a new display order for the shared images. */
export async function PUT(request: Request) {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.ids)) {
    return Response.json({ error: "Expected an `ids` array." }, { status: 400 });
  }

  const ids = body.ids.filter((id): id is string => typeof id === "string");
  await reorderLibrary(ids);
  return Response.json({ ok: true });
}
