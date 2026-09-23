import { SettingsForm } from "@/app/settings/settings-form";
import { PageHeader, Section } from "@/components/ui";
import { DEFAULT_DESCRIPTION_TEMPLATE } from "@/lib/print/description";
import {
  FALLBACK_COMPARE_AT,
  FALLBACK_PRICES,
  FALLBACK_SPLIT_COMPARE_AT,
  FALLBACK_SPLIT_PRICES,
} from "@/lib/print/pricing";
import { readSettings } from "@/lib/pipeline/settings";

export const metadata = { title: "Settings · Litwalls Studio" };

export default async function SettingsPage() {
  const settings = await readSettings();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <PageHeader
        title="Settings"
        meta="Defaults for every new product. A batch can override these at upload, and a single poster can override its batch."
      />

      {/* One Section, because it is one form with one submit — the headings
          inside separate prices from the mockup border. */}
      <Section title="Defaults" className="mt-8">
        <SettingsForm
          prices={settings.prices}
          compareAt={settings.compareAt}
          splitPrices={settings.splitPrices}
          splitCompareAt={settings.splitCompareAt}
          fallbackPrices={FALLBACK_PRICES}
          fallbackCompare={FALLBACK_COMPARE_AT}
          fallbackSplitPrices={FALLBACK_SPLIT_PRICES}
          fallbackSplitCompare={FALLBACK_SPLIT_COMPARE_AT}
          saved={settings.updatedAt > 0}
          border={settings.mockupBorder}
          splitGap={settings.splitGap}
          descriptionTemplate={settings.descriptionTemplate}
          defaultDescriptionTemplate={DEFAULT_DESCRIPTION_TEMPLATE}
        />
      </Section>
    </main>
  );
}
