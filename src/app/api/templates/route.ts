import { loadTemplates } from "@/lib/templates/load";

export async function GET() {
  return Response.json({ templates: await loadTemplates() });
}
