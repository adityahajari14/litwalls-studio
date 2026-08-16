"use server";

import { revalidatePath } from "next/cache";

import { SIZE_IDS, SPLIT_SIZE_IDS } from "@/lib/print/sizes";
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

  const splitPrices: Partial<Record<SizeId, string>> = {};
  const splitCompareAt: Partial<Record<SizeId, string>> = {};

  for (const sizeId of SPLIT_SIZE_IDS) {
    splitPrices[sizeId] = String(formData.get(`splitPrice.${sizeId}`) ?? "");
    splitCompareAt[sizeId] = String(
      formData.get(`splitCompare.${sizeId}`) ?? "",
    );
  }

  // A range input posts tenths of a millimetre, so the slider can offer 0.1mm
  // steps without dealing in fractional form values.
  const rawMm = Number(formData.get("borderMm"));
  const mockupBorder = {
    enabled: formData.get("borderEnabled") === "on",
    mm: Number.isFinite(rawMm) ? rawMm / 10 : 0.5,
  };

  // writeSettings normalises and drops anything unparseable, so a blank field
  // clears that size's default rather than storing an empty string.
  const saved = await writeSettings({
    prices,
    compareAt,
    splitPrices,
    splitCompareAt,
    mockupBorder,
  });

  // A value the user typed that did NOT survive normalisation was garbage.
  // Silently dropping it would leave them believing a price was saved.
  const rejected = SIZE_IDS.filter((sizeId) => {
    const typed = String(formData.get(`price.${sizeId}`) ?? "").trim();
    return typed !== "" && saved.prices[sizeId] === undefined;
  });
  const rejectedSplit = SPLIT_SIZE_IDS.filter((sizeId) => {
    const typed = String(formData.get(`splitPrice.${sizeId}`) ?? "").trim();
    return typed !== "" && saved.splitPrices[sizeId] === undefined;
  });

  revalidatePath("/settings");
  revalidatePath("/");

  if (rejected.length > 0 || rejectedSplit.length > 0) {
    const bad = [...rejected, ...rejectedSplit.map((id) => `split ${id}`)];
    return {
      ok: false,
      message: `Ignored an unreadable price for ${bad.join(", ")}. Use digits only — e.g. 499 or 499.50.`,
    };
  }

  return { ok: true, message: "Saved." };
}
