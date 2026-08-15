import { loadTemplate } from "@/lib/templates/load";
import {
  deleteTemplate,
  replaceBackground,
  saveTemplate,
} from "@/lib/templates/write";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/templates/[templateId]">,
) {
  const { templateId } = await ctx.params;
  const entry = await loadTemplate(templateId);
  return Response.json({ entry });
}

/** Save an edited template — placement, name, shadow, per-size areas. */
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/templates/[templateId]">,
) {
  const { templateId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const template = body as { id?: string };
  // The folder is the identity. Letting the payload rename it would leave the
  // background image behind in the old folder.
  if (template.id !== templateId) {
    return Response.json(
      { error: "A template's id cannot be changed." },
      { status: 400 },
    );
  }

  const result = await saveTemplate(body);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ template: result.value });
}

/** Replace the background image, keeping the placement. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/templates/[templateId]">,
) {
  const { templateId } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("background");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose an image." }, { status: 400 });
  }

  const result = await replaceBackground(
    templateId,
    Buffer.from(await file.arrayBuffer()),
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  // The canvas must follow the new image, or every placement coordinate is
  // suddenly measured against the wrong frame.
  const entry = await loadTemplate(templateId);
  if (entry.ok) {
    await saveTemplate({ ...entry.template, canvas: result.value });
  }

  return Response.json({ canvas: result.value });
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/templates/[templateId]">,
) {
  const { templateId } = await ctx.params;
  const result = await deleteTemplate(templateId);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
