import { isUsableQuad } from "@/lib/image/homography";
import type { MockupTemplate, Pt } from "@/lib/print/types";

/**
 * Validation for mockup templates.
 *
 * Shared with the browser so the corner-picker page can check its output using
 * exactly the code the server will run, rather than an approximation of it.
 *
 * Every failure returns a sentence a human can act on. These files are
 * hand-authored, so "corners must be in TL, TR, BR, BL order" is worth far
 * more than "invalid template".
 */

export type ValidationResult =
  | { ok: true; template: MockupTemplate }
  | { ok: false; errors: string[] };

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPoint(value: unknown): value is Pt {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isFinite((value as Pt).x) &&
    Number.isFinite((value as Pt).y)
  );
}

export function validateTemplate(input: unknown): ValidationResult {
  const errors: string[] = [];
  const t = input as Partial<MockupTemplate> & Record<string, unknown>;

  if (typeof t !== "object" || t === null) {
    return { ok: false, errors: ["Template must be a JSON object."] };
  }

  if (typeof t.id !== "string" || !/^[a-z0-9-]+$/.test(t.id)) {
    errors.push('"id" must be lowercase letters, digits and hyphens.');
  }
  if (typeof t.name !== "string" || t.name.trim() === "") {
    errors.push('"name" is required — it is what you pick from in the UI.');
  }
  if (typeof t.background !== "string" || t.background.trim() === "") {
    errors.push('"background" must name an image file in the same folder.');
  }
  if (t.overlay !== undefined && typeof t.overlay !== "string") {
    errors.push('"overlay", if present, must name an image file.');
  }

  const canvas = t.canvas as { width?: unknown; height?: unknown } | undefined;
  if (
    !canvas ||
    !isPositiveInt(canvas.width) ||
    !isPositiveInt(canvas.height)
  ) {
    errors.push('"canvas" needs positive "width" and "height" in pixels.');
  }

  if (t.kind === "flat") {
    const rect = t.rect as Record<string, unknown> | undefined;
    if (
      !rect ||
      !Number.isFinite(rect.x as number) ||
      !Number.isFinite(rect.y as number) ||
      !isPositiveInt(rect.width) ||
      !isPositiveInt(rect.height)
    ) {
      errors.push('"rect" needs x, y and positive width and height.');
    } else if (canvas && isPositiveInt(canvas.width) && isPositiveInt(canvas.height)) {
      const right = (rect.x as number) + (rect.width as number);
      const bottom = (rect.y as number) + (rect.height as number);
      if (
        (rect.x as number) < 0 ||
        (rect.y as number) < 0 ||
        right > canvas.width ||
        bottom > canvas.height
      ) {
        errors.push(
          `"rect" extends outside the canvas (${right}x${bottom} vs ${canvas.width}x${canvas.height}).`,
        );
      }
    }
  } else if (t.kind === "perspective") {
    const corners = t.corners as unknown;
    if (!Array.isArray(corners) || corners.length !== 4) {
      errors.push('"corners" must be exactly four points.');
    } else if (!corners.every(isPoint)) {
      errors.push('Each corner needs numeric "x" and "y".');
    } else if (!isUsableQuad(corners as Pt[])) {
      // The most common authoring mistake by a wide margin. A bow-tie still
      // has area and still solves — it just renders as a poster folded through
      // itself, which is baffling if you are not told why.
      errors.push(
        "Corners must form a convex quad in TL, TR, BR, BL order. " +
          "A self-crossing or zero-area quad renders as a folded poster.",
      );
    }
  } else {
    errors.push('"kind" must be "flat" or "perspective".');
  }

  if (t.shadow !== undefined) {
    if (typeof t.shadow !== "number" || t.shadow < 0 || t.shadow > 1) {
      errors.push('"shadow", if present, must be between 0 and 1.');
    }
  }
  if (t.panelGap !== undefined && !isPositiveInt(t.panelGap)) {
    errors.push('"panelGap", if present, must be a positive number of pixels.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, template: input as MockupTemplate };
}

/** Default gap between split panels in a mockup, in canvas pixels. */
export const DEFAULT_PANEL_GAP = 12;
