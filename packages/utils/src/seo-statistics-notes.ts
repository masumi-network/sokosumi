/**
 * Every note a statistics sync stores. Core writes only these constants and builders; the web reads each
 * stored note back with readSeoStatisticsNote. Older syncs stored the same text, so keep each note's wording
 * unchanged.
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

/** The landing page read failed. Totals are separate reads, so this note does not mark lost data. */
export const SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE =
  "Google Analytics key events per landing page were unavailable for this sync. Other measurements are kept.";
/** Pages that share a path on different hosts are left out of the landing read. */
export const SEO_STATISTICS_ANALYTICS_SHARED_LANDING_PATH_NOTE =
  "Key events per landing page were not read for pages that share a path on different hosts: Google Analytics names a landing page by its path only.";

/** Every Search Console sync with query rows stores this routine note: Google never lists anonymized queries. */
export const SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE =
  "Query rows omit anonymized queries, so they can add up to less than the page totals.";

/** Core stores at most this many characters per note. */
const SEO_STATISTICS_NOTE_LIMIT = 2000;

/** Search Console kept only the first query rows. The stored query rows carry the same fact as `truncated`. */
export function seoStatisticsQueryRowsCutNote(rowLimit: number) {
  return `Only the first ${rowLimit} query rows by clicks were kept. More rows can exist.`;
}
const QUERY_ROWS_CUT =
  /^Only the first (\d+) query rows by clicks were kept\. More rows can exist\.$/;

/** Search Console kept only the first daily rows of the tracked keywords. */
export function seoStatisticsKeywordRowsCutNote(rowLimit: number) {
  return `Only the first ${rowLimit} daily keyword rows by clicks were kept. Some days can be missing.`;
}
const KEYWORD_ROWS_CUT =
  /^Only the first (\d+) daily keyword rows by clicks were kept\. Some days can be missing\.$/;

/** Names the tracked keywords a sync did not read, as many as fit in one note. A quote in a name is doubled. */
export function seoStatisticsKeywordsLeftOutNote(
  leftOut: readonly string[],
  maxKeywords: number,
  maxCountries: number,
) {
  let note = `Daily positions are read for at most ${maxKeywords} tracked keywords in ${maxCountries} countries Search Console can filter by, per sync. Not read this time: `;
  for (const [index, keyword] of leftOut.entries()) {
    const name = `${index ? ", " : ""}"${keyword.replaceAll('"', '""')}"`;
    const more = ` and ${leftOut.length - index} more.`;
    if (note.length + name.length + more.length + 1 > SEO_STATISTICS_NOTE_LIMIT)
      return `${note}${more}`;
    note += name;
  }
  return `${note}.`;
}
const KEYWORDS_LEFT_OUT =
  /^Daily positions are read for at most \d+ tracked keywords in \d+ countries Search Console can filter by, per sync\. Not read this time: ([\s\S]*?)(?: and (\d+) more)?\.$/;
/** One quoted name, a doubled quote inside it, then the next name or the end. */
const LEFT_OUT_NAME = /"((?:[^"]|"")*)"(?:, (?=")|$)/y;

/**
 * The names of a left-out note. Notes stored before quotes were doubled do not parse as quoted names when a
 * name holds a quote; they split at '", "' as before. Such an older note with a name that holds '", "' reads
 * that name as two, so its names and count are one too many.
 */
function leftOutNames(list: string) {
  const names: string[] = [];
  LEFT_OUT_NAME.lastIndex = 0;
  while (LEFT_OUT_NAME.lastIndex < list.length) {
    const match = LEFT_OUT_NAME.exec(list);
    if (!match) return list.slice(1, -1).split('", "');
    names.push(match[1].replaceAll('""', '"'));
  }
  return names;
}

/** A message key under "App.Seo.improve.gaps" for a note that names data the sync left out. */
export type SeoStatisticsNoteGap =
  | "queryFailed"
  | "noAggregate"
  | "queryRows"
  | "keywordSeries"
  | "breakdown"
  | "indexStatus"
  | "analyticsTimeZone"
  | "analyticsNoAggregate"
  | "analyticsThresholding"
  | "analyticsTruncated"
  | "analyticsLandingPages"
  | "analyticsSharedLandingPath"
  | "keywordRowsCut"
  | "keywordsLeftOut";

/**
 * What one stored note means: "routine" is a property of the source on every sync, never a gap; "flag"
 * repeats a structured field the reader already gets (the query rows' `truncated`); "gap" is data the sync
 * left out, with its message and values.
 */
export type SeoStatisticsNoteReading =
  | { kind: "routine" }
  | { kind: "flag" }
  | {
      kind: "gap";
      gap: SeoStatisticsNoteGap;
      count?: number;
      names?: string[];
    };

const gap = (name: SeoStatisticsNoteGap): SeoStatisticsNoteReading => ({
  kind: "gap",
  gap: name,
});

const FIXED_NOTES = new Map<string, SeoStatisticsNoteReading>([
  [SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE, { kind: "routine" }],
  [SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE, { kind: "routine" }],
  [SEO_STATISTICS_QUERY_FAILED_NOTE, gap("queryFailed")],
  [SEO_STATISTICS_NO_AGGREGATE_NOTE, gap("noAggregate")],
  [SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE, gap("queryRows")],
  [SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE, gap("keywordSeries")],
  [SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE, gap("breakdown")],
  [SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE, gap("indexStatus")],
  [SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE, gap("analyticsTimeZone")],
  [SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE, gap("analyticsNoAggregate")],
  [SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE, gap("analyticsThresholding")],
  [SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE, gap("analyticsTruncated")],
  [
    SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE,
    gap("analyticsLandingPages"),
  ],
  [
    SEO_STATISTICS_ANALYTICS_SHARED_LANDING_PATH_NOTE,
    gap("analyticsSharedLandingPath"),
  ],
]);

/** The fixed notes of the catalog. A builder's notes are read by readSeoStatisticsNote. */
export const SEO_STATISTICS_FIXED_NOTES: readonly string[] = [
  ...FIXED_NOTES.keys(),
];

/** The catalog's reading of one stored note, or null for a note this catalog does not know. */
export function readSeoStatisticsNote(
  note: string,
): SeoStatisticsNoteReading | null {
  const fixed = FIXED_NOTES.get(note);
  if (fixed) return fixed;
  if (QUERY_ROWS_CUT.test(note)) return { kind: "flag" };
  const keywordRows = KEYWORD_ROWS_CUT.exec(note);
  if (keywordRows)
    return {
      kind: "gap",
      gap: "keywordRowsCut",
      count: Number(keywordRows[1]),
    };
  const leftOut = KEYWORDS_LEFT_OUT.exec(note);
  if (leftOut) {
    const list = leftOut[1].trim();
    const names = leftOutNames(list);
    return {
      kind: "gap",
      gap: "keywordsLeftOut",
      names,
      count: names.length + Number(leftOut[2] ?? 0),
    };
  }
  return null;
}

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
