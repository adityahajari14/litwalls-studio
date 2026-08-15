import { loadTemplates } from "@/lib/templates/load";
import { createTemplate } from "@/lib/templates/write";

export async function GET() {
  return Response.json({ templates: await loadTemplates() });
}

/**
 * Create a template from an uploaded background image.
 *
 * A Route Handler rather than a Server Action: room photos off a phone are
 * routinely well past the 1MB body cap that Server Actions impose.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("background");
  const name = String(form.get("name") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "Choose a background image." },
      { status: 400 },
    );
  }
  if (!name) {
    return Response.json({ error: "Give the template a name." }, { status: 400 });
  }

  const result = await createTemplate({
    name,
    background: Buffer.from(await file.arrayBuffer()),
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ template: result.value }, { status: 201 });
}
