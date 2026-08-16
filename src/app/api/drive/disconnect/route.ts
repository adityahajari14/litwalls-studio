import { disconnectDrive } from "@/lib/drive/auth";

/**
 * Forget the stored Drive credential.
 *
 * Local-only mutation — no external redirect, no state cookie needed. Existing
 * batches and rendered files are untouched; this only clears which Google
 * account new uploads would go to. Reconnecting (possibly to a different
 * account, via the account chooser `authorizeUrl` now forces) is the only way
 * back, which is the point.
 */
export async function POST() {
  await disconnectDrive();
  return Response.json({ ok: true });
}
