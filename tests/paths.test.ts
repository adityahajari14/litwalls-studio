import assert from "node:assert/strict";
import { test } from "node:test";

import { jobAsset, newId } from "../src/lib/pipeline/paths.ts";
import { safeFilename, checkFile } from "../src/lib/print/upload.ts";

test("jobAsset resolves a normal relative path", () => {
  const path = jobAsset("batch1", "job1", "sizes/A4.jpg");
  assert.ok(path.includes("batch1"));
  assert.ok(path.includes("job1"));
  assert.ok(path.endsWith("A4.jpg"));
});

test("jobAsset refuses to escape the job directory", () => {
  // relPath reaches this function from JSON on disk and from HTTP query
  // strings, so traversal is a real input, not a hypothetical one.
  for (const evil of [
    "../../../.env",
    "..\\..\\secrets.txt",
    "sizes/../../../../etc/passwd",
  ]) {
    assert.throws(
      () => jobAsset("batch1", "job1", evil),
      /escapes its job directory/,
      `should have refused: ${evil}`,
    );
  }
});

test("ids are unique and filesystem-safe", () => {
  const ids = new Set(Array.from({ length: 500 }, newId));
  assert.equal(ids.size, 500, "id collision");
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/, `unsafe id: ${id}`);
  }
});

test("unsafe ids are rejected rather than sanitised", () => {
  // Sanitising would hide the upstream bug while writing to a surprising path.
  assert.throws(() => jobAsset("../evil", "job1", "a.jpg"), /Unsafe id/);
  assert.throws(() => jobAsset("batch1", "a/b", "a.jpg"), /Unsafe id/);
});

test("safeFilename keeps names recognisable", () => {
  assert.equal(safeFilename("Spider Man #01.jpg"), "Spider-Man-01.jpg");
  assert.equal(safeFilename("the weeknd.png"), "the-weeknd.png");
});

test("safeFilename handles Windows reserved device names", () => {
  // "CON.jpg" cannot be created on Windows and the resulting error is opaque.
  assert.equal(safeFilename("CON.jpg"), "artwork.jpg");
  assert.equal(safeFilename("nul.png"), "artwork.png");
  assert.equal(safeFilename("LPT1.tiff"), "artwork.tiff");
});

test("safeFilename never produces an empty stem or a traversal", () => {
  assert.equal(safeFilename("...jpg"), "artwork.jpg");
  assert.equal(safeFilename("../../etc/passwd.png"), "etc-passwd.png");
  assert.ok(!safeFilename("../../evil.jpg").includes(".."));
});

test("checkFile accepts print formats and rejects the rest", () => {
  assert.equal(checkFile({ name: "a.jpg", type: "image/jpeg", size: 1000 }), null);
  assert.equal(checkFile({ name: "a.tiff", type: "", size: 1000 }), null,
    "TIFF with no MIME should pass on extension — browsers often omit it");

  assert.match(
    checkFile({ name: "a.mp4", type: "video/mp4", size: 1000 })?.message ?? "",
    /unsupported file type/,
  );
  assert.match(
    checkFile({ name: "a.jpg", type: "image/jpeg", size: 0 })?.message ?? "",
    /empty/,
  );
  assert.match(
    checkFile({ name: "a.jpg", type: "image/jpeg", size: 500 * 1024 * 1024 })
      ?.message ?? "",
    /exceeds/,
  );
});
