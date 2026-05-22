/**
 * next-intl message catalogs must use string leaves only — JSON arrays break
 * `AbstractIntlMessages`. Store ordered lists as `{ "0": "…", "1": "…" }` and
 * rehydrate with this helper where components need arrays.
 */
export function orderedMessageList<T>(record: Record<string, T>): T[] {
  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => record[key]);
}
