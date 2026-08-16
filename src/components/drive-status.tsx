import { ButtonAnchor, Card } from "@/components/ui";
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
      <Card className="p-3">
        <p className="text-sm text-ink-500">
          Google Drive is not configured. Add{" "}
          <code className="font-mono text-xs text-ink-700">
            GOOGLE_OAUTH_CLIENT_ID
          </code>{" "}
          and{" "}
          <code className="font-mono text-xs text-ink-700">
            GOOGLE_OAUTH_CLIENT_SECRET
          </code>{" "}
          to <code className="font-mono text-xs text-ink-700">.env.local</code> —
          see the README.
        </p>
      </Card>
    );
  }

  if (!(await driveConnected())) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-warn-500/30 p-3">
        <p className="text-sm text-warn-700">
          Google Drive is not connected — print files cannot be filed yet.
        </p>
        <ButtonAnchor href="/api/drive/connect" variant="primary" size="sm">
          Connect Drive
        </ButtonAnchor>
      </Card>
    );
  }

  return (
    <p className="flex items-center gap-2 text-xs text-ink-400">
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-ok-500"
      />
      Drive connected — filing to{" "}
      <code className="font-mono text-ink-500">
        Litwalls Posters / &lt;Category&gt; / &lt;Product&gt;
      </code>
    </p>
  );
}
