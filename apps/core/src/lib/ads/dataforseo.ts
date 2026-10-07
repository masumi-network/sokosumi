import { z } from "@hono/zod-openapi";

import {
  ComposioConfigError,
  projectComposioFetch,
  projectComposioResponse,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { getEnv } from "@/config/env";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  invalidToolResponse,
  parseToolRow,
  parseToolRows,
  requireToolRows,
} from "@/lib/ads/composio-tools";
import { tryUseLogger } from "@/lib/evlog";

const DATAFORSEO_API = "https://api.dataforseo.com/v3";
const KEYWORDS_FOR_KEYWORDS =
  "/keywords_data/google_ads/keywords_for_keywords/live";
const SERP_TASK_KINDS = {
  organic: "/serp/google/organic",
  ads_search: "/serp/google/ads_search",
} as const;
export type SerpTaskKind = keyof typeof SERP_TASK_KINDS;
const DATAFORSEO_OK = 20000;
/** A queued task was accepted. */
const TASK_CREATED = 20100;
/** "No Search Results": a task without items, not an error. */
const NO_RESULTS = 40102;
/** A queued task was handed to a worker, or waits in the queue. */
const TASK_PENDING = [40601, 40602];
/** Keyword ideas answer live, often in more than the default timeout. */
const KEYWORDS_TIMEOUT_MS = 60_000;
const MAX_KEYWORDS = 50;
const TREND_MONTHS = 12;
/** Organic results read per keyword; DataForSEO bills per 10. */
const SERP_DEPTH = 10;
const MAX_COMPETITORS = 10;
/** DataForSEO bills ads searches per 40 results. */
const ADS_DEPTH = 40;
const ADS_PER_COMPETITOR = 4;
/**
 * Sites that rank for almost any query and advertise themselves, not the
 * market. Matched by name in any country domain or subdomain.
 */
const PLATFORMS = new Set([
  "amazon",
  "facebook",
  "glassdoor",
  "google",
  "indeed",
  "instagram",
  "linkedin",
  "medium",
  "pinterest",
  "quora",
  "reddit",
  "tiktok",
  "twitter",
  "wikipedia",
  "x",
  "yelp",
  "youtube",
]);
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

export interface MarketQuery {
  keywords: string[];
  locationCode: number;
  languageCode: string;
}

/** A recent ad of a search competitor. Dates are ISO 8601 UTC. */
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
  firstShown: dateTimeSchema.nullable(),
  lastShown: dateTimeSchema.nullable(),
  verified: z.boolean(),
});
export type MarketAd = z.infer<typeof marketAdSchema>;

const envelopeSchema = z.object({
  status_code: z.number().nullish(),
  status_message: z.string().nullish(),
});

const taskSchema = z.object({
  id: z.string().nullish(),
  status_code: z.number(),
  status_message: z.string().nullish(),
  result: z.array(z.unknown()).nullish(),
});

type Task = z.infer<typeof taskSchema>;

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

const proxyResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

/**
 * Calls a DataForSEO endpoint through the Composio proxy on the platform
 * DataForSEO connection. A POST sends `tasks` (live endpoints take one task,
 * `task_post` many). Without the connection configured, raises a
 * {@link ComposioConfigError}.
 */
async function callDataForSeo(
  path: string,
  context: string,
  request: {
    method: "GET" | "POST";
    tasks?: Record<string, unknown>[];
    timeoutMs?: number;
  },
): Promise<Record<string, unknown>> {
  const connectedAccountId = getEnv().COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID;
  if (!connectedAccountId) {
    throw new ComposioConfigError(
      "COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID is not configured for Ads market lookups",
    );
  }
  const response = await projectComposioFetch("/api/v3/tools/execute/proxy", {
    method: "POST",
    jsonBody: {
      endpoint: `${DATAFORSEO_API}${path}`,
      method: request.method,
      connected_account_id: connectedAccountId,
      ...(request.tasks && { body: request.tasks }),
    },
    ...(request.timeoutMs && { timeoutMs: request.timeoutMs }),
  });
  const body = await projectComposioResponse<unknown>(response, context);
  return parseToolRow(body, proxyResponseSchema, context).data;
}

/** The tasks of a response, after checking the envelope. */
function envelopeTasks(
  payload: Record<string, unknown>,
  context: string,
): [Task, ...Task[]] {
  const envelope = parseToolRow(payload, envelopeSchema, context);
  if (envelope.status_code != null && envelope.status_code !== DATAFORSEO_OK) {
    throw refused(envelope.status_code, envelope.status_message);
  }
  const tasks = parseToolRows(
    requireToolRows(payload, "tasks", context),
    taskSchema,
    context,
  );
  const [first, ...rest] = tasks;
  if (!first) throw invalidToolResponse(context);
  return [first, ...rest];
}

/** The tasks of a response, after checking the envelope and every task status. */
function checkedTasks(
  payload: Record<string, unknown>,
  context: string,
): [Task, ...Task[]] {
  const tasks = envelopeTasks(payload, context);
  for (const task of tasks) {
    if (task.status_code !== DATAFORSEO_OK && task.status_code !== NO_RESULTS) {
      throw refused(task.status_code, task.status_message);
    }
  }
  return tasks;
}

const resultSchema = z.object({ items: z.array(z.unknown()).nullish() });

/** The items of every result of the tasks. */
function taskItems(tasks: Task[], context: string): unknown[] {
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
  query: MarketQuery,
): Promise<MarketKeyword[]> {
  const context = "fetch DataForSEO keywords";
  const payload = await callDataForSeo(KEYWORDS_FOR_KEYWORDS, context, {
    method: "POST",
    tasks: [
      {
        keywords: query.keywords,
        location_code: query.locationCode,
        language_code: query.languageCode,
        sort_by: "search_volume",
      },
    ],
    timeoutMs: KEYWORDS_TIMEOUT_MS,
  });
  const [task] = checkedTasks(payload, context);
  return parseToolRows(task.result ?? [], keywordSuggestionSchema, context)
    .map(toMarketKeyword)
    .sort(
      (a, b) =>
        (b.searchVolume ?? Number.NEGATIVE_INFINITY) -
        (a.searchVolume ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, MAX_KEYWORDS);
}

const itemTypeSchema = z.object({ type: z.string().nullish() });
const organicItemSchema = z.object({
  domain: z.string().min(1),
  rank_group: z.number(),
});

/** A domain's best organic position for one keyword. */
export const organicRankSchema = z.object({
  domain: z.string(),
  rank: z.number(),
});
type OrganicRank = z.infer<typeof organicRankSchema>;

function isPlatform(domain: string): boolean {
  return domain
    .split(".")
    .slice(0, -1)
    .some((label) => PLATFORMS.has(label));
}

/**
 * The domains of a keyword's organic results with their best position,
 * platforms aside. `www.` is dropped so a domain counts once.
 */
export function organicRanks(items: unknown[]): OrganicRank[] {
  const context = "read DataForSEO organic results";
  const ranks = new Map<string, number>();
  for (const item of items) {
    if (parseToolRow(item, itemTypeSchema, context).type !== "organic") {
      continue;
    }
    const row = parseToolRow(item, organicItemSchema, context);
    const domain = row.domain.toLowerCase().replace(/^www\./, "");
    if (isPlatform(domain)) continue;
    ranks.set(
      domain,
      Math.min(ranks.get(domain) ?? row.rank_group, row.rank_group),
    );
  }
  return [...ranks].map(([domain, rank]) => ({ domain, rank }));
}

/**
 * The search competitors of the keywords, one result list per keyword: the
 * domains ranking for the most keywords first, then the best position.
 */
export function rankCompetitorDomains(serps: OrganicRank[][]): string[] {
  const competitors = new Map<string, { keywords: number; best: number }>();
  for (const ranks of serps) {
    for (const { domain, rank } of ranks) {
      const seen = competitors.get(domain);
      competitors.set(domain, {
        keywords: (seen?.keywords ?? 0) + 1,
        best: Math.min(seen?.best ?? rank, rank),
      });
    }
  }
  return [...competitors.entries()]
    .sort(([, a], [, b]) => b.keywords - a.keywords || a.best - b.best)
    .slice(0, MAX_COMPETITORS)
    .map(([domain]) => domain);
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

/** DataForSEO SERP keywords want `%` as `%25` and `+` as `%2B`. */
function encodeKeyword(keyword: string): string {
  return keyword.replace(/%/g, "%25").replace(/\+/g, "%2B");
}

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function lastShown(ad: MarketAd): string {
  return ad.lastShown ?? "";
}

function byLastShown(a: MarketAd, b: MarketAd): number {
  return lastShown(b).localeCompare(lastShown(a));
}

/** A competitor's 4 most recently shown ads. */
export function competitorAds(items: unknown[]): MarketAd[] {
  return parseToolRows(items, adSearchItemSchema, "read DataForSEO ads")
    .map(toMarketAd)
    .sort(byLastShown)
    .slice(0, ADS_PER_COMPETITOR);
}

/** The ads of every competitor, a creative once, last shown first. */
export function mergeMarketAds(perCompetitor: MarketAd[][]): MarketAd[] {
  const ads = new Map<string, MarketAd>();
  for (const ad of perCompetitor.flat()) {
    const seen = ads.get(ad.creativeId);
    if (!seen || lastShown(ad) > lastShown(seen)) ads.set(ad.creativeId, ad);
  }
  return [...ads.values()].sort(byLastShown);
}

/**
 * Queues the tasks on a `task_post` endpoint in one request and returns the
 * ids of those DataForSEO accepted. None is no error: if DataForSEO refused
 * every task, retrying will not help, so the refusal is only logged.
 */
async function postTasks(
  kind: SerpTaskKind,
  tasks: Record<string, unknown>[],
  context: string,
): Promise<string[]> {
  const payload = await callDataForSeo(
    `${SERP_TASK_KINDS[kind]}/task_post`,
    context,
    { method: "POST", tasks },
  );
  const posted = envelopeTasks(payload, context);
  const ids = posted.flatMap((task) =>
    task.status_code === TASK_CREATED && task.id ? [task.id] : [],
  );
  if (ids.length === 0) {
    const [first] = posted;
    tryUseLogger()?.set({
      dataforseo: {
        refusedTasks: {
          kind,
          status: first.status_code,
          message: first.status_message,
        },
      },
    });
  }
  return ids;
}

/**
 * Queues one organic SERP task per keyword, all in one request, and returns
 * the ids DataForSEO accepted. Queued tasks are ready in minutes and cost a third of live ones.
 */
export function postSerpTasks(query: MarketQuery): Promise<string[]> {
  return postTasks(
    "organic",
    query.keywords.map((keyword) => ({
      keyword: encodeKeyword(keyword),
      location_code: query.locationCode,
      language_code: query.languageCode,
      depth: SERP_DEPTH,
    })),
    "queue DataForSEO SERPs",
  );
}

/**
 * Queues one Ads Transparency task per domain for the last 30 days in the
 * location, all in one request, and returns their ids.
 */
export function postAdsSearchTasks(
  domains: string[],
  locationCode: number,
  now: Date,
): Promise<string[]> {
  return postTasks(
    "ads_search",
    domains.map((target) => ({
      target,
      location_code: locationCode,
      date_from: utcDate(now.getTime() - ADS_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      date_to: utcDate(now.getTime()),
      depth: ADS_DEPTH,
    })),
    "queue DataForSEO ad searches",
  );
}

type TaskResult =
  | { state: "pending" }
  | { state: "done"; items: unknown[] }
  | { state: "failed" };

/**
 * One queued task's outcome. A task that failed is a result, not an error;
 * only an envelope or proxy failure raises.
 */
export async function getTaskResult(
  kind: SerpTaskKind,
  id: string,
): Promise<TaskResult> {
  const context = "fetch DataForSEO task";
  const payload = await callDataForSeo(
    `${SERP_TASK_KINDS[kind]}/task_get/advanced/${id}`,
    context,
    { method: "GET" },
  );
  const [task] = envelopeTasks(payload, context);
  if (TASK_PENDING.includes(task.status_code)) return { state: "pending" };
  if (task.status_code === DATAFORSEO_OK || task.status_code === NO_RESULTS) {
    return { state: "done", items: taskItems([task], context) };
  }
  return { state: "failed" };
}
