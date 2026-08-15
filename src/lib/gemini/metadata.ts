import "server-only";

import { askGemini, geminiConfigured, prepareImage } from "@/lib/gemini/client";
import { subjectFromFilename } from "@/lib/print/title";
import type { AiMetadata, Category } from "@/lib/print/types";

/**
 * Identify what a poster depicts.
 *
 * The job here is IDENTIFICATION, not copywriting. Gemini returns a subject,
 * an optional subtitle, tags and alt text. It does not write descriptions
 * (every product shares one static template) and it does not assemble the
 * title or choose the number — formatTitle and the Numberer do those, from
 * live catalogue data.
 */

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    subtitle: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    altText: { type: "string" },
  },
  required: ["subject", "tags", "altText"],
} as const;

type RawMetadata = {
  subject: string;
  subtitle: string | null;
  tags: string[];
  altText: string;
};

function buildPrompt(options: {
  category: Pick<Category, "label">;
  knownSubjects: string[];
  knownTags: string[];
}): string {
  const { category, knownSubjects, knownTags } = options;

  return [
    `You are cataloguing a poster for Litwalls, a poster shop. This poster belongs to the ${category.label} collection.`,
    "",
    "Identify the poster and return JSON with these fields:",
    "",
    '- "subject": the character, artist, band or film depicted. Two to four words.',
    "  Examples of the house style: \"Spider Man\", \"The Weeknd\", \"Blackpink\".",
    "  Do NOT include the word Poster, the collection name, or any number.",
    "",
    '- "subtitle": ONLY if the poster clearly depicts a specific named album,',
    "  tour or storyline (e.g. \"Star Boy\", \"After Hours\"). Otherwise null.",
    "  Prefer null — most posters do not have one, and a spurious subtitle",
    "  splits a subject's numbering in two.",
    "",
    '- "tags": 3 to 6 tags in Title Case.',
    '- "altText": one plain descriptive sentence, at most 125 characters.',
    "",
    // Reusing the exact existing spelling is what stops "Spider Man" becoming
    // "Spiderman" on poster 155 and starting a second numbering sequence.
    knownSubjects.length > 0
      ? [
          "These subjects already exist in this collection. If this poster shows",
          "one of them, reply with the EXACT string as written here:",
          knownSubjects.slice(0, 80).map((s) => `  ${s}`).join("\n"),
          "",
        ].join("\n")
      : "",
    // The tag cloud already contains Weeknd/weekend/Weekend and Rose/Rosé.
    // Free-form tagging would compound that permanently.
    knownTags.length > 0
      ? [
          "Choose tags from this existing vocabulary wherever one fits. Invent",
          "at most one new tag, and only if nothing here applies:",
          knownTags.slice(0, 120).join(", "),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parse(value: unknown): RawMetadata | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (!subject) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "")
    : [];

  return {
    subject,
    subtitle:
      typeof raw.subtitle === "string" && raw.subtitle.trim()
        ? raw.subtitle.trim()
        : null,
    tags: tags.map((t) => t.trim()).slice(0, 8),
    altText: typeof raw.altText === "string" ? raw.altText.trim().slice(0, 125) : "",
  };
}

/**
 * The neutral result when Gemini is unavailable or unhelpful.
 *
 * A filename-derived subject is a genuinely decent starting point — poster
 * files are usually named after what they depict — and it is one edit away
 * from correct. Badged as "fallback" so the review UI can say so.
 */
export function fallbackMetadata(sourceName: string): AiMetadata {
  return {
    subject: subjectFromFilename(sourceName),
    subtitle: null,
    sequence: null,
    tags: [],
    altText: "",
    source: "fallback",
  };
}

export async function describePoster(options: {
  image: string | Buffer;
  sourceName: string;
  category: Pick<Category, "label">;
  knownSubjects: string[];
  knownTags: string[];
}): Promise<AiMetadata> {
  if (!geminiConfigured()) return fallbackMetadata(options.sourceName);

  try {
    const image = await prepareImage(options.image);
    const result = await askGemini<RawMetadata>({
      prompt: buildPrompt(options),
      image,
      schema: SCHEMA as unknown as Record<string, unknown>,
      parse,
    });

    if (!result.ok) {
      console.warn(`gemini metadata (${options.sourceName}): ${result.error}`);
      return fallbackMetadata(options.sourceName);
    }

    return {
      subject: result.value.subject,
      subtitle: result.value.subtitle,
      sequence: null, // assigned at publish time, from the live catalogue
      tags: result.value.tags,
      altText: result.value.altText,
      source: "gemini",
    };
  } catch (cause) {
    // Never let an unexpected throw kill a batch — the whole point of the
    // fallback is that a human approves every product anyway.
    console.warn(
      `gemini metadata (${options.sourceName}) threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return fallbackMetadata(options.sourceName);
  }
}
