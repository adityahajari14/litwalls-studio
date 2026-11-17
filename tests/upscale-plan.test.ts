import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import sharp from "sharp";

import { measureOversize } from "../src/lib/image/detail.ts";
import { planUpscale } from "../src/lib/pipeline/stages/upscale.ts";

/**
 * The upscale plan decides how many pixels the model is fed, which is both
 * where the time goes and what the print is regenerated from. Too many and a
 * poster takes minutes for nothing; too few, or the wrong ones, and real
 * detail is thrown away for invented detail.
 */

/** 2944x4416 against A3 is 210dpi: the shape every web-sourced poster arrives in. */
const WEB_POSTER = { width: 2944, height: 4416, worstDpi: 210 };

test("a sharp source short of the floor is fed at a quarter of its target", () => {
  const plan = planUpscale({ ...WEB_POSTER, oversize: 1 });
  assert.equal(plan.kind, "model");
  if (plan.kind !== "model") return;

  assert.deepEqual(plan.target, { width: 3575, height: 5362 });
  // The model's 4x output lands on the target, give or take rounding.
  assert.ok(plan.modelInput.width * 4 >= plan.target.width);
  assert.ok(plan.modelInput.width * 4 - plan.target.width < 4);
});

test("an oversized source is shrunk to the size its detail really is", () => {
  const plan = planUpscale({ ...WEB_POSTER, oversize: 4 });
  assert.equal(plan.kind, "model");
  if (plan.kind !== "model") return;

  // The target is what print needs either way; only the input changes.
  assert.deepEqual(plan.target, { width: 3575, height: 5362 });
  assert.ok(Math.abs(plan.modelInput.width - 2944 / 4) <= 1);
  assert.ok(Math.abs(plan.modelInput.height - 4416 / 4) <= 1);
});

test("the shrink stops where the stretch back up would start to show", () => {
  // 8x oversized would mean a 368px input stretched 2.4x after the model.
  const plan = planUpscale({ ...WEB_POSTER, oversize: 8 });
  assert.equal(plan.kind, "model");
  if (plan.kind !== "model") return;

  const stretch = plan.target.width / (plan.modelInput.width * 4);
  assert.ok(stretch <= 1.5, `stretched ${stretch.toFixed(2)}x`);
});

test("a sharp source with enough pixels is left alone", () => {
  assert.deepEqual(
    planUpscale({ width: 4000, height: 6000, worstDpi: 285, oversize: 1 }),
    { kind: "keep" },
  );
});

test("enough pixels but not the detail is regenerated, not waved through", () => {
  // The case pixel count alone cannot see: 285dpi on paper, 71dpi of detail.
  const plan = planUpscale({ width: 4000, height: 6000, worstDpi: 285, oversize: 4 });
  assert.equal(plan.kind, "model");
  if (plan.kind !== "model") return;

  // Finished at what print needs, not at the inflated size it arrived in.
  assert.ok(plan.target.width < 4000);
  assert.ok(plan.target.width >= 3508);
  assert.ok(plan.modelInput.width <= Math.ceil(plan.target.width / 4));
});

test("a mildly soft source with enough pixels keeps the detail it has", () => {
  // 2.5x oversized at 6000px still holds 2400px of real detail — far more
  // than the ~900px the model would be fed. Regenerating would lose it.
  assert.deepEqual(
    planUpscale({ width: 6000, height: 9000, worstDpi: 428, oversize: 2.5 }),
    { kind: "keep" },
  );
});

test("a small source is never enlarged before the model sees it", () => {
  // 600x900 needs ~6x; the model gets all of it and Lanczos does the rest.
  const plan = planUpscale({ width: 600, height: 900, worstDpi: 43, oversize: 1 });
  assert.equal(plan.kind, "model");
  if (plan.kind !== "model") return;
  assert.deepEqual(plan.modelInput, { width: 600, height: 900 });
});

test("the total resample is capped at 8x", () => {
  const plan = planUpscale({ width: 300, height: 450, worstDpi: 21, oversize: 1 });
  assert.equal(plan.kind, "model");
  if (plan.kind !== "model") return;
  assert.deepEqual(plan.target, { width: 2400, height: 3600 });
});

/**
 * The oversize measurement, on artwork made here so the right answer is known:
 * hard-edged shapes plus fine grain, which is sharp at whatever size it is
 * drawn, and the same artwork resampled up.
 */

let dir: string;
let sharpPath: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "oversize-"));
  sharpPath = join(dir, "sharp.png");

  // Drawn at twice the size and reduced, the way a photograph or a rendered
  // poster reaches its final size: detail right up to the limit, but none of
  // the aliasing that raw per-pixel noise would have.
  const size = 960;
  const pixels = Buffer.alloc(size * size * 3);
  // Deterministic, so a failure is reproducible.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const shapes = Array.from({ length: 60 }, () => ({
    x: random() * size,
    y: random() * size,
    w: 16 + random() * 180,
    h: 16 + random() * 180,
    level: 30 + random() * 200,
  }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let level = 128;
      for (const s of shapes) {
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) level = s.level;
      }
      level += (random() - 0.5) * 24;
      const i = (y * size + x) * 3;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.max(0, Math.min(255, level));
    }
  }
  await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .resize(size / 2, size / 2, { kernel: "lanczos3" })
    .png()
    .toFile(sharpPath);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("artwork at its native size is not oversized", async () => {
  assert.equal(await measureOversize(sharpPath), 1);
});

test("artwork resampled up 4x and saved as JPEG measures as about 4x", async () => {
  const path = join(dir, "x4.jpg");
  await sharp(sharpPath)
    .resize(1920, 1920, { kernel: "cubic" })
    .jpeg({ quality: 85 })
    .toFile(path);

  const oversize = await measureOversize(path);
  assert.ok(oversize >= 3 && oversize <= 5, `measured ${oversize}`);
});

test("a blank image says nothing about sharpness and is left as sharp", async () => {
  const path = join(dir, "blank.png");
  await sharp({
    create: { width: 800, height: 800, channels: 3, background: "#808080" },
  })
    .png()
    .toFile(path);

  assert.equal(await measureOversize(path), 1);
});
