import { z } from "zod";
import { reportObject } from "./project-seo-public-report";
import { completeKeywordMonths } from "./project-seo-seasonal";

const rankedRow = z.object({
  keyword: z.string().min(1).max(256),
  position: z.number().int().positive(),
  url: z.httpUrl(),
});
export const seoReviewSource = z.object({
  url: z.httpUrl(),
  snapshotId: z.hash("sha256"),
  at: z.iso.datetime(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[a-z]{2}$/),
  rulebook: z.string().min(1),
  demand: z
    .object({
      keyword: z.string().min(1).max(256),
      months: z
        .array(
          z.object({
            period: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
            volume: z.number().int().nonnegative(),
          }),
        )
        .max(36),
    })
    .optional(),
  ranks: z.array(rankedRow.omit({ url: true })).max(500),
});
export type ReviewSource = z.infer<typeof seoReviewSource>;
export const searchTerm = (term: string) =>
  term.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");

/** Retain only rows measured for this URL in the confirmed market. A ranked report can include other URLs. */
export function readReviewSources(raw: unknown): ReviewSource[] | undefined {
  const page = reportObject(raw),
    header = reportObject(page?.header),
    market = reportObject(header?.market);
  const url = reportObject(page?.request)?.url;
  if (!page || !market || market.doubt) return;
  const rankings = reportObject(page.rankingData);
  const ranked = reportObject(rankings?.page),
    rows = reportObject(ranked?.ranked)?.rows;
  const ranks =
    rankings?.source === "DataForSEO Labs and Backlinks API" &&
    ranked?.rankedResult === "ok" &&
    (!ranked.readUrl || ranked.readUrl === url) &&
    Array.isArray(rows)
      ? rows.flatMap((row) => {
          const result = rankedRow.safeParse(row);
          return result.success && result.data.url === url
            ? [{ keyword: result.data.keyword, position: result.data.position }]
            : [];
        })
      : [];
  const vendor = reportObject(page.keywordData),
    facts = reportObject(vendor?.facts);
  const fetchedAt = z.iso.datetime().safeParse(vendor?.fetchedAt);
  const monthly =
    vendor?.dataSource === "dataforseo" &&
    fetchedAt.success &&
    typeof header?.capturedAt === "string" &&
    fetchedAt.data.slice(0, 10) <= header.capturedAt.slice(0, 10)
      ? completeKeywordMonths(facts?.monthly_searches, fetchedAt.data)
      : undefined;
  const source = seoReviewSource.safeParse({
    url,
    at: header?.capturedAt,
    snapshotId: page.snapshotId,
    country: market.country,
    language: market.language,
    rulebook: page.rulebookVersion,
    ...(monthly &&
      typeof facts?.keyword === "string" &&
      facts.keyword.trim().length > 0 &&
      facts.keyword.length <= 256 && {
        demand: { keyword: facts.keyword, months: monthly },
      }),
    ranks,
  });
  return source.success ? [source.data] : undefined;
}

export function uniqueRank(source: ReviewSource, word: string) {
  const values = new Set(
    source.ranks
      .filter((row) => searchTerm(row.keyword) === searchTerm(word))
      .map((row) => row.position),
  );
  return values.size === 1 ? [...values][0] : values.size ? null : undefined;
}
