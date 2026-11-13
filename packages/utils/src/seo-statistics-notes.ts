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

/** URL Inspection gave no answer for one or more pages. It does not mark lost data. */
export const SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE =
  "Google's index status was unavailable for one or more pages in this sync. Other measurements are kept.";

/**
 * Every Search Console sync stores this routine note. It names a property of the source, not a gap of one
 * sync, so the web does not list it as missing data.
 */
export const SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE =
  "Search Console final data can omit recent dates and privacy-filtered observations.";

/** Notes of a Google Analytics sync. */
export const SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE =
  "The Analytics property time zone was not returned; period comparisons are limited.";
export const SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE =
  "Analytics returned no aggregate row. Missing measurements are unavailable, not zero.";
export const SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE =
  "Analytics reported thresholding or data loss.";
export const SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE =
  "The daily Analytics result was truncated.";

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
