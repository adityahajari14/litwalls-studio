import Link from "next/link";

import { NewTemplate } from "@/app/templates/new-template";
import { Badge, Card, Empty, PageHeader, Section } from "@/components/ui";
import { loadTemplates } from "@/lib/templates/load";

export const metadata = { title: "Mockups · Litwalls Studio" };

export default async function TemplatesPage() {
  const entries = await loadTemplates();
  const ready = entries.filter((entry) => entry.ok);
  const broken = entries.filter((entry) => !entry.ok);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <PageHeader
        title="Mockup templates"
        meta="Room photos posters are composited into. Each one defines where a poster hangs, per print size."
        actions={<NewTemplate />}
      />

      {entries.length === 0 ? (
        <div className="mt-8">
          <Empty title="No mockup templates yet">
            Upload a room photo and drag a box onto the wall — that is the whole
            setup. Posters are composited into it automatically after that.
          </Empty>
        </div>
      ) : null}

      {ready.length > 0 ? (
        <Section title={`Ready (${ready.length})`} className="mt-8">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ready.map((entry) => {
              if (!entry.ok) return null;
              const t = entry.template;
              return (
                <li key={t.id}>
                  <Link href={`/templates/${t.id}`}>
                    <Card className="overflow-hidden transition-shadow hover:shadow-[--shadow-pop]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/templates/${t.id}/background`}
                        alt={t.name}
                        className="aspect-[4/3] w-full object-cover"
                      />
                      <div className="p-3">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {t.name}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <Badge>
                            {t.kind === "perspective" ? "Angled" : "Straight on"}
                          </Badge>
                          {t.sizing?.perSize ? (
                            <Badge tone="accent">per size</Badge>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {broken.length > 0 ? (
        <Section title={`Needs setting up (${broken.length})`} className="mt-8">
          <ul className="space-y-3">
            {broken.map((entry) => {
              if (entry.ok) return null;
              return (
                <li key={entry.id}>
                  <Card className="border-warn-500/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-ink-900">
                          {entry.id}
                        </p>
                        <ul className="mt-1 space-y-0.5 text-xs text-warn-700">
                          {entry.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </div>
                      {entry.hasBackground ? (
                        <Link
                          href={`/templates/${entry.id}`}
                          className="shrink-0 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
                        >
                          Set up
                        </Link>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </main>
  );
}
