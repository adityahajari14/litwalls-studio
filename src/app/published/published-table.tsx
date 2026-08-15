"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge, Button, Card, Input } from "@/components/ui";
import type { PublishedRecord } from "@/lib/pipeline/registry";

export function PublishedTable({
  records,
  adminUrl,
}: {
  records: PublishedRecord[];
  adminUrl: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [record.title, record.subject, record.categoryLabel, record.sourceName]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [records, query]);

  async function setStatus(record: PublishedRecord, status: "ACTIVE" | "DRAFT") {
    setBusy(record.productId);
    try {
      const response = await fetch(
        `/api/published/${encodeURIComponent(record.productId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!response.ok) {
        const body = await response.json();
        alert(body.error ?? "Could not change the status.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function forget(record: PublishedRecord) {
    if (
      !confirm(
        `Remove "${record.title}" from this list?\n\nThe Shopify product is NOT deleted — this only stops Studio tracking it, so it will no longer be flagged as a duplicate.`,
      )
    ) {
      return;
    }
    setBusy(record.productId);
    try {
      await fetch(`/api/published/${encodeURIComponent(record.productId)}`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search published products…"
        className="mb-4 max-w-sm"
      />

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-300 text-left">
              <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                Product
              </th>
              <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                Collection
              </th>
              <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                Published
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((record) => (
              <tr
                key={record.productId}
                className="border-b border-paper-300/50 last:border-0"
              >
                <td className="px-4 py-2.5">
                  <span className="block truncate font-medium text-ink-900">
                    {record.title}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {record.sourceName}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-500">
                  {record.categoryLabel}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <Badge tone={record.status === "ACTIVE" ? "ok" : "neutral"}>
                      {record.status === "ACTIVE" ? "live" : "draft"}
                    </Badge>
                    <span className="tnum text-xs text-ink-400">
                      {new Date(record.publishedAt).toLocaleDateString()}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex justify-end gap-1.5">
                    {adminUrl ? (
                      <a
                        href={`${adminUrl}/products/${record.productId.split("/").pop()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center rounded-lg border border-paper-400/70 bg-paper-200 px-2.5 text-xs font-medium text-ink-700 hover:border-paper-500 hover:text-ink-900"
                      >
                        Open in Shopify
                      </a>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={busy === record.productId}
                      onClick={() =>
                        setStatus(
                          record,
                          record.status === "ACTIVE" ? "DRAFT" : "ACTIVE",
                        )
                      }
                    >
                      {record.status === "ACTIVE" ? "Unpublish" : "Go live"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === record.productId}
                      onClick={() => forget(record)}
                      title="Stop tracking — does not delete from Shopify"
                    >
                      ×
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-400">
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      ) : null}
    </div>
  );
}
