"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PriceTable } from "@/components/price-table";
import { Button, Field, Input } from "@/components/ui";
import { AUTO_CATEGORY } from "@/lib/print/categories";
import { sizesFor } from "@/lib/print/sizes";
import type { PartialPriceTable, PriceTable as Prices } from "@/lib/print/pricing";
import type {
  Category,
  MockupTemplate,
  PosterKind,
} from "@/lib/print/types";

type TemplateOption = {
  id: string;
  name: string;
  suits: MockupTemplate["suits"];
};
type LibraryOption = { id: string; name: string; role: string };

/** A template with no format restriction, or one that lists this kind. */
function templateFitsKind(
  template: Pick<TemplateOption, "suits">,
  kind: PosterKind,
): boolean {
  const formats = template.suits?.formats;
  return !formats || formats.length === 0 || formats.includes(kind);
}

export function NewBatchForm({
  inheritedPrices,
  inheritedCompare,
  inheritedSplitPrices,
  inheritedSplitCompare,
}: {
  inheritedPrices: Prices;
  inheritedCompare: PartialPriceTable;
  inheritedSplitPrices: PartialPriceTable;
  inheritedSplitCompare: PartialPriceTable;
}) {
  const router = useRouter();
  // null while loading — distinct from an empty list, which means Shopify has
  // no collections and the user needs to make one.
  const [categories, setCategories] = useState<Category[] | null>(null);
  // Either a collection handle or AUTO_CATEGORY. One piece of state rather
  // than a handle plus an "auto" flag, because the two are the same choice
  // and a pair could disagree.
  const [categoryId, setCategoryId] = useState<string>("");
  const [kind, setKind] = useState<PosterKind>("normal");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  // Templates the user has ticked or unticked by hand — kept out of the
  // auto-recompute that runs when the format changes.
  const [pinnedTemplates, setPinnedTemplates] = useState<Set<string>>(
    () => new Set(),
  );

  const [library, setLibrary] = useState<LibraryOption[] | null>(null);
  const [libraryIds, setLibraryIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/templates")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const list: TemplateOption[] = (body.templates ?? [])
          .filter((entry: { ok: boolean }) => entry.ok)
          .map((entry: { template: MockupTemplate }) => ({
            id: entry.template.id,
            name: entry.template.name,
            suits: entry.template.suits,
          }));
        setTemplates(list);
        setTemplateIds(
          list.filter((t) => templateFitsKind(t, "normal")).map((t) => t.id),
        );
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    void fetch("/api/library")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const list: LibraryOption[] = body.images ?? [];
        setLibrary(list);
        // Shared images are "attached to every product" by intent, so start
        // with all of them ticked.
        setLibraryIds(list.map((l) => l.id));
      })
      .catch(() => {
        if (!cancelled) setLibrary([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Changing the format re-picks the templates that suit it — but leaves
  // anything the user has toggled by hand exactly as they left it.
  function changeKind(next: PosterKind) {
    setKind(next);
    if (!templates) return;
    setTemplateIds((current) => {
      const chosen = new Set(current.filter((id) => pinnedTemplates.has(id)));
      for (const template of templates) {
        if (pinnedTemplates.has(template.id)) continue;
        if (templateFitsKind(template, next)) chosen.add(template.id);
      }
      return templates.filter((t) => chosen.has(t.id)).map((t) => t.id);
    });
  }

  function toggleTemplate(id: string) {
    setPinnedTemplates((current) => new Set(current).add(id));
    setTemplateIds((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    );
  }

  function toggleLibrary(id: string) {
    setLibraryIds((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    );
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/categories")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const list: Category[] = body.categories ?? [];
        setCategories(list);
        // Preselect the first, so the common case is one fewer click.
        if (list.length > 0) setCategoryId((current) => current || list[0].id);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const auto = categoryId === AUTO_CATEGORY;
  const selected = categories?.find((c) => c.id === categoryId) ?? null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const prices: Record<string, string> = {};
    const compareAt: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string") continue;
      if (key.startsWith("price.")) prices[key.slice(6)] = value;
      if (key.startsWith("compare.")) compareAt[key.slice(8)] = value;
    }

    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          categoryId,
          kind,
          prices,
          compareAt,
          templateIds,
          libraryIds,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not create the batch.");
        setPending(false);
        return;
      }
      router.push(`/batches/${body.batch.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-8">
      <Field
        label="Batch name"
        hint="For your reference only — never shown to customers."
      >
        <Input name="name" required placeholder="Marvel drop — March" />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-ink-700">Collection</legend>

        {categories === null ? (
          <p className="mt-2 text-xs text-ink-400">Loading collections…</p>
        ) : categories.length === 0 ? (
          <p className="mt-2 text-xs text-warn-700">
            No collections found in Shopify. Create one in the admin, then
            reload.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {/* First, and visually separated, because it is a different kind
                of answer from the ones after it: not "which collection" but
                "decide per poster". */}
            <button
              type="button"
              onClick={() => setCategoryId(AUTO_CATEGORY)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                auto
                  ? "border-accent-500 bg-accent-500 text-white"
                  : "border-dashed border-paper-400 bg-paper-200 text-ink-600 hover:border-accent-500"
              }`}
            >
              Auto
            </button>
            <span aria-hidden className="w-px self-stretch bg-paper-300" />
            {categories.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCategoryId(option.id)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  categoryId === option.id
                    ? "border-accent-500 bg-accent-500 text-white"
                    : "border-paper-300 bg-paper-200 text-ink-600 hover:border-paper-400"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {auto ? (
          <p className="mt-2 text-xs text-ink-500">
            Every poster is read individually and filed into all the
            collections it fits, with the best match as its{" "}
            <span className="text-ink-700">main</span> one — that is the
            collection whose name ends the title, and each of the others adds
            its tag so the product shows up there too. Shown per poster on the
            review screen, where you can change it before publishing.
          </p>
        ) : selected ? (
          <p className="mt-2 text-xs text-ink-500">
            Titles end{" "}
            <code className="rounded bg-paper-200 px-1 text-ink-700">
              | {selected.suffix}
            </code>
            {selected.tag ? (
              <>
                {" "}
                and the{" "}
                <code className="rounded bg-paper-200 px-1 text-ink-700">
                  {selected.tag}
                </code>{" "}
                tag is added, which is what puts the product in this collection.
              </>
            ) : (
              <>
                . This is a manual collection, so products are added to it
                directly rather than by tag.
              </>
            )}
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Format</legend>
        <div className="mt-2 space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name="kind"
              checked={kind === "normal"}
              onChange={() => changeKind("normal")}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium">Normal</span>
              <span className="block text-xs text-ink-500">
                One sheet per poster.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name="kind"
              checked={kind === "split3"}
              onChange={() => changeKind("split3")}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium">Split — 3 panels</span>
              <span className="block text-xs text-ink-500">
                One artwork across three sheets, sold as one product. The size
                chosen is the size of each panel.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-ink-700">Mockups</legend>
        <p className="mt-1 text-xs text-ink-400">
          Rendered for every poster in this batch. Ones suited to the format
          above are ticked to start — change any of them, or leave it and the
          mockup stage picks automatically.
        </p>
        {templates === null ? (
          <p className="mt-2 text-xs text-ink-400">Loading mockups…</p>
        ) : templates.length === 0 ? (
          <p className="mt-2 text-xs text-ink-400">
            No mockup templates yet. Add one under Mockups.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {templates.map((template) => {
              const on = templateIds.includes(template.id);
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => toggleTemplate(template.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    on
                      ? "border-accent-500 bg-accent-500 text-white"
                      : "border-paper-300 bg-paper-200 text-ink-600 hover:border-paper-400"
                  }`}
                >
                  {template.name}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-ink-700">
          Shared images
        </legend>
        <p className="mt-1 text-xs text-ink-400">
          Attached to every poster&rsquo;s gallery — size guides, quality
          panels. Manage the list under Images.
        </p>
        {library === null ? (
          <p className="mt-2 text-xs text-ink-400">Loading images…</p>
        ) : library.length === 0 ? (
          <p className="mt-2 text-xs text-ink-400">
            No shared images yet. Add some under Images.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {library.map((image) => {
              const on = libraryIds.includes(image.id);
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => toggleLibrary(image.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    on
                      ? "border-accent-500 bg-accent-500 text-white"
                      : "border-paper-300 bg-paper-200 text-ink-600 hover:border-paper-400"
                  }`}
                >
                  {image.name}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <div>
        <h2 className="text-sm font-medium">Prices for this batch</h2>
        <div className="mt-2">
          <PriceTable
            sizes={sizesFor(kind)}
            values={{}}
            compareValues={{}}
            inherited={kind === "split3" ? inheritedSplitPrices : inheritedPrices}
            inheritedCompare={
              kind === "split3" ? inheritedSplitCompare : inheritedCompare
            }
            emptyMeans="Leave blank to use the dashboard default shown in grey. Individual posters can still override these."
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create batch"}
        </Button>
        {error ? (
          <span className="text-sm text-danger-700">{error}</span>
        ) : null}
      </div>
    </form>
  );
}
