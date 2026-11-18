/**
 * The "Organic position per device" measure, read from the lines the SEO coworker writes (seo-bot
 * agent/lib/rows-serp.ts): the page's Google position for its lead keyword, the AI Overview and one line per
 * other keyword. The lines stay stored as they are; this only picks what a short row shows.
 */

export type SeoRankResult =
  | { kind: "absent"; top: number }
  | { kind: "ranked"; featured: boolean; position: number }
  /** An average over the impressions of recent weeks, not today's rank. */
  | { kind: "searchConsole"; position: number }
  | { kind: "other"; text: string };

export type SeoRankKeyword = { keyword: string; result: SeoRankResult };

export type SeoRankDetail = {
  keyword: string;
  country: string;
  language: string;
  device: "mobile" | "desktop";
  readAt: Date | null;
  /** The SERP read's result for the lead keyword. */
  result: SeoRankResult;
  /** Search Console's average position for the lead keyword: when it counts, it leads (seo-bot ticket 69). */
  searchConsole: SeoRankResult | null;
  /** Whether the AI Overview cites the page; null when the results showed no AI Overview. */
  aiOverviewCites: boolean | null;
  others: SeoRankKeyword[];
};

// `"macbook charge limit", Market US, en (location_code 2840), mobile, DataForSEO SERP of 2026-11-16 23:50:46 +00:00: 16 organic results read`
const HEAD =
  /^"(.+)", Market ([A-Z]{2}), ([a-z]{2,3}(?:-[A-Za-z]+)?) \(location_code \d+\), (mobile|desktop), DataForSEO SERP of (.+): \d+ organic results read$/;
const ABSENT = /the page is not in the top (\d+) organic results/;
// `"kw", mobile: Search Console average position 4.2 over final data …` leads; another keyword's line starts
// `Search Console 3.0 (40 impressions); SERP: …`.
const SEARCH_CONSOLE =
  /^(?:"(.+)", (?:mobile|desktop): )?Search Console (?:average position )?(\d+(?:\.\d+)?)\b/;
// The rank_absolute after the number: a line the coworker cut at its length cap ("position 12…") is no position.
const RANKED =
  /the page at (organic|featured_snippet) position (\d+) \(rank_absolute/;
// `"mac battery health checker" (goal): the page is not in the top 18 organic results`. The bucket is one of the
// coworker's (seo-bot focus.ts BUCKETS), so an error text with its own `" (x): ` does not end the keyword.
const OTHER = /^"(.+?)" \((?:owner|striking|goal|owned)\): (.+)$/;
const AI_NOT_CITED = "an AI Overview shows and does not cite the page";
const AI_CITED = "the AI Overview cites the page";
// DataForSEO's datetime: `2026-11-16 23:50:46 +00:00`.
const SERP_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/;

export function seoRankResult(line: string): SeoRankResult {
  const searchConsole = SEARCH_CONSOLE.exec(line);
  if (searchConsole)
    return { kind: "searchConsole", position: Number(searchConsole[2]) };
  const absent = ABSENT.exec(line);
  if (absent) return { kind: "absent", top: Number(absent[1]) };
  const ranked = RANKED.exec(line);
  if (ranked)
    return {
      kind: "ranked",
      featured: ranked[1] === "featured_snippet",
      position: Number(ranked[2]),
    };
  return { kind: "other", text: line };
}

function serpTime(text: string) {
  const parts = SERP_TIME.exec(text);
  if (!parts) return null;
  const date = new Date(`${parts[1]}T${parts[2]}${parts[3]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The short form of the lines, or null when they do not have the shape above: the row then shows them all. */
export function seoRankDetail(
  evidence: readonly string[],
): SeoRankDetail | null {
  const headAt = evidence.findIndex((line) => HEAD.test(line));
  const where = evidence[headAt + 1];
  if (headAt < 0 || where === undefined) return null;
  const head = HEAD.exec(evidence[headAt]);
  if (!head) return null;
  const result = seoRankResult(where);
  if (result.kind === "other") return null;
  const rest = evidence.slice(headAt + 2);
  // The Search Console line of the lead keyword comes before the SERP head.
  const searchConsoleLine = evidence
    .slice(0, headAt)
    .find((line) => SEARCH_CONSOLE.exec(line)?.[1] === head[1]);
  return {
    keyword: head[1],
    country: head[2],
    language: head[3],
    device: head[4] as SeoRankDetail["device"],
    readAt: serpTime(head[5]),
    result,
    searchConsole: searchConsoleLine ? seoRankResult(searchConsoleLine) : null,
    aiOverviewCites: rest.includes(AI_CITED)
      ? true
      : rest.includes(AI_NOT_CITED)
        ? false
        : null,
    others: rest.flatMap((line) => {
      const other = OTHER.exec(line);
      return other
        ? [{ keyword: other[1], result: seoRankResult(other[2]) }]
        : [];
    }),
  };
}

/** The other keywords outside the results read, and the fewest results read among them: none is in that top. */
export function seoRankAbsentOthers(others: readonly SeoRankKeyword[]) {
  const tops = others.flatMap((other) =>
    other.result.kind === "absent" ? [other.result.top] : [],
  );
  return tops.length ? { count: tops.length, top: Math.min(...tops) } : null;
}
