import { notFound } from "next/navigation";

import { TemplateEditor } from "@/app/templates/[templateId]/template-editor";
import { readSettings } from "@/lib/pipeline/settings";
import { loadTemplate } from "@/lib/templates/load";
import { isTemplateProcessing } from "@/lib/templates/processing";

export default async function TemplateEditPage(
  props: PageProps<"/templates/[templateId]">,
) {
  const { templateId } = await props.params;
  const [entry, settings, processing] = await Promise.all([
    loadTemplate(templateId),
    readSettings(),
    isTemplateProcessing(templateId),
  ]);

  // A folder with a background but no valid template.json is the normal state
  // right after upload — the editor is exactly what fixes that, so it must not
  // 404 here.
  if (!entry.ok && !entry.hasBackground) notFound();

  return (
    <TemplateEditor
      templateId={templateId}
      initial={entry.ok ? entry.template : null}
      errors={entry.ok ? [] : entry.errors}
      defaultGap={settings.splitGap}
      initialProcessing={processing}
    />
  );
}
