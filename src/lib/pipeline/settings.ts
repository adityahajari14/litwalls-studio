import "server-only";

import { readFile } from "node:fs/promises";

import {
  FALLBACK_COMPARE_AT,
  FALLBACK_PRICES,
  normalizePriceTable,
  type PartialPriceTable,
} from "@/lib/print/pricing";
import { SETTINGS_FILE, writeJsonAtomic } from "@/lib/pipeline/paths";

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
  updatedAt: number;
};

/** The border the printer actually applies. */
export const TRUE_BORDER_MM = 0.5;

/** Past this the mockup stops depicting the real product. */
export const MAX_BORDER_MM = 8;

export const DEFAULT_SETTINGS: Settings = {
  prices: { ...FALLBACK_PRICES },
  compareAt: { ...FALLBACK_COMPARE_AT },
  // On by default: the border is part of the product, so a mockup without it
  // shows something the customer will not receive.
  mockupBorder: { enabled: true, mm: TRUE_BORDER_MM },
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
      mockupBorder: normalizeBorder(parsed.mockupBorder),
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
  update: Pick<Settings, "prices" | "compareAt"> & Partial<Pick<Settings, "mockupBorder">>,
): Promise<Settings> {
  const settings: Settings = {
    prices: normalizePriceTable(update.prices),
    compareAt: normalizePriceTable(update.compareAt),
    mockupBorder: normalizeBorder(update.mockupBorder),
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
