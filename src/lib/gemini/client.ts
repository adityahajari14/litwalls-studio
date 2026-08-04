import "server-only";

import sharp from "sharp";

import { err, ok, type Result } from "@/lib/result";

/**
 * The ONE place the Gemini wire format lives.
 *
 * Isolated deliberately. Google has already moved this API once — from
 * `generateContent` with `contents`/`parts`/`inline_data` to `interactions`
 * with `input` — and will move it again. Every caller goes through askGemini()
 * with a JSON schema, so the day the shape changes this is a one-file fix
 * rather than a grep across the pipeline.
 *
 * Returns a Result rather than throwing. A poster with no AI metadata is a
 * poster the human fills in by hand, not a dead batch.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Flash-Lite is ample for "identify this subject" and "find the subject". */
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

/**
 * Long edge to downscale to before sending.
 *
 * Never send a 5000px master: 1024px is plenty for both identification and
 * locating a subject, and it cuts token cost and latency by an order of
 * magnitude. Bounding boxes come back normalized, so shrinking the image
 * costs no precision in the coordinates.
 */
const MAX_EDGE = 1024;

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function model(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

/** Downscale and re-encode for the API. */
export async function prepareImage(
  source: string | Buffer,
): Promise<{ data: string; mimeType: string }> {
  const buffer = await sharp(source)
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
}

export type AskOptions<T> = {
  prompt: string;
  image?: { data: string; mimeType: string };
  /** JSON Schema describing the expected reply. */
  schema: Record<string, unknown>;
  /** Called with the parsed reply; return null to reject a malformed shape. */
  parse: (value: unknown) => T | null;
  signal?: AbortSignal;
};

type InteractionResponse = {
  output_text?: string;
  // Older/alternate shapes, tolerated so a rollback on Google's side does not
  // take the pipeline down with it.
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  text?: string;
};

/**
 * Ask Gemini for structured JSON.
 *
 * Retries once on 429 or 5xx with a short backoff, then gives up. No more than
 * that: a human is watching, and a batch that silently spends three minutes
 * retrying is worse than one that returns a fallback and says so.
 */
export async function askGemini<T>(options: AskOptions<T>): Promise<Result<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return err("GEMINI_API_KEY is not set");

  const input: unknown[] = [{ type: "text", text: options.prompt }];
  if (options.image) {
    input.push({
      type: "image",
      data: options.image.data,
      mime_type: options.image.mimeType,
    });
  }

  const body = JSON.stringify({
    model: model(),
    input,
    response_format: {
      type: "json_schema",
      json_schema: { name: "reply", schema: options.schema },
    },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(2000);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
        signal: options.signal,
        cache: "no-store",
      });
    } catch (cause) {
      if (attempt === 0) continue;
      return err(
        `Gemini request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === 0) continue;
      return err(`Gemini returned ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      // 4xx other than rate limiting is a request problem, so retrying the
      // identical request would only waste time. Include the body — this is
      // the message that will tell a human the wire format moved again.
      const detail = await response.text().catch(() => "");
      return err(
        `Gemini returned ${response.status} ${response.statusText}. ${detail.slice(0, 300)}`,
      );
    }

    let payload: InteractionResponse;
    try {
      payload = (await response.json()) as InteractionResponse;
    } catch {
      return err("Gemini returned a non-JSON body");
    }

    const text = extractText(payload);
    if (!text) return err("Gemini returned an empty reply");

    const parsed = parseJson(text);
    if (parsed === null) {
      return err(`Gemini reply was not valid JSON: ${text.slice(0, 200)}`);
    }

    const value = options.parse(parsed);
    if (value === null) {
      return err(`Gemini reply did not match the expected shape`);
    }

    return ok(value);
  }

  return err("Gemini request failed after a retry");
}

/**
 * Pull the model's text out of whichever response shape arrived.
 *
 * Tolerating more than one shape is deliberate: this is the part most likely
 * to change under us, and falling back costs nothing.
 */
function extractText(payload: InteractionResponse): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text;
  }
  const candidate = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

/**
 * Parse JSON, tolerating a fenced code block.
 *
 * Even with a schema, models sometimes wrap output in ```json fences. Stripping
 * them is two lines and removes a whole class of spurious failures.
 */
function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
