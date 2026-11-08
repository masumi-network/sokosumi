/**
 * Notes a statistics sync stores when it lost data, beyond the usual gaps of
 * its source. Core writes them; the web flags a sync that carries one. Older
 * syncs stored the same text, so keep each note's wording unchanged.
 */
export const SEO_STATISTICS_QUERY_FAILED_NOTE =
  "One native query failed. Successful totals or daily observations are retained without filling gaps.";
export const SEO_STATISTICS_NO_AGGREGATE_NOTE =
  "Search Console returned no aggregate row. Missing measurements are unavailable, not zero.";
export const SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE =
  "Search Console query rows were unavailable for this sync. Totals are kept.";

const SEO_STATISTICS_LOSS_NOTES = [
  SEO_STATISTICS_QUERY_FAILED_NOTE,
  SEO_STATISTICS_NO_AGGREGATE_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
];

/** Whether stored notes, as a list or as joined text, report lost data. */
export function seoStatisticsLostData(notes: readonly string[] | string) {
  const text = typeof notes === "string" ? notes : notes.join("\n");
  return SEO_STATISTICS_LOSS_NOTES.some((note) => text.includes(note));
}
