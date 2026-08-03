"use server";

import { revalidatePath } from "next/cache";

import { SIZE_IDS } from "@/lib/print/sizes";
import type { SizeId } from "@/lib/print/types";
import { writeSettings } from "@/lib/pipeline/settings";

export type SaveState = { ok: boolean; message: string } | null;

/**
 * Save the dashboard-wide default prices.
 *
 * A Server Action is the right tool here, unlike for uploads: this payload is
 * eight short strings, nowhere near the 1MB body cap that forces print files
 * onto a Route Handler.
 *
 * Returns a result rather than throwing, so a mistyped price re-renders the
 * form with a message instead of blowing up the page.
 */
export async function saveSettings(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const prices: Partial<Record<SizeId, string>> = {};
  const compareAt: Partial<Record<SizeId, string>> = {};

  for (const sizeId of SIZE_IDS) {
    prices[sizeId] = String(formData.get(`price.${sizeId}`) ?? "");
    compareAt[sizeId] = String(formData.get(`compare.${sizeId}`) ?? "");
  }

  // writeSettings normalises and drops anything unparseable, so a blank field
  // clears that size's default rather than storing an empty string.
  const saved = await writeSettings({ prices, compareAt });

  // A value the user typed that did NOT survive normalisation was garbage.
  // Silently dropping it would leave them believing a price was saved.
  const rejected = SIZE_IDS.filter((sizeId) => {
    const typed = String(formData.get(`price.${sizeId}`) ?? "").trim();
    return typed !== "" && saved.prices[sizeId] === undefined;
  });

  revalidatePath("/settings");
  revalidatePath("/");

  if (rejected.length > 0) {
    return {
      ok: false,
      message: `Ignored an unreadable price for ${rejected.join(", ")}. Use digits only — e.g. 499 or 499.50.`,
    };
  }

  return { ok: true, message: "Saved." };
}
