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

/**
 * The tracked keyword daily read failed. Totals and query rows are separate
 * reads, so this note does not mark the sync as having lost data.
 */
export const SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE =
  "Search Console daily positions for tracked keywords were unavailable for this sync. Other measurements are kept.";

/** The country or device read failed. Like the keyword note, it does not mark lost data. */
export const SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE =
  "Search Console totals by country or by device were unavailable for this sync. Other measurements are kept.";

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
