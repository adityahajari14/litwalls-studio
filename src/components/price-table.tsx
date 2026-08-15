import { SIZES } from "@/lib/print/sizes";
import type { PartialPriceTable, PriceOrigin } from "@/lib/print/pricing";

/**
 * Price inputs for all four sizes.
 *
 * Used at all three levels of the override chain — dashboard settings, batch
 * creation, and a single poster's review screen — because the levels differ
 * only in what an empty field means, and that difference is one sentence of
 * help text rather than three components.
 *
 * `inherited` supplies the placeholder: an empty field shows the value that
 * would be used instead, so "blank means inherit" is visible rather than
 * something the user has to be told.
 */
export function PriceTable({
  values,
  compareValues,
  inherited,
  inheritedCompare,
  origins,
  emptyMeans,
}: {
  values: PartialPriceTable;
  compareValues: PartialPriceTable;
  /** What each size resolves to when this level leaves it blank. */
  inherited: Record<string, string>;
  inheritedCompare?: PartialPriceTable;
  /** Where each resolved value currently comes from, for the hint column. */
  origins?: Record<string, PriceOrigin>;
  emptyMeans: string;
}) {
  return (
    <div>
      <table className="w-full text-sm">
        <thead className="text-left text-ink-500">
          <tr>
            <th className="py-1 font-normal">Size</th>
            <th className="py-1 font-normal">Price ₹</th>
            <th className="py-1 font-normal">Compare at ₹</th>
            {origins ? <th className="py-1 font-normal">From</th> : null}
          </tr>
        </thead>
        <tbody>
          {SIZES.map((size) => (
            <tr
              key={size.id}
              className="border-t border-paper-200/70"
            >
              <td className="py-2 font-medium">{size.label}</td>
              <td className="py-2 pr-3">
                <input
                  type="text"
                  inputMode="decimal"
                  name={`price.${size.id}`}
                  defaultValue={values[size.id] ?? ""}
                  placeholder={inherited[size.id]}
                  className="w-28 rounded border border-paper-300 bg-transparent px-2 py-1 tabular-nums"
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  type="text"
                  inputMode="decimal"
                  name={`compare.${size.id}`}
                  defaultValue={compareValues[size.id] ?? ""}
                  placeholder={inheritedCompare?.[size.id] ?? "—"}
                  className="w-28 rounded border border-paper-300 bg-transparent px-2 py-1 tabular-nums"
                />
              </td>
              {origins ? (
                <td className="py-2 text-xs text-ink-500">
                  {origins[size.id]}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-500">{emptyMeans}</p>
      <p className="mt-1 text-xs text-ink-500">
        Compare-at only displays when it is higher than the price — a lower one
        would read as a price rise, so it is dropped.
      </p>
    </div>
  );
}
