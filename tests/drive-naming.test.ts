import assert from "node:assert/strict";
import { test } from "node:test";

import { driveFolderUrl, posterFolderName } from "../src/lib/drive/naming.ts";
import { driveComplete, driveLinkPending, type PosterJob } from "../src/lib/print/types.ts";

/**
 * Every poster gets its own Drive folder, named so it can be found from a
 * Shopify order, and every product carries a link to that folder.
 */

test("a published poster's folder is its product title without the suffix", () => {
  assert.equal(
    posterFolderName({ subject: "Spider Man", sequence: 6, jobId: "abc" }),
    "Spider Man #06",
  );
  assert.equal(
    posterFolderName({ subject: "The Weeknd", subtitle: "Star Boy", sequence: 2, jobId: "abc" }),
    "The Weeknd #02 - Star Boy",
  );
});

test("two numbers of one subject never share a folder name", () => {
  const first = posterFolderName({ subject: "Ferrari F1", sequence: 1, jobId: "a" });
  const second = posterFolderName({ subject: "Ferrari F1", sequence: 2, jobId: "b" });
  assert.notEqual(first, second);
});

test("an unpublished poster is not given a guessed #01", () => {
  const a = posterFolderName({ subject: "Ferrari F1", sequence: null, jobId: "job-aaaa1111" });
  const b = posterFolderName({ subject: "Ferrari F1", sequence: undefined, jobId: "job-bbbb2222" });
  assert.doesNotMatch(a, /#\d/);
  assert.match(a, /unpublished/);
  assert.notEqual(a, b);
});

test("characters Drive and Windows reject are stripped", () => {
  assert.equal(
    posterFolderName({ subject: 'AC/DC: "Live"', sequence: 3, jobId: "x" }),
    "AC DC Live #03",
  );
});

test("the link is a Drive folder URL", () => {
  assert.equal(driveFolderUrl("1AbC"), "https://drive.google.com/drive/folders/1AbC");
});

const filed = {
  sourceRelPath: "source/original.jpg",
  assets: [{ relPath: "sizes/A3.jpg" }] as PosterJob["assets"],
  drive: {
    folderId: "folder-1",
    files: { "source/original.jpg": "f0", "sizes/A3.png": "f1" },
  },
};
const product = { productId: "gid://shopify/Product/1" } as PosterJob["shopify"];

test("a published, filed poster with no link still needs linking", () => {
  const job = { ...filed, shopify: product, driveLinkedFolderId: null };
  assert.equal(driveLinkPending(job), true);
  assert.equal(driveComplete(job), false);
});

test("linked to its current folder is complete", () => {
  const job = { ...filed, shopify: product, driveLinkedFolderId: "folder-1" };
  assert.equal(driveLinkPending(job), false);
  assert.equal(driveComplete(job), true);
});

test("moved to a new folder, the link must be rewritten", () => {
  const job = { ...filed, shopify: product, driveLinkedFolderId: "old-shared-folder" };
  assert.equal(driveLinkPending(job), true);
});

test("an unpublished poster has nothing to link", () => {
  const job = { ...filed, shopify: null, driveLinkedFolderId: null };
  assert.equal(driveLinkPending(job), false);
  assert.equal(driveComplete(job), true);
});
