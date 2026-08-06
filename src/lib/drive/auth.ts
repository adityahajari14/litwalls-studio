import "server-only";

import { readFile } from "node:fs/promises";

import { DRIVE_TOKEN_FILE, writeJsonAtomic } from "@/lib/pipeline/paths";
import { attempt, err, ok, type Result } from "@/lib/result";

/**
 * OAuth for a locally-installed app — the loopback redirect flow.
 *
 * A service account was the obvious first thought and is the wrong answer: a
 * service account has NO Drive storage quota of its own, so its uploads either
 * fail outright or produce files owned by a robot that nobody can find in
 * their own Drive. The workaround is a Shared Drive, which needs Workspace.
 *
 * Since Studio only ever runs on the owner's machine, authenticating AS the
 * owner is both simpler and gives exactly the ownership we want: the files
 * appear in your Drive, owned by you.
 *
 * The refresh token is written to workspace/drive-token.json. That file is a
 * long-lived credential to a personal Google account — it is gitignored, and
 * it is the reason the whole workspace directory must stay out of git.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * `drive.file` — access limited to files this app creates.
 *
 * Deliberately not the full `drive` scope. Studio has no business reading the
 * rest of your Drive, and a narrow scope means a leaked token cannot either.
 */
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export const REDIRECT_URI = "http://localhost:3000/api/drive/callback";

type StoredToken = {
  refreshToken: string;
  /** Cached so a short session does not re-mint on every upload. */
  accessToken?: string;
  expiresAt?: number;
  connectedAt: number;
};

export function driveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

function credentials() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. See README.md.",
    );
  }
  return { clientId, clientSecret };
}

/** Where to send the browser to grant access. */
export function authorizeUrl(state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    // Without offline access Google returns no refresh token, and the
    // connection would silently expire an hour later.
    access_type: "offline",
    // Forces the consent screen so a refresh token is issued even on a repeat
    // authorisation — Google omits it otherwise, which looks like success but
    // leaves nothing to persist.
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function readToken(): Promise<StoredToken | null> {
  try {
    return JSON.parse(await readFile(DRIVE_TOKEN_FILE, "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

export async function driveConnected(): Promise<boolean> {
  const token = await readToken();
  return Boolean(token?.refreshToken);
}

export async function disconnectDrive(): Promise<void> {
  await writeJsonAtomic(DRIVE_TOKEN_FILE, {});
}

/** Exchange the one-time code from the callback for a refresh token. */
export async function exchangeCode(code: string): Promise<Result<void>> {
  const { clientId, clientSecret } = credentials();

  return attempt("Drive token exchange", async () => {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body.error_description ?? body.error ?? response.statusText,
      );
    }
    if (!body.refresh_token) {
      throw new Error(
        "Google returned no refresh token. Revoke Studio's access at " +
          "myaccount.google.com/permissions and connect again.",
      );
    }

    const token: StoredToken = {
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      connectedAt: Date.now(),
    };
    await writeJsonAtomic(DRIVE_TOKEN_FILE, token);
  });
}

/**
 * A usable access token, refreshing when needed.
 *
 * Refreshed 60s before nominal expiry: a token that expires mid-upload turns a
 * 40MB transfer into a 401 halfway through, and the margin costs nothing.
 */
export async function getAccessToken(): Promise<Result<string>> {
  const token = await readToken();
  if (!token?.refreshToken) {
    return err("Google Drive is not connected. Connect it from the dashboard.");
  }

  if (token.accessToken && token.expiresAt && token.expiresAt - 60_000 > Date.now()) {
    return ok(token.accessToken);
  }

  const { clientId, clientSecret } = credentials();

  return attempt("Drive token refresh", async () => {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: token.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body.error_description ?? body.error ?? response.statusText,
      );
    }

    await writeJsonAtomic(DRIVE_TOKEN_FILE, {
      ...token,
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    } satisfies StoredToken);

    return body.access_token as string;
  });
}
