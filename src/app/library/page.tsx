import { Badge, Card, Empty, PageHeader, Section } from "@/components/ui";
import { loadLibrary } from "@/lib/library/load";

export const metadata = { title: "Images · Litwalls Studio" };

const ROLE_LABEL: Record<string, string> = {
  "size-guide": "Size guide",
  quality: "Quality",
  shipping: "Shipping",
  other: "Other",
};

/**
 * The shared product-image library.
 *
 * Read-only on purpose: this is a folder on disk, and a dashboard that wrote
 * into it would be a surprise. Adding an image is dropping a file in.
 */
export default async function LibraryPage() {
  const images = await loadLibrary();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Shared images"
        meta="Attached to every product — size guides, quality panels, shipping info. Uploaded to Shopify once and reused."
      />

      <Card className="mt-6 bg-paper-100/60 p-4">
        <p className="text-sm text-ink-600">
          Drop image files into{" "}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-ink-700">
            product-images/
          </code>{" "}
          and reload. Names and roles are guessed from the filename — call one{" "}
          <code className="rounded bg-white px-1 font-mono text-xs">
            size-guide.png
          </code>{" "}
          and it is recognised automatically.
        </p>
        <p className="mt-2 text-xs text-ink-400">
          To override a name or pin the order, add a{" "}
          <code className="font-mono">library.json</code> mapping each filename
          to <code className="font-mono">{`{ name, role, order }`}</code>.
        </p>
      </Card>

      <Section title={`In the library (${images.length})`} className="mt-8">
        {images.length === 0 ? (
          <Empty title="No shared images yet">
            Products will publish with their mockups only. Add a size guide to
            give customers something to compare against.
          </Empty>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => (
              <li key={image.id}>
                <Card className="overflow-hidden">
                  <div className="checkerboard aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/library/${encodeURIComponent(image.id)}`}
                      alt={image.name}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {image.name}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge>{ROLE_LABEL[image.role] ?? image.role}</Badge>
                      <span className="tnum text-xs text-ink-400">
                        {Math.max(1, Math.round(image.bytes / 1024))} KB
                      </span>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
