import { isUsableQuad } from "@/lib/image/homography";
import { SIZE_IDS } from "@/lib/print/sizes";
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

  if (t.sizing !== undefined) {
    errors.push(...validateSizing(t.sizing, t.kind));
  }
  if (t.splitSizing !== undefined) {
    errors.push(...validateSplitSizing(t.splitSizing, t.kind));
  }

  if (t.shadow !== undefined) {
    if (typeof t.shadow !== "number" || t.shadow < 0 || t.shadow > 1) {
      errors.push('"shadow", if present, must be between 0 and 1.');
    }
  }
  if (t.panelGap !== undefined) {
    if (
      typeof t.panelGap !== "number" ||
      !Number.isFinite(t.panelGap) ||
      t.panelGap < 0 ||
      t.panelGap > MAX_PANEL_GAP
    ) {
      errors.push(
        `"panelGap", if present, must be between 0 and ${MAX_PANEL_GAP} — it is a percentage of panel width, not pixels.`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, template: input as MockupTemplate };
}

/**
 * A single placement area — a rect for a flat template, a quad for a
 * perspective one. Shared by `sizing.base`, `sizing.overrides[...]`,
 * `splitSizing.base` and `splitSizing.overrides[...]`, which all hold the
 * same shape of value.
 */
function checkArea(value: unknown, where: string, kind: unknown, errors: string[]) {
  if (kind === "perspective") {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(isPoint)) {
      errors.push(`${where} must be four points.`);
    } else if (!isUsableQuad(value as Pt[])) {
      errors.push(`${where} must be a convex quad in TL, TR, BR, BL order.`);
    }
  } else {
    const rect = value as Record<string, unknown> | undefined;
    if (
      !rect ||
      !Number.isFinite(rect.x as number) ||
      !Number.isFinite(rect.y as number) ||
      !isPositiveInt(rect.width) ||
      !isPositiveInt(rect.height)
    ) {
      errors.push(`${where} needs x, y and positive width and height.`);
    }
  }
}

function checkOverrides(
  overrides: unknown,
  label: string,
  kind: unknown,
  errors: string[],
) {
  if (overrides === undefined) return;
  if (typeof overrides !== "object" || overrides === null) {
    errors.push(`"${label}.overrides", if present, must be an object.`);
    return;
  }
  for (const [sizeId, area] of Object.entries(
    overrides as Record<string, unknown>,
  )) {
    if (!(SIZE_IDS as readonly string[]).includes(sizeId)) {
      errors.push(`"${label}.overrides" has an unknown size "${sizeId}".`);
      continue;
    }
    checkArea(area, `"${label}.overrides.${sizeId}"`, kind, errors);
  }
}

/**
 * Per-size placement: which size the base area was drawn for, and any
 * hand-adjusted overrides.
 */
function validateSizing(input: unknown, kind: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return ['"sizing", if present, must be an object.'];
  }

  const sizing = input as Record<string, unknown>;

  if (
    typeof sizing.referenceSize !== "string" ||
    !(SIZE_IDS as readonly string[]).includes(sizing.referenceSize)
  ) {
    errors.push(
      `"sizing.referenceSize" must be one of: ${SIZE_IDS.join(", ")}.`,
    );
  }

  checkArea(sizing.base, '"sizing.base"', kind, errors);
  checkOverrides(sizing.overrides, "sizing", kind, errors);

  if (sizing.perSize !== undefined && typeof sizing.perSize !== "boolean") {
    errors.push('"sizing.perSize", if present, must be true or false.');
  }

  return errors;
}

/**
 * Placement for a split-3 poster's assembled panel set. No `referenceSize`
 * or `perSize` here — it is authored against the same reference size as
 * `sizing`, since there is only one to pick.
 */
function validateSplitSizing(input: unknown, kind: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return ['"splitSizing", if present, must be an object.'];
  }

  const sizing = input as Record<string, unknown>;

  checkArea(sizing.base, '"splitSizing.base"', kind, errors);
  checkOverrides(sizing.overrides, "splitSizing", kind, errors);

  return errors;
}

/**
 * Default gap between split panels, as a PERCENTAGE OF PANEL WIDTH.
 *
 * A percentage rather than pixels because the assembled strip is scaled down
 * by roughly twelve times to sit on a mockup wall: a pixel gap set at print
 * resolution arrives sub-pixel and vanishes, which is why split mockups read
 * as one wide poster.
 *
 * 1.2% is deliberately minimal — on a three-panel A3 set that is a hairline a
 * couple of millimetres wide at print scale. Enough to say "three sheets"
 * without looking like the panels have drifted apart.
 */
export const DEFAULT_PANEL_GAP = 1.2;

/** Nothing above this reads as a deliberate gap rather than a layout error. */
export const MAX_PANEL_GAP = 6;
