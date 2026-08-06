import assert from "node:assert/strict";
import { test } from "node:test";

import { extractText } from "../src/lib/gemini/client.ts";

/**
 * The reply shape is the part of this integration most likely to move — Google
 * has already changed it once. These tests pin what the live API actually
 * returns, verified by calling it.
 */

test("reads text from the live steps shape", () => {
  // What the API really sends. An earlier version looked only at
  // `output_text`, found nothing, and reported "empty reply" for every call.
  const payload = {
    id: "v1_abc",
    status: "completed",
    steps: [
      { type: "thought", signature: "opaque" },
      { type: "message", content: [{ type: "text", text: '{"ok": true}' }] },
    ],
  };
  assert.equal(extractText(payload), '{"ok": true}');
});

test("skips thought steps rather than treating them as empty content", () => {
  // Thought steps carry a signature and no content array at all. Iterating
  // them without a guard is how the extraction returned "" for a good reply.
  const payload = {
    steps: [
      { type: "thought", signature: "x" },
      { type: "thought", signature: "y" },
      { type: "message", content: [{ type: "text", text: "answer" }] },
    ],
  };
  assert.equal(extractText(payload), "answer");
});

test("joins text split across content chunks", () => {
  const payload = {
    steps: [
      {
        type: "message",
        content: [
          { type: "text", text: '{"subject":' },
          { type: "text", text: '"Loki"}' },
        ],
      },
    ],
  };
  assert.equal(extractText(payload), '{"subject":"Loki"}');
});

test("still honours output_text if the API returns to it", () => {
  assert.equal(extractText({ output_text: "hello" }), "hello");
});

test("still honours the older candidates shape", () => {
  assert.equal(
    extractText({ candidates: [{ content: { parts: [{ text: "legacy" }] } }] }),
    "legacy",
  );
});

test("returns null when there is genuinely nothing", () => {
  assert.equal(extractText({}), null);
  assert.equal(extractText({ steps: [] }), null);
  assert.equal(extractText({ steps: [{ type: "thought" }] }), null);
  assert.equal(extractText({ output_text: "   " }), null);
});
