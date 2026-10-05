import { z } from "@hono/zod-openapi";

import { ComposioConfigError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { getEnv } from "@/config/env";
import {
  parseToolRow,
  parseToolRows,
  requireToolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const KEYWORDS_FOR_KEYWORDS = "DATAFORSEO_GET_KW_GOOGLE_ADS_KW_FOR_KW_LIVE";
const DATAFORSEO = { toolkitSlug: "dataforseo", name: "DataForSEO" };
/** Owner of the platform DataForSEO connection. */
const PLATFORM_EXECUTOR_USER_ID = "sokosumi:platform";
const DATAFORSEO_OK = 20000;
const MAX_KEYWORDS = 50;
const TREND_MONTHS = 12;
const COMPETITION_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

/** A market keyword. Money is USD. */
export const marketKeywordSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().nullable(),
  /** The 12 most recent months, oldest to newest; null where DataForSEO has no volume. */
  trend: z.array(
    z.object({
      year: z.number(),
      month: z.number(),
      searchVolume: z.number().nullable(),
    }),
  ),
  competition: z.enum(COMPETITION_LEVELS).nullable(),
  competitionIndex: z.number().nullable(),
  cpc: z.number().nullable(),
  lowTopOfPageBid: z.number().nullable(),
  highTopOfPageBid: z.number().nullable(),
});
export type MarketKeyword = z.infer<typeof marketKeywordSchema>;

export interface MarketKeywordQuery {
  keywords: string[];
  locationCode: number;
  languageCode: string;
}

const envelopeSchema = z.object({
  status_code: z.number().nullish(),
  status_message: z.string().nullish(),
});

const taskSchema = z.object({
  status_code: z.number(),
  status_message: z.string().nullish(),
  result: z.array(z.unknown()).nullish(),
});

const keywordSuggestionSchema = z.object({
  keyword: z.string().min(1),
  search_volume: z.number().nullish(),
  monthly_searches: z
    .array(
      z.object({
        year: z.number(),
        month: z.number(),
        search_volume: z.number().nullish(),
      }),
    )
    .nullish(),
  competition: z.string().nullish(),
  competition_index: z.number().nullish(),
  cpc: z.number().nullish(),
  low_top_of_page_bid: z.number().nullish(),
  high_top_of_page_bid: z.number().nullish(),
});

function toMarketKeyword(
  row: z.infer<typeof keywordSuggestionSchema>,
): MarketKeyword {
  const competition = COMPETITION_LEVELS.find((c) => c === row.competition);
  return {
    keyword: row.keyword,
    searchVolume: row.search_volume ?? null,
    trend: (row.monthly_searches ?? [])
      .map((point) => ({
        year: point.year,
        month: point.month,
        searchVolume: point.search_volume ?? null,
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .slice(-TREND_MONTHS),
    competition: competition ?? null,
    competitionIndex: row.competition_index ?? null,
    cpc: row.cpc ?? null,
    lowTopOfPageBid: row.low_top_of_page_bid ?? null,
    highTopOfPageBid: row.high_top_of_page_bid ?? null,
  };
}

function refused(statusCode: number, statusMessage?: string | null) {
  return new ComposioToolError({
    message: "DataForSEO refused the request",
    providerMessage: statusMessage,
    providerStatus: statusCode,
  });
}

/**
 * Google Ads keyword ideas for the query, at most 50, sorted by search volume
 * (keywords without one last). Runs on the platform DataForSEO connection;
 * without it configured, raises a {@link ComposioConfigError}.
 */
export async function fetchMarketKeywords(
  query: MarketKeywordQuery,
): Promise<MarketKeyword[]> {
  const connectedAccountId = getEnv().COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID;
  if (!connectedAccountId) {
    throw new ComposioConfigError(
      "COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID is not configured for Ads market lookups",
    );
  }
  const context = "fetch DataForSEO keywords";
  const payload = await withAdsToolSession(
    {
      connectedAccountId,
      executorUserId: PLATFORM_EXECUTOR_USER_ID,
      toolkit: DATAFORSEO,
      label: "platform DataForSEO",
      toolSlugs: [KEYWORDS_FOR_KEYWORDS],
    },
    (execute) =>
      execute(KEYWORDS_FOR_KEYWORDS, {
        keywords: query.keywords,
        location_code: query.locationCode,
        language_code: query.languageCode,
        sort_by: "search_volume",
      }),
  );
  const envelope = parseToolRow(payload, envelopeSchema, context);
  if (envelope.status_code != null && envelope.status_code !== DATAFORSEO_OK) {
    throw refused(envelope.status_code, envelope.status_message);
  }
  const [row] = requireToolRows(payload, "tasks", context);
  const task = parseToolRow(row, taskSchema, context);
  if (task.status_code !== DATAFORSEO_OK) {
    throw refused(task.status_code, task.status_message);
  }
  return parseToolRows(task.result ?? [], keywordSuggestionSchema, context)
    .map(toMarketKeyword)
    .sort(
      (a, b) =>
        (b.searchVolume ?? Number.NEGATIVE_INFINITY) -
        (a.searchVolume ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, MAX_KEYWORDS);
}
