import "server-only";

import { askGemini, geminiConfigured, prepareImage } from "@/lib/gemini/client";
import {
  isUsableSubject,
  normalizeSpacing,
  stripOfficial,
  subjectFromFilename,
} from "@/lib/print/title";
import type { AiMetadata, Category, PosterKind } from "@/lib/print/types";
import { err, type Result } from "@/lib/result";

/**
 * Identify what a poster depicts, and write its description.
 *
 * Gemini returns a subject, an optional subtitle, tags, alt text, and a
 * short description paragraph — one call, since it already has the image
 * loaded for the rest of this. It does not assemble the title or choose the
 * number — formatTitle and the Numberer do those, from live catalogue data —
 * and it does not write the policy block (border, adhesive, colour) that
 * `print/description.ts` appends after this paragraph: that part is store
 * policy, identical on every product, and lives in Settings instead.
 */

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    subtitle: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    altText: { type: "string" },
    description: { type: "string" },
    collections: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "tags", "altText", "description"],
} as const;

const TITLE_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    subtitle: { type: ["string", "null"] },
  },
  required: ["subject"],
} as const;

const DESCRIPTION_SCHEMA = {
  type: "object",
  properties: { description: { type: "string" } },
  required: ["description"],
} as const;

type RawMetadata = {
  subject: string;
  subtitle: string | null;
  tags: string[];
  altText: string;
  description: string;
  /**
   * Suggested collection handles, MOST RELEVANT FIRST. Empty when the model
   * is unsure or was not offered a list.
   */
  collections: string[];
};

/** Longest description paragraph accepted, in characters. */
const MAX_DESCRIPTION = 600;

/**
 * Litwalls does not sell licensed merchandise, so calling a poster official
 * would be a false claim. Stated in every prompt that writes text; the same
 * word is also stripped from whatever comes back (see `stripOfficial`).
 */
const NO_OFFICIAL_RULE =
  'In EVERY field, never use the word "official" (or "officially") — we do not ' +
  "sell licensed or official merchandise, so do not imply it.";

/** The subject and subtitle instructions, shared by the full catalogue call and the title-only regeneration. */
const SUBJECT_RULES: string[] = [
    '- "subject": the character, artist, band, team or vehicle depicted. Two',
    "  to four words, written out in full. A model or edition number that is",
    '  part of the real name STAYS IN — "Ferrari F1", "GT3 RS", "Blink-182" —',
    "  never trim one of those down to a bare letter or a symbol. What you",
    "  must NOT do is invent a catalogue number of your own, or include the",
    "  word Poster or the collection name; those are added separately.",
    "  Examples of the house style: \"Spider Man\", \"The Weeknd\", \"Blackpink\",",
    '  "Ferrari F1".',
    "  Use only letters, numbers, spaces, apostrophes, hyphens, ampersands",
    "  and slashes — no other punctuation or symbols, even if unsure exactly",
    "  what a small detail in the artwork says.",
    "",
    '- "subtitle": ONLY if the poster clearly depicts a specific named album,',
    "  tour or storyline (e.g. \"Star Boy\", \"After Hours\"). Otherwise null.",
    "  Prefer null — most posters do not have one, and a spurious subtitle",
    "  splits a subject's numbering in two. Same character rule as subject.",
    "",
];

/** The description instructions, shared by the full catalogue call and the description-only regeneration. */
function descriptionRules(format: string): string[] {
  return [
      '- "description": the opening paragraph of the product page. Two to',
      "  four plain sentences, written fresh for this poster — do not reuse",
      "  stock phrasing you'd use for a different one. Name the subject, then",
      "  work in the print quality (thick matte paper, sharp detail,",
      `  fade-resistant) and where it suits a room. State plainly that this`,
      `  poster is ${format} — always include that, in your own words, never`,
      "  leave it out. Tone: simple and professional, like a retail listing,",
      "  not a hype ad. No headings, no bullet points, no markdown, no quotes.",
      `  At most ${MAX_DESCRIPTION} characters.`,
      "",
  ];
}

function buildPrompt(options: {
  /** Null on an auto batch: the model is choosing, so naming an answer up
   *  front would only anchor it. */
  category: Pick<Category, "label"> | null;
  kind: PosterKind;
  knownSubjects: string[];
  knownTags: string[];
  collections: { id: string; label: string }[];
}): string {
  const { category, kind, knownSubjects, knownTags } = options;
  const format =
    kind === "split3" ? "a three-panel split set" : "a single sheet";

  return [
    category
      ? `You are cataloguing a poster for Litwalls, a poster shop. This poster belongs to the ${category.label} collection.`
      : "You are cataloguing a poster for Litwalls, a poster shop. Nobody has filed it yet, so you are choosing which collections it belongs in.",
    "",
    "Identify the poster and return JSON with these fields:",
    "",
    NO_OFFICIAL_RULE,
    "",
    ...SUBJECT_RULES,
    '- "tags": 3 to 6 tags in Title Case.',
    '- "altText": one plain descriptive sentence, at most 125 characters.',
    "",
    // Free text rather than a filled-in template, so 500 products don't read
    // as the same paragraph with a name swapped in. Each call gets its own
    // wording — that's the point of asking the model instead of templating.
    ...descriptionRules(format),
    // The batch picks a collection, but a batch is often mixed — a Marvel drop
    // that contains a Star Wars poster. Asking per poster catches the one that
    // was filed in the wrong place, which is otherwise only noticed when it
    // fails to appear in the collection a customer is browsing.
    options.collections.length > 0
      ? [
          '- "collections": every one of these the poster genuinely belongs',
          "  in, by handle, MOST RELEVANT FIRST. The first is the MAIN",
          "  collection and its name goes in the product title, so lead with",
          "  the one a shopper would most expect to find this under. Include",
          "  the others only where someone browsing them would reasonably",
          "  expect to see this poster: a Spider-Man belongs in Marvel and in",
          "  Movies & TV, but not in Music. Two to four is typical. Reply with",
          "  an empty array if none of them fit:",
          options.collections
            .map((c) => `    ${c.id} — ${c.label}`)
            .join("\n"),
          "",
        ].join("\n")
      : "",
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

  // Rejecting rather than trying to salvage a bad subject: this is what stops
  // a hallucinated symbol — "Ferrari F!" instead of "Ferrari F1" — from ever
  // reaching a title. Failing the parse sends the caller to fallbackMetadata,
  // which derives a plain, known-clean subject from the filename instead, and
  // flags the job for a human to fix rather than shipping the garbled one.
  const subject =
    typeof raw.subject === "string"
      ? normalizeSpacing(stripOfficial(raw.subject))
      : "";
  if (!isUsableSubject(subject)) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => stripOfficial(t))
        .filter((t) => t !== "")
    : [];

  const subtitle =
    typeof raw.subtitle === "string"
      ? normalizeSpacing(stripOfficial(raw.subtitle))
      : "";

  return {
    subject,
    subtitle: subtitle && isUsableSubject(subtitle) ? subtitle : null,
    tags: tags.map((t) => t.trim()).slice(0, 8),
    altText:
      typeof raw.altText === "string"
        ? stripOfficial(raw.altText).slice(0, 125)
        : "",
    description:
      typeof raw.description === "string"
        ? stripOfficial(raw.description).slice(0, MAX_DESCRIPTION)
        : "",
    // Tolerates the older single-string shape as well as the array, so a
    // response from a model that ignored the schema still lands somewhere
    // useful rather than being dropped whole.
    collections: Array.isArray(raw.collections)
      ? raw.collections
          .filter((c): c is string => typeof c === "string" && c.trim() !== "")
          .map((c) => c.trim())
          .slice(0, 6)
      : typeof raw.collection === "string" && raw.collection.trim()
        ? [raw.collection.trim()]
        : [],
  };
}

/**
 * The neutral result when Gemini is unavailable or unhelpful.
 *
 * A filename-derived subject is a genuinely decent starting point — poster
 * files are usually named after what they depict — and it is one edit away
 * from correct. Badged as "fallback" so the review UI can say so.
 *
 * `description` is left blank rather than templated here: `descriptionFor`
 * builds a plain fallback line from `subject` when it finds one empty, and
 * duplicating that logic here would just be a second place for it to drift.
 */
export function fallbackMetadata(sourceName: string): AiMetadata {
  return {
    subject: subjectFromFilename(sourceName),
    subtitle: null,
    sequence: null,
    tags: [],
    altText: "",
    description: "",
    source: "fallback",
  };
}

export async function describePoster(options: {
  image: string | Buffer;
  sourceName: string;
  /** Null on an auto batch. See `buildPrompt`. */
  category: Pick<Category, "label"> | null;
  kind: PosterKind;
  knownSubjects: string[];
  knownTags: string[];
  collections?: { id: string; label: string }[];
}): Promise<AiMetadata> {
  if (!geminiConfigured()) return fallbackMetadata(options.sourceName);

  try {
    const image = await prepareImage(options.image);
    const result = await askGemini<RawMetadata>({
      prompt: buildPrompt({ ...options, collections: options.collections ?? [] }),
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
      description: result.value.description,
      suggestedCategoryId: result.value.collections[0] ?? null,
      suggestedCategoryIds: result.value.collections,
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

/**
 * Write a new title for a poster — its subject and optional subtitle — without
 * touching anything else about it.
 *
 * The number and collection suffix are not the model's to choose (see the top
 * of this file), so this regenerates only the two parts it owns. The prompt
 * deliberately does not show the old subject: a fresh look is the point, and
 * naming the previous answer would only anchor the model to it.
 */
export async function regenerateTitle(options: {
  image: string | Buffer;
  category: Pick<Category, "label"> | null;
  knownSubjects: string[];
}): Promise<Result<{ subject: string; subtitle: string | null }>> {
  if (!geminiConfigured()) return err("GEMINI_API_KEY is not set");

  const prompt = [
    options.category
      ? `You are cataloguing a poster for Litwalls, a poster shop. This poster belongs to the ${options.category.label} collection.`
      : "You are cataloguing a poster for Litwalls, a poster shop.",
    "",
    "Identify the poster and return JSON with these fields:",
    "",
    NO_OFFICIAL_RULE,
    "",
    ...SUBJECT_RULES,
    options.knownSubjects.length > 0
      ? [
          "",
          "These subjects already exist in this collection. If this poster shows",
          "one of them, reply with the EXACT string as written here:",
          options.knownSubjects.slice(0, 80).map((s) => `  ${s}`).join("\n"),
        ].join("\n")
      : "",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  return askGemini({
    prompt,
    image: await prepareImage(options.image),
    schema: TITLE_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => {
      const parsed = parse({ ...(value as object), tags: [], altText: "", description: "" });
      return parsed ? { subject: parsed.subject, subtitle: parsed.subtitle } : null;
    },
  });
}

/**
 * Write a new description paragraph for a poster, leaving everything else as
 * it is.
 *
 * Given the subject the poster is ALREADY filed under so the paragraph names
 * what the title says, and the previous paragraph so the new one reads
 * differently — asking again for the same text would make the button pointless.
 */
export async function regenerateDescription(options: {
  image: string | Buffer;
  kind: PosterKind;
  subject: string;
  previous: string;
}): Promise<Result<string>> {
  if (!geminiConfigured()) return err("GEMINI_API_KEY is not set");

  const format =
    options.kind === "split3" ? "a three-panel split set" : "a single sheet";

  const prompt = [
    `You are writing product copy for Litwalls, a poster shop. This poster is "${options.subject}".`,
    "",
    "Return JSON with one field:",
    "",
    NO_OFFICIAL_RULE,
    "",
    ...descriptionRules(format),
    options.previous.trim()
      ? [
          "",
          "An earlier version of this paragraph is below. Write a new one that",
          "reads clearly differently — new wording and sentence structure — and",
          "does not copy it:",
          `  ${options.previous.trim()}`,
        ].join("\n")
      : "",
  ].join("\n");

  return askGemini({
    prompt,
    image: await prepareImage(options.image),
    schema: DESCRIPTION_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => {
      const text = (value as { description?: unknown } | null)?.description;
      if (typeof text !== "string") return null;
      const cleaned = stripOfficial(text).slice(0, MAX_DESCRIPTION);
      return cleaned ? cleaned : null;
    },
  });
}
