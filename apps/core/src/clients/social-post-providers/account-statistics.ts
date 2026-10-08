import { z } from "@hono/zod-openapi";
import {
  type SocialPostProvider,
  socialPostProviderLabel,
} from "@sokosumi/utils";

import {
  ComposioApiError,
  deleteProjectSocialSession,
  projectComposioFetch,
  projectComposioResponse,
  record,
} from "@/clients/composio.client";
import {
  ComposioToolError,
  createSocialPostToolSession,
  executeSocialPostTool,
} from "@/clients/social-post-providers/tools";
import type { SocialAccountMetric } from "@/schemas/social-account-statistics.schema";
import type { SocialPostMetrics } from "@/schemas/social-post-statistics.schema";

export interface SocialAccountStatisticsContext {
  provider: SocialPostProvider;
  connectedAccountId: string;
  executorUserId: string;
  externalAccountId: string;
  externalHandle: string | null;
  cursor: string | null;
  includeProfile: boolean;
  signal?: AbortSignal;
}
interface AccountPost {
  externalId: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
  metrics: SocialPostMetrics;
  additionalMetrics: SocialAccountMetric[];
}
interface AccountPage {
  accountMetrics: SocialAccountMetric[] | null;
  accountError: string | null;
  posts: AccountPost[];
  nextCursor: string | null;
  historyError: string | null;
  metricWarning: string | null;
}
type ReadTool = (
  slug: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;

function statisticsFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof ComposioToolError && error.providerMessage) {
    return `${fallback} ${error.providerMessage}`;
  }
  if (error instanceof ComposioApiError) {
    return `${fallback} Connector request failed (HTTP ${error.httpStatus}).`;
  }
  return fallback;
}

// Exact slugs/inputs verified in Composio's official embedded toolkit schemas.
const TOOLS = {
  x: ["TWITTER_USER_LOOKUP_ME"],
  instagram: [
    "INSTAGRAM_GET_USER_INFO",
    "INSTAGRAM_GET_USER_INSIGHTS",
    "INSTAGRAM_GET_IG_USER_MEDIA",
    "INSTAGRAM_GET_IG_MEDIA_INSIGHTS",
  ],
  facebook: [
    "FACEBOOK_GET_PAGE_DETAILS",
    "FACEBOOK_GET_PAGE_INSIGHTS",
    "FACEBOOK_GET_POST_INSIGHTS",
  ],
  youtube: [
    "YOUTUBE_LIST_CHANNELS",
    "YOUTUBE_QUERY_ANALYTICS",
    "YOUTUBE_LIST_CHANNEL_VIDEOS",
    "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
  ],
  tiktok: [
    "TIKTOK_GET_USER_STATS",
    "TIKTOK_LIST_VIDEOS",
    "TIKTOK_QUERY_VIDEOS",
  ],
  linkedin: ["LINKEDIN_GET_MY_INFO"],
};
// Current version in Meta’s official facebook-python-business-sdk/apiconfig.py.
const FACEBOOK_GRAPH_VERSION = "v26.0";

function number(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value)
      : value;
  return typeof parsed === "number" &&
    Number.isFinite(parsed) &&
    Math.abs(parsed) <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}
function counter(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}
function metrics(): SocialPostMetrics {
  return {
    views: null,
    impressions: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
  };
}
function metric(
  key: string,
  value: unknown,
  period: string | null = "lifetime",
  unit: string | null = "count",
): SocialAccountMetric {
  return { key, value: number(value), period, unit };
}
function counts(
  data: Record<string, unknown> | null,
  keys: string[],
): SocialAccountMetric[] {
  return keys.map((key) => metric(key, counter(data?.[key])));
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function cursor(value: unknown): string | null {
  const parsed = string(value);
  // Tokens are data, never a URL or query. Provider tokens use URL-safe/base64 alphabets.
  return parsed &&
    parsed.length <= 9000 &&
    /^[A-Za-z0-9_=.~+\/-]+$/.test(parsed)
    ? parsed
    : null;
}
function date(value: unknown): string | null {
  // Graph dates can use +0000; normalize that offset before ISO validation.
  if (typeof value === "string")
    value = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (
    typeof value !== "string" ||
    !z.iso.datetime({ offset: true }).safeParse(value).success
  )
    return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function epoch(value: unknown): string | null {
  const parsed = counter(value);
  if (parsed === null) return null;
  const result = new Date(parsed * 1000);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}
function url(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      ![...parsed.searchParams.keys()].some((key) =>
        /^(access_token|refresh_token|authorization|api_key)$/i.test(key),
      )
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(record)
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
}
function post(
  item: Record<string, unknown>,
  text: unknown,
  publishedAt: string | null,
  link: unknown,
): AccountPost | null {
  const id = string(item.id);
  return id && id.length <= 500
    ? {
        externalId: id,
        text: typeof text === "string" ? text : "",
        publishedAt,
        url: url(link),
        metrics: metrics(),
        additionalMetrics: [],
      }
    : null;
}
function requiredList(
  data: Record<string, unknown> | null,
  key: string,
  max = 100,
): Record<string, unknown>[] {
  if (
    !Array.isArray(data?.[key]) ||
    data[key].length > max ||
    data[key].some((item: unknown) => record(item) === null)
  )
    throw new TypeError("Invalid statistics response");
  return objects(data[key]);
}
function insights(data: Record<string, unknown> | null): SocialAccountMetric[] {
  const result: SocialAccountMetric[] = [];
  for (const item of requiredList(data, "data")) {
    const name = string(item.name);
    if (!name || name.length > 100) continue;
    const total = record(item.total_value);
    if (total)
      result.push(metric(name, total.value, string(item.period), "count"));
    else
      for (const itemValue of objects(item.values)) {
        const end = date(itemValue.end_time);
        result.push(
          metric(
            name,
            itemValue.value,
            end
              ? `${string(item.period) ?? "day"}:${end}`
              : string(item.period),
            "count",
          ),
        );
      }
  }
  return result.slice(0, 80);
}

function windowInsights(
  data: Record<string, unknown> | null,
): SocialAccountMetric[] {
  return requiredList(data, "data").flatMap((item) => {
    const name = string(item.name);
    if (!name || name.length > 100) return [];
    const values = objects(item.values).map((value) => number(value.value));
    const sum =
      values.length && values.every((value) => value !== null)
        ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
        : null;
    return [metric(name, sum, "sum_daily_last_28_days")];
  });
}

/** Fixed read-only native endpoints where toolkit inputs cannot paginate. No caller endpoint/header is accepted.
 * https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy
 */
class ProxyDomainMismatchError extends TypeError {}

async function readNativeHistory(
  context: SocialAccountStatisticsContext,
): Promise<Record<string, unknown>> {
  if (
    !/^[0-9]+$/.test(context.externalAccountId) ||
    (context.cursor !== null && cursor(context.cursor) === null)
  )
    throw new TypeError("Invalid statistics account or cursor");
  const isX = context.provider === "x";
  if (!isX && context.provider !== "facebook")
    throw new TypeError("Unsupported native statistics endpoint");
  const endpoint = isX
    ? `https://api.x.com/2/users/${context.externalAccountId}/tweets`
    : `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${context.externalAccountId}/posts`;
  const parameters = isX
    ? [
        { name: "max_results", value: "100", type: "query" },
        {
          name: "post.fields",
          value: "created_at,public_metrics,note_post",
          type: "query",
        },
      ]
    : [
        { name: "limit", value: "10", type: "query" },
        {
          name: "fields",
          value:
            "id,message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true),is_published",
          type: "query",
        },
      ];
  if (context.cursor)
    parameters.push({
      name: isX ? "pagination_token" : "after",
      value: context.cursor,
      type: "query",
    });
  const request = async (target: string) => {
    const response = await projectComposioFetch(
      "/api/v3.1/tools/execute/proxy",
      {
        method: "POST",
        signal: context.signal,
        jsonBody: {
          connected_account_id: context.connectedAccountId,
          endpoint: target,
          method: "GET",
          parameters,
        },
      },
    );
    if (isX && [400, 403, 422].includes(response.status)) {
      const detail = await response.clone().text();
      if (
        /(same[- ]domain|cross[- ]domain|domain.{0,100}(match|allowed|mismatch)|(?:match|allowed).{0,100}domain)/i.test(
          detail,
        )
      )
        throw new ProxyDomainMismatchError("Proxy toolkit domain mismatch");
    }
    return projectComposioResponse<{ status?: number; data?: unknown }>(
      response,
      "read account published history",
    );
  };
  let result: { status?: number; data?: unknown };
  try {
    result = await request(endpoint);
  } catch (error) {
    context.signal?.throwIfAborted();
    // Composio rejects hosts outside the toolkit's configured domain. Older
    // Twitter auth configs use twitter.com; retry only this fixed trusted alias
    // and only on the proxy's domain-validation rejection, never API failures.
    if (!isX || !(error instanceof ProxyDomainMismatchError)) throw error;
    result = await request(
      `https://api.twitter.com/2/users/${context.externalAccountId}/tweets`,
    );
  }
  const data = record(result.data);
  if (
    result.status !== 200 ||
    !data ||
    data.error ||
    (Array.isArray(data.errors) && data.errors.length)
  )
    throw new TypeError("Account history unavailable");
  return data;
}

async function profile(
  context: SocialAccountStatisticsContext,
  read: ReadTool,
  result: AccountPage,
) {
  switch (context.provider) {
    case "x": {
      const data = await read("TWITTER_USER_LOOKUP_ME", {
        user_fields: ["public_metrics"],
      });
      if (data?.id !== context.externalAccountId)
        throw new TypeError("Connected identity mismatch");
      const publicMetrics = record(data.public_metrics);
      result.accountMetrics = counts(
        {
          ...publicMetrics,
          post_count: publicMetrics?.post_count ?? publicMetrics?.tweet_count,
          posts_liked_count: publicMetrics?.like_count,
        },
        [
          "followers_count",
          "following_count",
          "post_count",
          "listed_count",
          "media_count",
          "posts_liked_count",
        ],
      );
      break;
    }
    case "instagram": {
      const data = await read("INSTAGRAM_GET_USER_INFO", {
        ig_user_id: context.externalAccountId,
        fields: "id,followers_count,follows_count,media_count",
      });
      result.accountMetrics = counts(data, [
        "followers_count",
        "follows_count",
        "media_count",
      ]);
      try {
        result.accountMetrics.push(
          ...insights(
            await read("INSTAGRAM_GET_USER_INSIGHTS", {
              ig_user_id: context.externalAccountId,
              metric: [
                "reach",
                "views",
                "accounts_engaged",
                "total_interactions",
                "likes",
                "comments",
                "shares",
                "saves",
                "replies",
                "profile_links_taps",
                "reposts",
              ],
              period: "day",
              metric_type: "total_value",
              since: Math.floor(Date.now() / 1000) - 28 * 86400,
              until: Math.floor(Date.now() / 1000),
            }),
          ).map((item) => ({ ...item, period: "last_28_days" })),
        );
      } catch {
        context.signal?.throwIfAborted();
        result.accountError =
          "Instagram account insights are unavailable. Profile totals are still available.";
      }
      break;
    }
    case "facebook": {
      result.accountMetrics = counts(
        await read("FACEBOOK_GET_PAGE_DETAILS", {
          page_id: context.externalAccountId,
          fields: "id,fan_count,followers_count",
        }),
        ["fan_count", "followers_count"],
      );
      try {
        result.accountMetrics.push(
          ...windowInsights(
            await read("FACEBOOK_GET_PAGE_INSIGHTS", {
              page_id: context.externalAccountId,
              metrics:
                "page_media_view,page_post_engagements,page_video_views,page_daily_follows_unique,page_daily_unfollows_unique,page_total_actions,page_total_media_view_unique",
              period: "day",
              since: new Date(Date.now() - 28 * 86400000)
                .toISOString()
                .slice(0, 10),
              until: new Date().toISOString().slice(0, 10),
            }),
          ),
        );
      } catch {
        context.signal?.throwIfAborted();
        result.accountError =
          "Facebook account insights are unavailable. Profile totals are still available.";
      }
      break;
    }
    case "youtube": {
      const channel = requiredList(
        await read("YOUTUBE_LIST_CHANNELS", {
          id: context.externalAccountId,
          part: "snippet,statistics",
        }),
        "items",
      ).find((item) => item.id === context.externalAccountId);
      if (!channel) throw new TypeError("Channel unavailable");
      const statistics = record(channel.statistics);
      result.accountMetrics = counts(statistics, ["viewCount", "videoCount"]);
      result.accountMetrics.push(
        metric(
          "subscriberCount",
          statistics?.hiddenSubscriberCount === true
            ? null
            : counter(statistics?.subscriberCount),
        ),
      );
      const startDate = date(record(channel.snippet)?.publishedAt)?.slice(
        0,
        10,
      );
      if (startDate)
        try {
          const endDate = new Date().toISOString().slice(0, 10);
          const data = await read("YOUTUBE_QUERY_ANALYTICS", {
            ids: `channel==${context.externalAccountId}`,
            startDate,
            endDate,
            metrics:
              "views,likes,dislikes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
            maxResults: 1,
          });
          const headers = requiredList(data, "columnHeaders");
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          const values: unknown[] = Array.isArray(rows[0]) ? rows[0] : [];
          headers.forEach((header, index) => {
            const name = string(header.name);
            if (name && name.length <= 100)
              result.accountMetrics?.push(
                metric(
                  name,
                  values[index],
                  `${startDate}/${endDate}`,
                  name === "estimatedMinutesWatched"
                    ? "minutes"
                    : name === "averageViewDuration"
                      ? "seconds"
                      : name === "averageViewPercentage"
                        ? "percent"
                        : "count",
                ),
              );
          });
        } catch {
          context.signal?.throwIfAborted();
          result.accountError =
            "YouTube Analytics is unavailable. Channel totals are still available.";
        }
      break;
    }
    case "tiktok": {
      const data = await read("TIKTOK_GET_USER_STATS", {
        fields: [
          "follower_count",
          "following_count",
          "likes_count",
          "video_count",
        ],
      });
      result.accountMetrics = counts(record(data?.user) ?? data, [
        "follower_count",
        "following_count",
        "likes_count",
        "video_count",
      ]);
      break;
    }
    case "linkedin": {
      await read("LINKEDIN_GET_MY_INFO", {});
      result.accountMetrics = [];
      result.accountError =
        "LinkedIn personal account statistics are not available through this connection.";
      break;
    }
  }
  if (
    result.accountMetrics?.length &&
    result.accountMetrics.every((item) => item.value === null)
  ) {
    result.accountMetrics = null;
    result.accountError = `${socialPostProviderLabel(context.provider)} account totals are unavailable. Check the connection permissions.`;
  }
}

async function history(
  context: SocialAccountStatisticsContext,
  read: ReadTool,
  result: AccountPage,
  mediaTypes: Map<string, string>,
) {
  if (context.cursor !== null && cursor(context.cursor) === null)
    throw new TypeError("Invalid history cursor");
  switch (context.provider) {
    case "x": {
      const data = await readNativeHistory(context);
      if (data.data === undefined && record(data.meta)?.result_count === 0)
        data.data = [];
      for (const item of requiredList(data, "data")) {
        if (
          item.author_id !== undefined &&
          item.author_id !== context.externalAccountId
        )
          continue;
        const entry = post(
          item,
          record(item.note_post)?.text ??
            record(item.note_tweet)?.text ??
            item.text,
          date(item.created_at),
          `https://x.com/i/status/${string(item.id) ?? ""}`,
        );
        if (!entry) continue;
        const count = record(item.public_metrics);
        entry.metrics = {
          ...metrics(),
          impressions: counter(count?.impression_count),
          likes: counter(count?.like_count),
          comments: counter(count?.reply_count),
          shares: counter(count?.repost_count ?? count?.retweet_count),
          saves: counter(count?.bookmark_count),
        };
        entry.additionalMetrics = counts(count, ["quote_count"]);
        result.posts.push(entry);
      }
      result.nextCursor = cursor(record(data.meta)?.next_token);
      if (record(data.meta)?.next_token && !result.nextCursor)
        throw new TypeError("Invalid history pagination");
      break;
    }
    case "facebook": {
      const data = await readNativeHistory(context);
      for (const item of requiredList(data, "data", 10)) {
        if (
          item.is_published === false ||
          !string(item.id)?.startsWith(`${context.externalAccountId}_`)
        )
          continue;
        const entry = post(
          item,
          item.message,
          date(item.created_time),
          item.permalink_url,
        );
        if (!entry) continue;
        entry.metrics.likes = counter(
          record(record(item.reactions)?.summary)?.total_count,
        );
        entry.metrics.comments = counter(
          record(record(item.comments)?.summary)?.total_count,
        );
        entry.metrics.shares = counter(record(item.shares)?.count);
        result.posts.push(entry);
      }
      const paging = record(data.paging);
      if (paging?.next) {
        result.nextCursor = cursor(record(paging.cursors)?.after);
        if (!result.nextCursor)
          throw new TypeError("Invalid history pagination");
      }
      break;
    }
    case "instagram": {
      const data = await read("INSTAGRAM_GET_IG_USER_MEDIA", {
        ig_user_id: context.externalAccountId,
        limit: 10,
        fields:
          "id,caption,timestamp,permalink,like_count,comments_count,media_product_type",
        ...(context.cursor ? { after: context.cursor } : {}),
      });
      for (const item of requiredList(data, "data", 10)) {
        const entry = post(
          item,
          item.caption,
          date(item.timestamp),
          item.permalink,
        );
        if (!entry) continue;
        if (typeof item.media_product_type === "string")
          mediaTypes.set(entry.externalId, item.media_product_type);
        entry.metrics.likes = counter(item.like_count);
        entry.metrics.comments = counter(item.comments_count);
        result.posts.push(entry);
      }
      const paging = record(data?.paging);
      if (paging?.next) {
        result.nextCursor = cursor(record(paging.cursors)?.after);
        if (!result.nextCursor)
          throw new TypeError("Invalid history pagination");
      }
      break;
    }
    case "youtube": {
      const data = await read("YOUTUBE_LIST_CHANNEL_VIDEOS", {
        channelId: context.externalAccountId,
        part: "snippet,contentDetails",
        maxResults: 50,
        ...(context.cursor ? { pageToken: context.cursor } : {}),
      });
      const listed = requiredList(data, "items", 50);
      const entries = listed.flatMap((item) => {
        const snippet = record(item.snippet);
        const id = string(record(snippet?.resourceId)?.videoId);
        if (
          !id ||
          (snippet?.videoOwnerChannelId !== undefined &&
            snippet.videoOwnerChannelId !== context.externalAccountId)
        )
          return [];
        const entry = post(
          { id },
          snippet?.description ?? snippet?.title,
          date(record(item.contentDetails)?.videoPublishedAt),
          `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
        );
        return entry ? [entry] : [];
      });
      const ids = entries.map((entry) => entry.externalId);
      if (ids.length)
        try {
          const details = requiredList(
            await read("YOUTUBE_GET_VIDEO_DETAILS_BATCH", {
              id: ids,
              parts: ["snippet", "statistics", "contentDetails"],
            }),
            "items",
            50,
          );
          for (const entry of entries) {
            const detail = details.find((item) => item.id === entry.externalId);
            const snippet = record(detail?.snippet);
            if (!detail || snippet?.channelId !== context.externalAccountId)
              continue;
            entry.text =
              typeof snippet.description === "string"
                ? snippet.description
                : typeof snippet.title === "string"
                  ? snippet.title
                  : entry.text;
            entry.publishedAt = date(snippet.publishedAt) ?? entry.publishedAt;
            const count = record(detail.statistics);
            entry.metrics.views = counter(count?.viewCount);
            entry.metrics.likes = counter(count?.likeCount);
            entry.metrics.comments = counter(count?.commentCount);
            entry.additionalMetrics = counts(count, ["dislikeCount"]);
          }
        } catch {
          context.signal?.throwIfAborted();
          result.metricWarning =
            "YouTube published videos were imported, but video details are unavailable.";
        }
      result.posts.push(...entries);
      result.nextCursor = cursor(data?.nextPageToken);
      if (data?.nextPageToken && !result.nextCursor)
        throw new TypeError("Invalid history pagination");
      break;
    }
    case "tiktok": {
      const next = context.cursor ? counter(context.cursor) : null;
      if (context.cursor && next === null)
        throw new TypeError("Invalid TikTok cursor");
      const data = await read("TIKTOK_LIST_VIDEOS", {
        max_count: 20,
        ...(next !== null ? { cursor: next } : {}),
      });
      const videos = requiredList(data, "videos", 20);
      const ids = videos
        .map((item) => string(item.id))
        .filter((id): id is string => id !== null)
        .slice(0, 20);
      let details: Record<string, unknown>[] = [];
      if (ids.length)
        try {
          details = requiredList(
            await read("TIKTOK_QUERY_VIDEOS", { video_ids: ids }),
            "videos",
            20,
          );
        } catch {
          context.signal?.throwIfAborted();
          result.metricWarning =
            "TikTok published videos were imported, but video details are unavailable.";
        }
      for (const item of videos) {
        const detail = details.find((video) => video.id === item.id) ?? item;
        const entry = post(
          detail,
          detail.video_description ?? detail.title,
          epoch(detail.create_time),
          detail.share_url,
        );
        if (!entry) continue;
        entry.metrics = {
          ...metrics(),
          views: counter(detail.view_count),
          likes: counter(detail.like_count),
          comments: counter(detail.comment_count),
          shares: counter(detail.share_count),
        };
        result.posts.push(entry);
      }
      if (data?.has_more === true) {
        const nextCursor = counter(data.cursor);
        if (nextCursor === null)
          throw new TypeError("Invalid history pagination");
        result.nextCursor = String(nextCursor);
      } else if (data?.has_more !== false)
        throw new TypeError("Invalid history pagination");
      break;
    }
    case "linkedin":
      result.historyError =
        "LinkedIn personal published history is not available through this connection.";
      break;
  }
  if (result.nextCursor !== null && result.nextCursor === context.cursor)
    throw new TypeError("History cursor did not advance");
}

/** Ten Meta posts per page keeps media-specific enrichment bounded. */
async function enrichMetaHistory(
  context: SocialAccountStatisticsContext,
  read: ReadTool,
  result: AccountPage,
  mediaTypes: Map<string, string>,
) {
  if (context.provider !== "instagram" && context.provider !== "facebook")
    return;
  let failed = false;
  for (let start = 0; start < result.posts.length; start += 3) {
    await Promise.all(
      result.posts.slice(start, start + 3).map(async (entry) => {
        try {
          const values = insights(
            await read(
              context.provider === "instagram"
                ? "INSTAGRAM_GET_IG_MEDIA_INSIGHTS"
                : "FACEBOOK_GET_POST_INSIGHTS",
              context.provider === "instagram"
                ? {
                    ig_media_id: entry.externalId,
                    metric: [
                      "views",
                      "reach",
                      "saved",
                      "likes",
                      "comments",
                      "shares",
                      "total_interactions",
                      "reposts",
                    ],
                    period: "lifetime",
                  }
                : {
                    post_id: entry.externalId,
                    metrics: "post_media_view,post_total_media_view_unique",
                    period: "lifetime",
                  },
            ),
          );
          const lookup = new Map(values.map((item) => [item.key, item.value]));
          entry.metrics.views = counter(
            lookup.get(
              context.provider === "instagram" ? "views" : "post_media_view",
            ),
          );
          if (context.provider === "instagram") {
            entry.metrics.likes =
              counter(lookup.get("likes")) ?? entry.metrics.likes;
            entry.metrics.comments =
              counter(lookup.get("comments")) ?? entry.metrics.comments;
            entry.metrics.shares = counter(lookup.get("shares"));
            entry.metrics.saves = counter(lookup.get("saved"));
          }
          entry.additionalMetrics = values.filter(
            (item) =>
              ![
                "views",
                "likes",
                "comments",
                "shares",
                "saved",
                "post_media_view",
              ].includes(item.key),
          );
          if (
            context.provider === "instagram" &&
            mediaTypes.get(entry.externalId) === "REELS"
          ) {
            const reelValues = insights(
              await read("INSTAGRAM_GET_IG_MEDIA_INSIGHTS", {
                ig_media_id: entry.externalId,
                metric: [
                  "ig_reels_video_view_total_time",
                  "ig_reels_avg_watch_time",
                  "reels_skip_rate",
                  "facebook_views",
                  "crossposted_views",
                ],
                period: "lifetime",
              }),
            );
            entry.additionalMetrics.push(
              ...reelValues.map((item) => ({
                ...item,
                unit:
                  item.key.includes("watch_time") ||
                  item.key.includes("view_total_time")
                    ? "milliseconds"
                    : item.key === "reels_skip_rate"
                      ? "percent"
                      : "count",
              })),
            );
          }
        } catch {
          context.signal?.throwIfAborted();
          failed = true;
        }
      }),
    );
  }
  if (failed)
    result.metricWarning = `${socialPostProviderLabel(context.provider)} published posts were imported, but some post insights are unavailable.`;
}

export async function fetchSocialAccountStatisticsPage(
  context: SocialAccountStatisticsContext,
): Promise<AccountPage> {
  const result: AccountPage = {
    accountMetrics: null,
    accountError: null,
    posts: [],
    nextCursor: null,
    historyError: null,
    metricWarning: null,
  };
  const label = socialPostProviderLabel(context.provider);
  let sessionId: string | undefined;
  try {
    sessionId = await createSocialPostToolSession({
      toolkitSlug: context.provider === "x" ? "twitter" : context.provider,
      connectedAccountId: context.connectedAccountId,
      executorUserId: context.executorUserId,
      toolSlugs: TOOLS[context.provider],
      context: "create account statistics session",
      signal: context.signal,
    });
    const activeSession = sessionId;
    const read: ReadTool = async (toolSlug, args) => {
      const payload = await executeSocialPostTool({
        sessionId: activeSession,
        toolSlug,
        arguments: args,
        context: "read social account statistics",
        refused: `${label} account statistics are unavailable.`,
        signal: context.signal,
      });
      const error = record(payload?.error);
      if (error && error.code !== "ok")
        throw new TypeError("Provider statistics unavailable");
      return payload;
    };
    const mediaTypes = new Map<string, string>();
    if (context.includeProfile)
      try {
        await profile(context, read, result);
      } catch (error) {
        context.signal?.throwIfAborted();
        result.accountError = statisticsFailureMessage(
          error,
          `${label} account statistics are unavailable. Check the connection permissions or try again later.`,
        );
      }
    try {
      await history(context, read, result, mediaTypes);
      await enrichMetaHistory(context, read, result, mediaTypes);
    } catch (error) {
      context.signal?.throwIfAborted();
      result.posts = [];
      result.nextCursor = null;
      result.historyError = statisticsFailureMessage(
        error,
        `${label} published history is unavailable. Check the connection permissions or try again later.`,
      );
    }
  } catch (error) {
    context.signal?.throwIfAborted();
    if (context.includeProfile)
      result.accountError = statisticsFailureMessage(
        error,
        `${label} account statistics are unavailable. Check the connection permissions or try again later.`,
      );
    result.historyError = statisticsFailureMessage(
      error,
      `${label} published history is unavailable. Check the connection permissions or try again later.`,
    );
  } finally {
    if (sessionId)
      await deleteProjectSocialSession(
        sessionId,
        "delete account statistics session",
      );
  }
  return result;
}
