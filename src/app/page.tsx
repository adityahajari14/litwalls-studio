import Link from "next/link";

import { listBatches } from "@/lib/pipeline/store";
import { readSettings } from "@/lib/pipeline/settings";
import { CATEGORY_LABEL } from "@/lib/print/title";

export default async function Home() {
  const [batches, settings] = await Promise.all([
    listBatches(),
    readSettings(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Litwalls Studio</h1>
        <div className="flex gap-4 text-sm text-zinc-500">
          <Link href="/templates" className="underline-offset-4 hover:underline">
            Templates
          </Link>
          <Link href="/settings" className="underline-offset-4 hover:underline">
            Settings
          </Link>
        </div>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Poster processing and publishing. Local only — this never ships.
      </p>

      {settings.updatedAt === 0 ? (
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Prices are still the built-in placeholders.{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Set your real defaults
          </Link>{" "}
          before publishing anything.
        </p>
      ) : null}

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Batches
          </h2>
          <Link
            href="/batches/new"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            New batch
          </Link>
        </div>

        {batches.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No batches yet. Create one to start uploading posters.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-200/70 dark:divide-zinc-800">
            {batches.map((batch) => (
              <li key={batch.id}>
                <Link
                  href={`/batches/${batch.id}`}
                  className="flex items-center justify-between py-3 text-sm hover:opacity-70"
                >
                  <span>
                    <span className="font-medium">{batch.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {CATEGORY_LABEL[batch.category]}
                      {batch.kind === "split3" ? " · split" : ""}
                    </span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {batch.jobIds.length} poster
                    {batch.jobIds.length === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
