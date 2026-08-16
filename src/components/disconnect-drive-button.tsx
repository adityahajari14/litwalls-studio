"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Forget the connected Drive account.
 *
 * A plain `confirm()`, not the typed-confirmation flow used for deleting a
 * batch — this only forgets a credential. Nothing local is destroyed, and
 * reconnecting (to the same account or a different one) is one click away.
 */
export function DisconnectDriveButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (!confirm("Disconnect Google Drive? Reconnect any time to file to it again.")) {
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/drive/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={busy} onClick={disconnect}>
      {busy ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}
