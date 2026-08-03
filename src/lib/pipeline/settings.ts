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
  updatedAt: number;
};

export const DEFAULT_SETTINGS: Settings = {
  prices: { ...FALLBACK_PRICES },
  compareAt: { ...FALLBACK_COMPARE_AT },
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
  update: Pick<Settings, "prices" | "compareAt">,
): Promise<Settings> {
  const settings: Settings = {
    prices: normalizePriceTable(update.prices),
    compareAt: normalizePriceTable(update.compareAt),
    updatedAt: Date.now(),
  };
  await writeJsonAtomic(SETTINGS_FILE, settings);
  return settings;
}
