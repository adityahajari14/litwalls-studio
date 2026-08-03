import Link from "next/link";

import { CornerPicker } from "@/app/templates/corner-picker";
import { loadTemplates } from "@/lib/templates/load";

export const metadata = { title: "Mockup templates · Litwalls Studio" };

export default async function TemplatesPage() {
  const entries = await loadTemplates();
  const usable = entries.filter((entry) => entry.ok);
  const broken = entries.filter((entry) => !entry.ok);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Mockup templates
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Room photos that posters are composited into. To add one, create a
        folder under <code className="text-xs">mockup-templates/</code>, drop in
        a <code className="text-xs">background.jpg</code>, and reload this page
        — it will offer a corner picker to generate the JSON.
      </p>

      {entries.length === 0 ? (
        <p className="mt-8 rounded border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
          No templates yet. Create{" "}
          <code className="text-xs">mockup-templates/my-room/background.jpg</code>{" "}
          to get started.
        </p>
      ) : null}

      {usable.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Ready ({usable.length})
          </h2>
          <ul className="mt-4 grid gap-6 sm:grid-cols-2">
            {usable.map((entry) => {
              if (!entry.ok) return null;
              const t = entry.template;
              return (
                <li
                  key={t.id}
                  className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/templates/${t.id}/background`}
                    alt={t.name}
                    className="aspect-[4/3] w-full object-cover"
                  />
                  <div className="p-3">
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {t.kind === "perspective" ? "Perspective" : "Flat"} ·{" "}
                      {t.canvas.width}×{t.canvas.height} ·{" "}
                      <code>{t.id}</code>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {broken.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Needs attention ({broken.length})
          </h2>
          <ul className="mt-4 space-y-6">
            {broken.map((entry) => {
              if (entry.ok) return null;
              return (
                <li
                  key={entry.id}
                  className="rounded-lg border border-amber-300 p-4 dark:border-amber-900"
                >
                  <p className="text-sm font-medium">
                    <code>{entry.id}</code>
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                    {entry.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                  {entry.hasBackground ? (
                    <CornerPicker templateId={entry.id} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
