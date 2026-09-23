import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createBatch, createJob } from "../src/lib/pipeline/create.ts";
import {
  deleteBatch,
  listBatches,
  listJobs,
  readBatch,
  readJob,
  updateJob,
  writeBatch,
  writeJob,
} from "../src/lib/pipeline/store.ts";

/**
 * These tests write to the real workspace directory, then clean up after
 * themselves. That is deliberate: the atomic-write and per-job-lock behaviour
 * is about actual filesystem semantics, and a mocked fs would test the mock.
 */
const created: string[] = [];

function makeBatch(
  extra: Partial<Parameters<typeof createBatch>[0]> = {},
) {
  const batch = createBatch({
    name: "Test batch",
    category: {
      id: "marvel",
      label: "Marvel",
      suffix: "Marvel Posters",
      tag: "Marvel",
      collectionId: "gid://shopify/Collection/1",
      smart: true,
    },
    kind: "normal",
    ...extra,
  });
  created.push(batch.id);
  return batch;
}

/**
 * Remove ONLY the batches these tests created.
 *
 * An earlier version deleted the whole `batches/` directory, which wiped real
 * work when the suite was run mid-session. Tests share the developer's actual
 * workspace, so cleanup has to be surgical.
 */
after(async () => {
  for (const id of created) {
    await deleteBatch(id).catch(() => undefined);
  }
});

test("a batch round-trips through disk", async () => {
  const batch = makeBatch();
  await writeBatch(batch);

  const back = await readBatch(batch.id);
  assert.ok(back);
  assert.equal(back.name, "Test batch");
  // The whole snapshot, not just the handle: carrying the label, suffix and
  // tag is what lets a batch published months later still title its products
  // the way it was set up to.
  assert.deepEqual(back.category, batch.category);
});

test("a batch round-trips its default mockup and image lists", async () => {
  const batch = makeBatch({
    defaultTemplateIds: ["mockup-1", "mockup-2"],
    defaultLibraryIds: ["size-guide.png"],
  });
  await writeBatch(batch);

  const back = await readBatch(batch.id);
  assert.ok(back);
  assert.deepEqual(back.defaultTemplateIds, ["mockup-1", "mockup-2"]);
  assert.deepEqual(back.defaultLibraryIds, ["size-guide.png"]);
});

test("a job inherits the batch's default mockup selection", async () => {
  const batch = makeBatch({ defaultTemplateIds: ["mockup-1"] });
  await writeBatch(batch);

  const job = createJob({
    batch,
    sourceName: "Spider Man.jpg",
    sourceRelPath: "original.jpg",
  });
  assert.deepEqual(job.selectedTemplateIds, ["mockup-1"]);
  // No default library images on this batch, so the gallery starts empty.
  assert.deepEqual(job.images, []);
});

test("reading a missing batch returns null rather than throwing", async () => {
  assert.equal(await readBatch("does-not-exist"), null);
  assert.equal(await readJob("does-not-exist", "nope"), null);
  assert.deepEqual(await listJobs("does-not-exist"), []);
});

test("a job round-trips and is listed under its batch", async () => {
  const batch = makeBatch();
  await writeBatch(batch);

  const job = createJob({
    batch,
    sourceName: "Spider Man.jpg",
    sourceRelPath: "original.jpg",
  });
  await writeJob(job);

  const jobs = await listJobs(batch.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sourceName, "Spider Man.jpg");
  assert.equal(jobs[0].stage, "ingested");
  // Inherited from the batch, but stored on the job so a later batch edit
  // cannot reinterpret posters already rendered.
  assert.equal(jobs[0].kind, "normal");
});

test("concurrent updates to one job do not lose writes", async () => {
  const batch = makeBatch();
  await writeBatch(batch);
  const job = createJob({
    batch,
    sourceName: "x.jpg",
    sourceRelPath: "original.jpg",
  });
  await writeJob(job);

  // THE case the per-job lock exists for. Without serialisation these all read
  // the same starting state and the last write wins, losing 19 of 20 tags.
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      updateJob(batch.id, job.id, (current) => ({
        ...current,
        selectedTemplateIds: [...current.selectedTemplateIds, `t${i}`],
      })),
    ),
  );

  const final = await readJob(batch.id, job.id);
  assert.ok(final);
  assert.equal(
    final.selectedTemplateIds.length,
    20,
    "a concurrent update was lost",
  );
  assert.equal(
    new Set(final.selectedTemplateIds).size,
    20,
    "an update was applied twice",
  );
});

test("a failed update does not poison later updates to the same job", async () => {
  const batch = makeBatch();
  await writeBatch(batch);
  const job = createJob({
    batch,
    sourceName: "y.jpg",
    sourceRelPath: "original.jpg",
  });
  await writeJob(job);

  await assert.rejects(
    updateJob(batch.id, job.id, () => {
      throw new Error("stage blew up");
    }),
    /stage blew up/,
  );

  // The queue must survive: one failed stage cannot wedge the job forever.
  const after = await updateJob(batch.id, job.id, (current) => ({
    ...current,
    stage: "probed",
  }));
  assert.equal(after.stage, "probed");
});

test("updating a missing job rejects rather than creating one", async () => {
  const batch = makeBatch();
  await writeBatch(batch);
  await assert.rejects(
    updateJob(batch.id, "ghost", (job) => job),
    /Job not found/,
  );
});

test("batches list newest first", async () => {
  const older = makeBatch();
  await writeBatch({ ...older, createdAt: 1_000 });
  const newer = makeBatch();
  await writeBatch({ ...newer, createdAt: 2_000 });

  const batches = await listBatches();
  const positions = [
    batches.findIndex((b) => b.id === newer.id),
    batches.findIndex((b) => b.id === older.id),
  ];
  assert.ok(positions[0] !== -1 && positions[1] !== -1);
  assert.ok(positions[0] < positions[1], "newest batch should sort first");
});

test("deleting a batch removes its jobs too", async () => {
  const batch = makeBatch();
  await writeBatch(batch);
  const job = createJob({
    batch,
    sourceName: "z.jpg",
    sourceRelPath: "original.jpg",
  });
  await writeJob(job);

  await deleteBatch(batch.id);

  assert.equal(await readBatch(batch.id), null);
  assert.deepEqual(await listJobs(batch.id), []);
});
