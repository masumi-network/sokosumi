import { z } from "@hono/zod-openapi";
import {
  SEO_AUDIT_IDEA_LIMIT,
  seoConversionSchema,
  seoDeviceSchema,
} from "@/schemas/project-seo.schema";
import {
  seoEstimateReasonFields,
  seoFitSchema,
  seoIntentClassSchema,
} from "@/schemas/project-seo-keyword-estimate.schema";
import type { LegacySeoReport } from "./project-seo-legacy-report";
import { omitUndefinedProperties } from "./project-seo-public-report";
import type { PublicSeoPayload } from "./project-seo-report";

export const FEATURE_CHARS = 200;
// DataForSEO keyword_difficulty: 0 to 100. A value Core cannot read is dropped: it must not fail the import.
export const difficulty = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .nullable()
  .optional()
  .catch(undefined);

// A page Report's estimate for a keyword. A value Core cannot read is dropped: it must not fail the import.
export const estimate = {
  conversion: seoConversionSchema.optional().catch(undefined),
  feature: z
    .string()
    .trim()
    .min(1)
    .max(FEATURE_CHARS)
    .optional()
    .catch(undefined),
  intentClass: seoIntentClassSchema.optional().catch(undefined),
  fit: seoFitSchema.optional().catch(undefined),
};
// The estimate as a stored check holds it.
export const storedEstimate = {
  conversion: seoConversionSchema.nullable().optional(),
  feature: z.string().max(FEATURE_CHARS).nullable().optional(),
  ...seoEstimateReasonFields,
};
/** The estimate fields, for a result that carries no estimate. */
export const ESTIMATE_KEYS = {
  conversion: true,
  feature: true,
  intentClass: true,
  fit: true,
} as const;
type Estimate = z.infer<z.ZodObject<typeof estimate>>;
/** The estimate fields a Report row has. A field the row does not have stays absent. */
const estimateOf = ({ conversion, feature, intentClass, fit }: Estimate) =>
  omitUndefinedProperties({ conversion, feature, intentClass, fit });

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
          ...estimateOf(row),
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
  const broad = !!result.keywordOpportunities?.editorialResearch;
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
      ...(broad && { ideaRank: null }),
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  const ideas = result.keywordOpportunities?.list ?? [];
  const eligible = broad ? ideas.slice(0, SEO_AUDIT_IDEA_LIMIT) : ideas;
  for (const [index, row] of eligible.entries())
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
      ...estimateOf(row),
      ...(row.editorial && { editorial: row.editorial }),
      source: "opportunity",
      ...(broad && { ideaRank: index + 1 }),
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  return keywords;
}
