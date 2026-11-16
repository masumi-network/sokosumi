import { seoDeviceSchema } from "@/schemas/project-seo.schema";
import type { LegacySeoReport, PublicSeoPayload } from "./project-seo-report";

const keywordKey = (keyword: string) => keyword.normalize("NFKC").toLowerCase();

/** The keyword rows of the SEO bot's Report: its focus set per device, the page's ranked rows, its gaps and its ideas. */
export function legacyReportKeywords(
  result: LegacySeoReport,
  pageUrl: string,
  at: string,
): PublicSeoPayload["keywords"] {
  // A focus keyword and a gap carry no difficulty of their own: they take the one another row of the Report gives.
  const difficulties = new Map<string, number>();
  for (const row of [
    ...(result.rankingData?.page?.ranked?.rows ?? []),
    ...(result.keywordOpportunities?.list ?? []),
    ...(result.keywordData ? [result.keywordData.facts] : []).map((facts) => ({
      keyword: facts.keyword,
      difficulty: facts.keyword_difficulty,
    })),
  ])
    if (
      row.keyword &&
      typeof row.difficulty === "number" &&
      !difficulties.has(keywordKey(row.keyword))
    )
      difficulties.set(keywordKey(row.keyword), row.difficulty);
  const difficultyOf = (word: string) =>
    difficulties.get(keywordKey(word)) ?? null;
  const keywords: PublicSeoPayload["keywords"] =
    result.header.focusKeywords.flatMap((row) =>
      ["mobile", "desktop"].map((device) => {
        const d = seoDeviceSchema.parse(device),
          position = row.position[d],
          note = row.positionNote[d];
        return {
          keyword: row.keyword,
          pageUrl,
          device: d,
          position,
          positionStatus:
            position !== null
              ? ("ranked" as const)
              : note?.startsWith("not in the top")
                ? ("not_in_range" as const)
                : ("unavailable" as const),
          checkedResults: note?.match(/top (\d+)/)?.[1]
            ? Number(note.match(/top (\d+)/)?.[1])
            : null,
          volume: row.volume,
          difficulty: difficultyOf(row.keyword),
          intent: row.intent,
          conversion: row.conversion,
          feature: row.feature,
          source: "focus",
          sourceRef: result.snapshotId,
          observedAt: at,
        };
      }),
    );
  for (const row of result.rankingData?.page?.ranked?.rows ?? [])
    if (row.keyword)
      keywords.push({
        keyword: row.keyword,
        pageUrl,
        device: null,
        position: row.position,
        positionStatus: row.position === null ? "unavailable" : "ranked",
        checkedResults: null,
        volume: row.volume,
        difficulty: row.difficulty ?? null,
        intent: row.intent,
        source: "ranked",
        sourceRef: result.snapshotId,
        observedAt: at,
      });
  for (const row of result.rankingData?.gaps ?? [])
    keywords.push({
      keyword: row.keyword,
      pageUrl,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      volume: row.bestVolume,
      difficulty: difficultyOf(row.keyword),
      intent: null,
      source: "gap",
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  for (const row of result.keywordOpportunities?.list ?? [])
    keywords.push({
      keyword: row.keyword,
      pageUrl,
      device: null,
      position: row.position,
      positionStatus: row.position === null ? "unavailable" : "ranked",
      checkedResults: null,
      volume: row.volume,
      difficulty: row.difficulty ?? null,
      intent: row.intent,
      conversion: row.conversion,
      feature: row.feature,
      source: "opportunity",
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  return keywords;
}
