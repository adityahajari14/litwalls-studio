import { SettingsForm } from "@/app/settings/settings-form";
import { PageHeader, Section } from "@/components/ui";
import { FALLBACK_COMPARE_AT, FALLBACK_PRICES } from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";

export const metadata = { title: "Settings · Litwalls Studio" };

export default async function SettingsPage() {
  const settings = await readSettings();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <PageHeader
        title="Settings"
        meta="Default prices for every new product. A batch can override these at upload, and a single poster can override its batch."
      />

      <Section title="Default prices" className="mt-8">
        <SettingsForm
          prices={settings.prices}
          compareAt={settings.compareAt}
          fallbackPrices={FALLBACK_PRICES}
          fallbackCompare={FALLBACK_COMPARE_AT}
          saved={settings.updatedAt > 0}
        />
      </Section>
    </main>
  );
}
