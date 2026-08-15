import Link from "next/link";

import { driveConfigured, driveConnected } from "@/lib/drive/auth";

/**
 * Whether Drive is usable, and what to do about it if not.
 *
 * Three distinct states, because the fix differs: not configured (add
 * credentials), configured but not connected (click connect), and connected.
 * Collapsing the first two into "not connected" would send someone clicking a
 * button that cannot work.
 */
export async function DriveStatus() {
  if (!driveConfigured()) {
    return (
      <p className="mt-6 rounded border border-paper-200 px-3 py-2 text-sm text-ink-500">
        Google Drive is not configured. Add{" "}
        <code className="text-xs">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
        <code className="text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code> to{" "}
        <code className="text-xs">.env.local</code> — see the README.
      </p>
    );
  }

  if (!(await driveConnected())) {
    return (
      <p className="mt-6 flex flex-wrap items-center gap-3 rounded border border-amber-300 px-3 py-2 text-sm">
        <span className="text-amber-800">
          Google Drive is not connected — print files cannot be filed yet.
        </span>
        <Link
          href="/api/drive/connect"
          className="rounded bg-ink-900 px-3 py-1 text-xs font-medium text-white"
        >
          Connect Drive
        </Link>
      </p>
    );
  }

  return (
    <p className="mt-6 text-xs text-ink-500">
      Google Drive connected. Print files are filed to{" "}
      <code>Litwalls Posters / &lt;Category&gt; / &lt;Product&gt;</code>.
    </p>
  );
}
