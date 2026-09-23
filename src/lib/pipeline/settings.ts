import "server-only";

import { readFile } from "node:fs/promises";

import {
  FALLBACK_COMPARE_AT,
  FALLBACK_PRICES,
  FALLBACK_SPLIT_COMPARE_AT,
  FALLBACK_SPLIT_PRICES,
  normalizePriceTable,
  type PartialPriceTable,
} from "@/lib/print/pricing";
import { DEFAULT_DESCRIPTION_TEMPLATE } from "@/lib/print/description";
import { SETTINGS_FILE, writeJsonAtomic } from "@/lib/pipeline/paths";
import { DEFAULT_PANEL_GAP, MAX_PANEL_GAP } from "@/lib/templates/schema";

/**
 * Dashboard-wide defaults.
 *
 * The bottom of the price override chain: a batch may override these, and a
 * single poster may override the batch. Stored as one small JSON file rather
 * than in env, because these are values the user edits from the UI and expects
 * to persist — an env var would mean editing a file and restarting the server
 * to change a price.
 */
export type Settings = {
  /** Default price per size. Sizes absent here fall back to FALLBACK_PRICES. */
  prices: PartialPriceTable;
  /** Default struck-through "was" price per size. */
  compareAt: PartialPriceTable;
  /**
   * Same, for split-3 posters. Kept separate rather than reusing `prices`
   * because a three-panel set is a different product from a single sheet at
   * the same nominal size — pricing it the same would either undersell the
   * set or oversell the sheet. Never has an "A5" entry: split-3 does not sell
   * at that size (see `SPLIT_SIZE_IDS`).
   */
  splitPrices: PartialPriceTable;
  splitCompareAt: PartialPriceTable;
  /**
   * Whether mockups show the white border the printer adds.
   *
   * The border is real — the printer puts a 0.5mm white edge on every poster —
   * so showing it makes the mockup an honest picture of the product. It is a
   * setting rather than always-on because at 0.5mm it is a hairline that some
   * templates swallow entirely, and because a framed mockup may read better
   * without it.
   *
   * Measured in millimetres, the same unit the printer works in, and converted
   * to pixels against each size's real physical dimensions. So "0.5" means
   * 0.5mm on an A5 and on a 13x19 alike, and raising it is a deliberate choice
   * to depict something larger than the product actually has.
   */
  mockupBorder: { enabled: boolean; mm: number };
  /**
   * The gap between panels in a split-3 mockup, as a PERCENTAGE OF PANEL
   * WIDTH — same unit a template's own `panelGap` uses, since this is what
   * a template falls back to when it does not set one itself. Dashboard-wide
   * because most templates should agree on how visibly separated the three
   * sheets look; a template that genuinely needs a different gap still sets
   * its own `panelGap` and wins over this.
   */
  splitGap: number;
  /**
   * The product description, as an HTML template with `{{subject}}` and
   * `{{format}}` tokens — see `print/description.ts`. Store copy, so it is
   * edited from the dashboard rather than in code.
   */
  descriptionTemplate: string;
  updatedAt: number;
};

/** The border the printer actually applies. */
export const TRUE_BORDER_MM = 0.5;

/** Past this the mockup stops depicting the real product. */
export const MAX_BORDER_MM = 8;

export const DEFAULT_SETTINGS: Settings = {
  prices: { ...FALLBACK_PRICES },
  compareAt: { ...FALLBACK_COMPARE_AT },
  splitPrices: { ...FALLBACK_SPLIT_PRICES },
  splitCompareAt: { ...FALLBACK_SPLIT_COMPARE_AT },
  // On by default: the border is part of the product, so a mockup without it
  // shows something the customer will not receive.
  mockupBorder: { enabled: true, mm: TRUE_BORDER_MM },
  splitGap: DEFAULT_PANEL_GAP,
  descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
  updatedAt: 0,
};

/**
 * Read the saved settings, falling back to defaults.
 *
 * A missing file is the normal first-run state, not an error. A CORRUPT file
 * is also handled rather than thrown: settings are a convenience, and losing
 * a price table should degrade to the defaults with a warning, not brick the
 * dashboard so the user cannot get in to fix it.
 */
export async function readSettings(): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(SETTINGS_FILE, "utf8");
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      // Re-normalised on read as well as write: this file is deliberately
      // hand-editable, so it may contain whatever a person typed into it.
      prices: normalizePriceTable(parsed.prices ?? {}),
      compareAt: normalizePriceTable(parsed.compareAt ?? {}),
      splitPrices: normalizePriceTable(parsed.splitPrices ?? {}),
      splitCompareAt: normalizePriceTable(parsed.splitCompareAt ?? {}),
      mockupBorder: normalizeBorder(parsed.mockupBorder),
      splitGap: normalizeSplitGap(parsed.splitGap),
      descriptionTemplate: normalizeDescriptionTemplate(
        parsed.descriptionTemplate,
      ),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    console.warn(
      `settings: ${SETTINGS_FILE} is not valid JSON — using defaults. ` +
        "Fix or delete the file to clear this.",
    );
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(
  update: Pick<Settings, "prices" | "compareAt" | "splitPrices" | "splitCompareAt"> &
    Partial<Pick<Settings, "mockupBorder" | "splitGap" | "descriptionTemplate">>,
): Promise<Settings> {
  const settings: Settings = {
    prices: normalizePriceTable(update.prices),
    compareAt: normalizePriceTable(update.compareAt),
    splitPrices: normalizePriceTable(update.splitPrices),
    splitCompareAt: normalizePriceTable(update.splitCompareAt),
    mockupBorder: normalizeBorder(update.mockupBorder),
    splitGap: normalizeSplitGap(update.splitGap),
    descriptionTemplate: normalizeDescriptionTemplate(
      update.descriptionTemplate,
    ),
    updatedAt: Date.now(),
  };
  await writeJsonAtomic(SETTINGS_FILE, settings);
  return settings;
}

/**
 * Clamp a border setting into something renderable.
 *
 * The file is hand-editable, so it may hold anything. A negative or absurd
 * width would produce a mockup that misrepresents the product rather than an
 * error, which is the failure worth preventing.
 */
function normalizeBorder(input: unknown): Settings["mockupBorder"] {
  const raw = input as Partial<Settings["mockupBorder"]> | undefined;
  const mm =
    typeof raw?.mm === "number" && Number.isFinite(raw.mm)
      ? Math.min(MAX_BORDER_MM, Math.max(0, raw.mm))
      : TRUE_BORDER_MM;

  return {
    // Absent means "not configured yet", which should behave like the default
    // rather than like off.
    enabled: raw?.enabled !== false,
    mm,
  };
}

/**
 * Clamp the dashboard's split-panel gap the same way `schema.ts` clamps a
 * template's own `panelGap` — 0 to `MAX_PANEL_GAP`, falling back to
 * `DEFAULT_PANEL_GAP` for anything absent or unusable in a hand-edited file.
 */
function normalizeSplitGap(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input)
    ? Math.min(MAX_PANEL_GAP, Math.max(0, input))
    : DEFAULT_PANEL_GAP;
}

/**
 * A blank template would publish an empty description on every product, so
 * that falls back to the default rather than being accepted as-is. Anything
 * else the user typed — including one missing `{{subject}}` or `{{format}}` —
 * is theirs to get right; this is store copy, not something worth rejecting.
 */
function normalizeDescriptionTemplate(input: unknown): string {
  return typeof input === "string" && input.trim()
    ? input
    : DEFAULT_DESCRIPTION_TEMPLATE;
}
