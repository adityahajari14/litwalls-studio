import assert from "node:assert/strict";
import { test } from "node:test";

import { hasReached, STAGE_ORDER, stageIndex } from "../src/lib/print/types.ts";

/**
 * Stage ordering is what makes the pipeline resumable AND what stops finished
 * work being redone. A bug here is expensive: re-running an approved job
 * silently discards a human's crop edits.
 */

test("stages are ordered and unique", () => {
  assert.equal(new Set(STAGE_ORDER).size, STAGE_ORDER.length);
  for (let i = 1; i < STAGE_ORDER.length; i++) {
    assert.ok(stageIndex(STAGE_ORDER[i]) > stageIndex(STAGE_ORDER[i - 1]));
  }
});

test("approved is PAST mocked", () => {
  // The exact assumption an earlier version of the run route got wrong. It
  // tested `stage !== "mocked"`, which treated an approved job as unfinished
  // and re-ran the whole pipeline over it, throwing away the review.
  assert.ok(hasReached("approved", "mocked"));
  assert.ok(hasReached("published", "mocked"));
  assert.ok(!hasReached("cropped", "mocked"));
});

test("hasReached is inclusive of the stage itself", () => {
  assert.ok(hasReached("mocked", "mocked"));
  assert.ok(hasReached("probed", "ingested"));
  assert.ok(!hasReached("ingested", "probed"));
});

test("every stage past the automatic end counts as finished", () => {
  // Whatever stages exist after "mocked", none of them should be re-run by a
  // batch-level "process all".
  const automaticEnd = stageIndex("mocked");
  for (const stage of STAGE_ORDER.slice(automaticEnd)) {
    assert.ok(
      hasReached(stage, "mocked"),
      `${stage} should count as having reached mocked`,
    );
  }
});
