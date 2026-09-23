import { Card, PageHeader } from "@/components/ui";
import { LibraryManager } from "@/app/library/library-manager";
import { loadLibrary } from "@/lib/library/load";
import { libraryProcessingIds } from "@/lib/library/processing";

export const metadata = { title: "Images · Litwalls Studio" };

/**
 * The shared product-image library.
 *
 * Managed entirely from here now — upload, rename, re-role, reorder, delete —
 * writing to the `product-images/` folder and its `library.json` manifest. The
 * folder is still the source of truth, so a file dropped in by hand shows up
 * just the same.
 */
export default async function LibraryPage() {
  const [images, processing] = await Promise.all([
    loadLibrary(),
    libraryProcessingIds(),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Shared images"
        meta="Attached to every product — size guides, quality panels, shipping info. Uploaded to Shopify once and reused."
      />

      <Card className="mt-6 bg-paper-100/60 p-4">
        <p className="text-xs text-ink-400">
          Names and roles are guessed from the filename and can be edited here.
          To pin the order without touching this page, add a{" "}
          <code className="font-mono">library.json</code> mapping each filename
          to <code className="font-mono">{`{ name, role, order }`}</code>.
        </p>
      </Card>

      <LibraryManager
        initialImages={images.map((image) => ({
          id: image.id,
          name: image.name,
          role: image.role,
          bytes: image.bytes,
        }))}
        initialProcessing={processing}
      />
    </main>
  );
}
