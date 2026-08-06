import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { exchangeCode } from "@/lib/drive/auth";

/**
 * Receive the authorisation code and store a refresh token.
 *
 * Redirects back to the dashboard either way — an error page at this URL would
 * leave the user staring at a callback route with no way back.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get("drive_oauth_state")?.value;
  jar.delete("drive_oauth_state");

  const error = params.get("error");
  if (error) {
    return redirectHome(request, `Drive authorisation was declined (${error}).`);
  }

  const state = params.get("state");
  if (!expected || state !== expected) {
    // A mismatch means this callback did not originate from our connect link.
    return redirectHome(
      request,
      "Drive authorisation could not be verified. Please try connecting again.",
    );
  }

  const code = params.get("code");
  if (!code) return redirectHome(request, "Google returned no authorisation code.");

  const result = await exchangeCode(code);
  return redirectHome(
    request,
    result.ok ? null : result.error,
    result.ok ? "Google Drive connected." : null,
  );
}

function redirectHome(
  request: NextRequest,
  error: string | null,
  notice?: string | null,
) {
  const url = new URL("/", request.nextUrl.origin);
  if (error) url.searchParams.set("driveError", error);
  if (notice) url.searchParams.set("driveNotice", notice);
  return Response.redirect(url, 302);
}
