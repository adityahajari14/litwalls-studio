import { loadLibrary } from "@/lib/library/load";

export async function GET() {
  return Response.json({ images: await loadLibrary() });
}
