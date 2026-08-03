import type { Pt } from "@/lib/print/types";

/**
 * Projective transforms — the maths behind placing a poster on an angled wall.
 *
 * PURE. No sharp, no filesystem, no dependencies. Just algebra, which means it
 * can be tested exactly rather than by eyeballing a rendered image.
 *
 * Why this exists at all: sharp cannot do perspective. Its `affine()` takes a
 * 2x2 matrix, so it preserves parallel lines by construction — verified by
 * reading sharp's operation.js. A poster on an angled wall is a keystone, and
 * a keystone needs the full 3x3 with a non-zero bottom row. The alternatives
 * were opencv4nodejs (a native OpenCV build, miserable on Windows) or
 * node-canvas (also native, and Cairo's transform is affine-only so it does
 * not even solve the problem). Roughly eighty lines of algebra is the better
 * trade.
 */

/** Row-major 3x3, with h[8] normalised to 1. */
export type Homography = readonly number[];

/**
 * Solve the homography mapping four source points onto four destination points.
 *
 * Each correspondence contributes two linear equations in the eight unknowns
 * (h[8] is fixed at 1 to remove the scale ambiguity), so four points give
 * exactly eight equations — a square system, solved by Gaussian elimination.
 *
 * PARTIAL PIVOTING IS NOT OPTIONAL. Without it, a template whose first corner
 * sits at x=0 (very common — templates are often authored against an edge)
 * puts a zero on the diagonal and the solve divides by zero, producing NaNs
 * that surface much later as a blank mockup.
 *
 * Returns null rather than throwing when the system is singular, which happens
 * for a degenerate quad — three collinear corners, or a zero-area rect. The
 * caller treats that as "this template is malformed", not as a crash.
 */
export function solveHomography(
  src: readonly Pt[],
  dst: readonly Pt[],
): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;

  // Build the 8x9 augmented matrix.
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null; // singular
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const lead = m[col][col];
    for (let k = col; k < 9; k++) m[col][k] /= lead;

    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (factor === 0) continue;
      for (let k = col; k < 9; k++) m[row][k] -= factor * m[col][k];
    }
  }

  const h = [...Array.from({ length: 8 }, (_, i) => m[i][8]), 1];
  return h.every(Number.isFinite) ? h : null;
}

/**
 * Apply a homography to a point.
 *
 * Returns null when the point maps to the horizon (w ~ 0), where the
 * projection is undefined. Callers skip such pixels rather than dividing by
 * something infinitesimal and producing coordinates in the millions.
 */
export function applyH(h: Homography, p: Pt): Pt | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Invert a homography via its adjugate. Returns null if not invertible. */
export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;

  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  const inv = [
    A,
    -(b * j - c * i),
    b * f - c * e,
    B,
    a * j - c * g,
    -(a * f - c * d),
    C,
    -(a * i - b * g),
    a * e - b * d,
  ].map((v) => v / det);

  // Renormalise so h[8] === 1, keeping the representation canonical.
  if (Math.abs(inv[8]) < 1e-12) return null;
  const scaled = inv.map((v) => v / inv[8]);
  return scaled.every(Number.isFinite) ? scaled : null;
}

/** The unit square, in TL → TR → BR → BL order. */
export const UNIT_QUAD: readonly Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Signed area of a quad via the shoelace formula. Positive means clockwise in
 * screen coordinates, where y grows downward.
 */
export function quadArea(quad: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Whether a quad is usable as a mockup destination.
 *
 * Convexity matters as much as area: a bow-tied quad (corners given in the
 * wrong order, the single most likely authoring mistake) still has area, still
 * solves, and renders as a poster folded through itself. Catching it here
 * turns a baffling image into a clear "your corners are in the wrong order".
 */
export function isUsableQuad(quad: readonly Pt[]): boolean {
  if (quad.length !== 4) return false;
  if (!quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    return false;
  }
  if (Math.abs(quadArea(quad)) < 1) return false;

  // Every cross product must share a sign for the quad to be convex.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue; // collinear-ish, tolerate
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

/** Axis-aligned bounding box of a quad, clamped to a canvas. */
export function boundsOf(
  quad: readonly Pt[],
  canvas: { width: number; height: number },
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x)))),
    minY: Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y)))),
    maxX: Math.min(canvas.width - 1, Math.ceil(Math.max(...quad.map((p) => p.x)))),
    maxY: Math.min(canvas.height - 1, Math.ceil(Math.max(...quad.map((p) => p.y)))),
  };
}
