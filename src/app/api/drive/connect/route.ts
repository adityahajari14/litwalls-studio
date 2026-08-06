import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { authorizeUrl, driveConfigured } from "@/lib/drive/auth";

/**
 * Start the Drive OAuth flow.
 *
 * The `state` value is a random nonce stored in an httpOnly cookie and checked
 * on the way back. Even locally this is worth doing: without it, any page you
 * visit could link to the callback and hand Studio an attacker's authorisation
 * code, quietly filing your posters into someone else's Drive.
 */
export async function GET() {
  if (!driveConfigured()) {
    return new Response(
      "Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and " +
        "GOOGLE_OAUTH_CLIENT_SECRET to .env.local — see README.md.",
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("drive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return Response.redirect(authorizeUrl(state), 302);
}
