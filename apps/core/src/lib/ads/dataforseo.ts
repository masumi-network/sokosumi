import { z } from "@hono/zod-openapi";

import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { getEnv } from "@/config/env";
import {
  type ExecuteAdsTool,
  parseToolRow,
  parseToolRows,
  requireToolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const KEYWORDS_FOR_KEYWORDS = "DATAFORSEO_GET_KW_GOOGLE_ADS_KW_FOR_KW_LIVE";
const ADS_ADVERTISERS =
  "DATAFORSEO_GET_SERP_GOOGLE_ADS_ADVERTISERS_LIVE_ADVANCED";
const ADS_SEARCH = "DATAFORSEO_GET_SERP_GOOGLE_ADS_SEARCH_LIVE_ADVANCED";
const DATAFORSEO = { toolkitSlug: "dataforseo", name: "DataForSEO" };
/** Owner of the platform DataForSEO connection. */
const PLATFORM_EXECUTOR_USER_ID = "sokosumi:platform";
const DATAFORSEO_OK = 20000;
const MAX_KEYWORDS = 50;
const TREND_MONTHS = 12;
const MAX_ADVERTISER_KEYWORD_LENGTH = 70;
const MAX_ADVERTISERS = 25;
const ADS_DEPTH = 40;
const MAX_ADS = 40;
const ADS_WINDOW_DAYS = 30;
const AD_FORMATS = ["text", "image", "video"] as const;
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

/** A recent ad of a market advertiser. Dates are ISO 8601 UTC. */
export const marketAdSchema = z.object({
  creativeId: z.string(),
  advertiserId: z.string(),
  advertiserName: z.string(),
  format: z.enum([...AD_FORMATS, "other"]),
  /** Google-hosted image; always https. */
  previewImage: z
    .object({
      url: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
    })
    .nullable(),
  /** The ad on Google's Ads Transparency Center; always https. */
  previewUrl: z.string().nullable(),
  firstShown: z.string().nullable(),
  lastShown: z.string().nullable(),
  verified: z.boolean(),
});
export type MarketAd = z.infer<typeof marketAdSchema>;

export interface MarketAdQuery {
  keywords: string[];
  locationCode: number;
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

/** Runs `run` on the platform DataForSEO connection; without it configured, raises a {@link ComposioConfigError}. */
function withPlatformDataForSeo<T>(
  toolSlugs: readonly string[],
  run: (execute: ExecuteAdsTool) => Promise<T>,
): Promise<T> {
  const connectedAccountId = getEnv().COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID;
  if (!connectedAccountId) {
    throw new ComposioConfigError(
      "COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID is not configured for Ads market lookups",
    );
  }
  return withAdsToolSession(
    {
      connectedAccountId,
      executorUserId: PLATFORM_EXECUTOR_USER_ID,
      toolkit: DATAFORSEO,
      label: "platform DataForSEO",
      toolSlugs,
    },
    run,
  );
}

/** The tasks of a response, after checking the envelope and every task status. */
function checkedTasks(
  payload: Record<string, unknown> | null,
  context: string,
): z.infer<typeof taskSchema>[] {
  const envelope = parseToolRow(payload, envelopeSchema, context);
  if (envelope.status_code != null && envelope.status_code !== DATAFORSEO_OK) {
    throw refused(envelope.status_code, envelope.status_message);
  }
  const tasks = parseToolRows(
    requireToolRows(payload, "tasks", context),
    taskSchema,
    context,
  );
  if (tasks.length === 0) {
    throw new ComposioApiError(
      502,
      undefined,
      `${context} returned an invalid response`,
    );
  }
  for (const task of tasks) {
    if (task.status_code !== DATAFORSEO_OK) {
      throw refused(task.status_code, task.status_message);
    }
  }
  return tasks;
}

const resultSchema = z.object({ items: z.array(z.unknown()).nullish() });

/** The items of every result of the tasks. */
function taskItems(
  tasks: z.infer<typeof taskSchema>[],
  context: string,
): unknown[] {
  return tasks.flatMap((task) =>
    parseToolRows(task.result ?? [], resultSchema, context).flatMap(
      (result) => result.items ?? [],
    ),
  );
}

/**
 * Google Ads keyword ideas for the query, at most 50, sorted by search volume
 * (keywords without one last). Runs on the platform DataForSEO connection;
 * without it configured, raises a {@link ComposioConfigError}.
 */
export async function fetchMarketKeywords(
  query: MarketKeywordQuery,
): Promise<MarketKeyword[]> {
  const context = "fetch DataForSEO keywords";
  const payload = await withPlatformDataForSeo(
    [KEYWORDS_FOR_KEYWORDS],
    (execute) =>
      execute(KEYWORDS_FOR_KEYWORDS, {
        keywords: query.keywords,
        location_code: query.locationCode,
        language_code: query.languageCode,
        sort_by: "search_volume",
      }),
  );
  const [task] = checkedTasks(payload, context);
  return parseToolRows(task?.result ?? [], keywordSuggestionSchema, context)
    .map(toMarketKeyword)
    .sort(
      (a, b) =>
        (b.searchVolume ?? Number.NEGATIVE_INFINITY) -
        (a.searchVolume ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, MAX_KEYWORDS);
}

const itemTypeSchema = z.object({ type: z.string().nullish() });
const advertiserRefSchema = z.object({
  advertiser_id: z.string().min(1),
  approx_ads_count: z.number().nullish(),
});
const multiAccountAdvertiserSchema = z.object({
  approx_ads_count: z.number().nullish(),
  advertisers: z.array(advertiserRefSchema).nullish(),
});

/**
 * Advertiser ids by approximate ad count, largest first. Multi-account
 * advertisers count as their accounts; domain items are ignored.
 */
function rankAdvertiserIds(items: unknown[], context: string): string[] {
  const counts = new Map<string, number>();
  const add = (id: string, count: number | null | undefined) =>
    counts.set(id, Math.max(counts.get(id) ?? 0, count ?? 0));
  for (const item of items) {
    const { type } = parseToolRow(item, itemTypeSchema, context);
    if (type === "ads_advertiser") {
      const row = parseToolRow(item, advertiserRefSchema, context);
      add(row.advertiser_id, row.approx_ads_count);
    } else if (type === "ads_multi_account_advertiser") {
      const group = parseToolRow(item, multiAccountAdvertiserSchema, context);
      for (const row of group.advertisers ?? []) {
        add(row.advertiser_id, row.approx_ads_count ?? group.approx_ads_count);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ADVERTISERS)
    .map(([id]) => id);
}

const adSearchItemSchema = z.object({
  creative_id: z.string().min(1),
  advertiser_id: z.string().min(1),
  title: z.string().nullish(),
  format: z.string().nullish(),
  preview_image: z
    .object({
      url: z.string().nullish(),
      width: z.number().nullish(),
      height: z.number().nullish(),
    })
    .nullish(),
  url: z.string().nullish(),
  first_shown: z.string().nullish(),
  last_shown: z.string().nullish(),
  verified: z.boolean().nullish(),
});

function httpsUrl(url: string | null | undefined): string | null {
  return url?.startsWith("https://") ? url : null;
}

/** DataForSEO dates look like `2026-09-30 10:30:00 +00:00`. */
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(
    value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) /, "$1T$2"),
  );
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function toMarketAd(row: z.infer<typeof adSearchItemSchema>): MarketAd {
  const imageUrl = httpsUrl(row.preview_image?.url);
  return {
    creativeId: row.creative_id,
    advertiserId: row.advertiser_id,
    advertiserName: row.title ?? "",
    format: AD_FORMATS.find((f) => f === row.format) ?? "other",
    previewImage: imageUrl
      ? {
          url: imageUrl,
          width: row.preview_image?.width ?? null,
          height: row.preview_image?.height ?? null,
        }
      : null,
    previewUrl: httpsUrl(row.url),
    firstShown: toIsoDate(row.first_shown),
    lastShown: toIsoDate(row.last_shown),
    verified: row.verified ?? false,
  };
}

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Recent Google ads of the advertisers running ads for the query's keywords:
 * the 25 biggest advertisers' ads of the last 30 days, at most 40, newest
 * last-shown first. No advertisers means no ads, without a second call. Runs
 * on the platform DataForSEO connection; without it configured, raises a
 * {@link ComposioConfigError}.
 */
export async function fetchMarketAds(
  query: MarketAdQuery,
): Promise<MarketAd[]> {
  const context = "fetch DataForSEO ads";
  const now = Date.now();
  const rows = await withPlatformDataForSeo(
    [ADS_ADVERTISERS, ADS_SEARCH],
    async (execute) => {
      const advertisers = await execute(ADS_ADVERTISERS, {
        tasks: query.keywords.map((keyword) => ({
          keyword: keyword.slice(0, MAX_ADVERTISER_KEYWORD_LENGTH),
          location_code: query.locationCode,
        })),
      });
      const advertiserIds = rankAdvertiserIds(
        taskItems(checkedTasks(advertisers, context), context),
        context,
      );
      if (advertiserIds.length === 0) return [];
      const search = await execute(ADS_SEARCH, {
        advertiser_ids: advertiserIds,
        location_code: query.locationCode,
        date_from: utcDate(now - ADS_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        date_to: utcDate(now),
        depth: ADS_DEPTH,
      });
      return taskItems(checkedTasks(search, context), context);
    },
  );
  const ads = new Map<string, MarketAd>();
  for (const row of parseToolRows(rows, adSearchItemSchema, context)) {
    if (!ads.has(row.creative_id)) ads.set(row.creative_id, toMarketAd(row));
  }
  return [...ads.values()]
    .sort((a, b) => (b.lastShown ?? "").localeCompare(a.lastShown ?? ""))
    .slice(0, MAX_ADS);
}
