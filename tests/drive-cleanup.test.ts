import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planCleanup,
  type DriveFileEntry,
  type DriveFolderEntry,
} from "../src/lib/drive/cleanup-plan.ts";

/**
 * The cleanup moves folders to the Drive trash, so what matters most here is
 * what it must NOT touch.
 */

const ROOT = "root";
const folder = (
  id: string,
  parent: string,
  productTag: string | null = null,
): DriveFolderEntry => ({ id, name: id, parents: [parent], productTag });
const file = (id: string, name: string, parent: string, md5: string | null): DriveFileEntry => ({
  id,
  name,
  parents: [parent],
  md5,
});

// Root → Cars → an old shared "#01" folder, plus two new per-poster folders.
const folders = [
  folder("cars", ROOT),
  folder("shared-01", "cars"),
  folder("ferrari-01", "cars", "gid://shopify/Product/1"),
  folder("ferrari-02", "cars", "gid://shopify/Product/2"),
];
const refiled = [
  file("o1", "original.jpg", "shared-01", "aaa"),
  file("o2", "original.jpg", "shared-01", "bbb"),
  file("p1", "A3.png", "shared-01", "old-render"),
  file("n1", "original.jpg", "ferrari-01", "aaa"),
  file("n2", "original.jpg", "ferrari-02", "bbb"),
];

test("an untagged, unreferenced folder whose originals are safe elsewhere goes", () => {
  const plan = planCleanup({ rootId: ROOT, folders, files: refiled, referenced: new Set() });
  assert.deepEqual(
    plan.remove.map((f) => f.id),
    ["shared-01"],
  );
  assert.equal(plan.remove[0].collection, "cars");
  assert.equal(plan.remove[0].files, 3);
});

test("print files that differ from the new render do not hold a folder back", () => {
  // A3.png's hash matches nothing — it is re-rendered from the original.
  const plan = planCleanup({ rootId: ROOT, folders, files: refiled, referenced: new Set() });
  assert.equal(plan.keep.length, 0);
});

test("an original with no copy elsewhere keeps the folder", () => {
  const files = [...refiled, file("o3", "original.png", "shared-01", "ccc")];
  const plan = planCleanup({ rootId: ROOT, folders, files, referenced: new Set() });
  assert.equal(plan.remove.length, 0);
  assert.match(plan.keep[0].reason, /original\.png/);
});

test("a folder a poster still points at is never a candidate", () => {
  const plan = planCleanup({
    rootId: ROOT,
    folders,
    files: refiled,
    referenced: new Set(["shared-01"]),
  });
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.keep.length, 0);
});

test("tagged folders, collection folders and the root are never touched", () => {
  const plan = planCleanup({
    rootId: ROOT,
    folders: [...folders, folder("empty-tagged", "cars", "job:b/j")],
    files: [],
    referenced: new Set(),
  });
  const ids = plan.remove.map((f) => f.id);
  assert.ok(!ids.includes("cars"));
  assert.ok(!ids.includes("ferrari-01"));
  assert.ok(!ids.includes("empty-tagged"));
  assert.deepEqual(ids, ["shared-01"]); // empty and untagged: nothing to lose
});

test("a folder with subfolders was made by a person and is kept", () => {
  const plan = planCleanup({
    rootId: ROOT,
    folders: [...folders, folder("inside", "shared-01")],
    files: refiled,
    referenced: new Set(),
  });
  assert.equal(plan.remove.length, 0);
  assert.match(plan.keep[0].reason, /subfolders/);
});

test("an original's copy only counts if it is in a folder that stays", () => {
  // Two legacy folders holding the same original: neither copy is safe.
  const plan = planCleanup({
    rootId: ROOT,
    folders: [folder("cars", ROOT), folder("old-a", "cars"), folder("old-b", "cars")],
    files: [
      file("x", "original.jpg", "old-a", "same"),
      file("y", "original.jpg", "old-b", "same"),
    ],
    referenced: new Set(),
  });
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.keep.length, 2);
});
