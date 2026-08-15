import { PublishedTable } from "@/app/published/published-table";
import { Empty, PageHeader } from "@/components/ui";
import { listPublished } from "@/lib/pipeline/registry";
import { storeAdminUrl } from "@/lib/shopify/env";

export const metadata = { title: "Published · Litwalls Studio" };

/**
 * Everything Studio has put into Shopify.
 *
 * The tool used to forget a batch the moment it published, so a typo meant
 * hunting the product down in the Shopify admin by hand. This is the record
 * that makes a published product reachable again — and the same record that
 * powers duplicate detection.
 */
export default async function PublishedPage() {
  const [records, adminUrl] = await Promise.all([
    listPublished(),
    Promise.resolve(safeAdminUrl()),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Published"
        meta={
          records.length > 0
            ? `${records.length} product${records.length === 1 ? "" : "s"} published from Studio.`
            : "Products Studio has published to Shopify appear here."
        }
      />

      {records.length === 0 ? (
        <div className="mt-8">
          <Empty title="Nothing published yet">
            Approve posters in a batch and publish them — they will be listed
            here with a link straight into Shopify.
          </Empty>
        </div>
      ) : (
        <div className="mt-6">
          <PublishedTable records={records} adminUrl={adminUrl} />
        </div>
      )}
    </main>
  );
}

/** The env read throws when unconfigured; the page should still render. */
function safeAdminUrl(): string {
  try {
    return storeAdminUrl();
  } catch {
    return "";
  }
}
