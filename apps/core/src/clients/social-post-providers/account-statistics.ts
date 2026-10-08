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
import type {
  SocialAccountMetric,
  SocialAccountPostMedia,
} from "@/schemas/social-account-statistics.schema";
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
  contentType: "text" | "image" | "video" | "carousel" | "link" | "unknown";
  postKind: "post" | "reply" | "quote" | "repost" | "unknown";
  media: SocialAccountPostMedia[];
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

const YOUTUBE_QUOTA_ERROR =
  "YouTube API quota is exhausted. Daily quota resets at midnight Pacific Time. Try syncing after the reset, or ask the administrator to review the connector's Google API quota.";

function isYouTubeQuotaError(error: unknown): boolean {
  return (
    error instanceof ComposioToolError &&
    /quotaExceeded|exceeded.{0,150}quota/i.test(error.providerMessage ?? "")
  );
}

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
// Versioned member analytics and Posts API; reviewed against September 2026 documentation.
const LINKEDIN_VERSION = "202609";
const LINKEDIN_METRICS = [
  ["IMPRESSION", "impressions"],
  ["REACTION", "reactions"],
  ["COMMENT", "comments"],
  ["RESHARE", "shares"],
  ["MEMBERS_REACHED", "members_reached"],
  ["POST_SAVE", "saves"],
  ["POST_SEND", "post_sends"],
  ["LINK_CLICKS", "link_clicks"],
  ["FOLLOWER_GAINED_FROM_CONTENT", "followers_gained_from_content"],
  ["PROFILE_VIEW_FROM_CONTENT", "profile_views_from_content"],
] satisfies [string, string][];

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
function previewMedia(
  kind: SocialAccountPostMedia["kind"],
  source: unknown,
  thumbnail: unknown = null,
): SocialAccountPostMedia[] {
  const mediaUrl = url(source) ?? url(thumbnail);
  return mediaUrl
    ? [{ kind, url: mediaUrl, thumbnailUrl: url(thumbnail) }]
    : [];
}

function contentType(entry: AccountPost): AccountPost["contentType"] {
  if (entry.media.length > 1) return "carousel";
  if (entry.media.some((item) => item.kind === "video" || item.kind === "gif"))
    return "video";
  if (entry.media.length) return "image";
  return /https?:\/\/\S+/i.test(entry.text) ? "link" : "text";
}

function instagramMedia(
  item: Record<string, unknown>,
): SocialAccountPostMedia[] {
  const children = objects(record(item.children)?.data);
  const items = children.length ? children : [item];
  return items
    .flatMap((child) =>
      previewMedia(
        child.media_type === "VIDEO" ? "video" : "image",
        child.media_url,
        child.thumbnail_url,
      ),
    )
    .slice(0, 20);
}

function facebookMedia(
  item: Record<string, unknown>,
): SocialAccountPostMedia[] {
  return objects(record(item.attachments)?.data)
    .flatMap((attachment) => {
      const children = objects(record(attachment.subattachments)?.data);
      return (children.length ? children : [attachment]).flatMap((child) => {
        const media = record(child.media);
        return previewMedia(
          typeof child.type === "string" && child.type.includes("video")
            ? "video"
            : "image",
          media?.source ?? record(media?.image)?.src,
          record(media?.image)?.src,
        );
      });
    })
    .slice(0, 20);
}

function xMedia(item: Record<string, unknown>, data: Record<string, unknown>) {
  const keys = record(item.attachments)?.media_keys;
  if (!Array.isArray(keys)) return [];
  const expanded = objects(record(data.includes)?.media);
  return keys
    .flatMap((key) => {
      const media = expanded.find((candidate) => candidate.media_key === key);
      if (!media) return [];
      const kind =
        media.type === "video"
          ? "video"
          : media.type === "animated_gif"
            ? "gif"
            : "image";
      const variant = objects(media.variants)
        .filter((candidate) => candidate.content_type === "video/mp4")
        .sort(
          (left, right) =>
            (counter(right.bit_rate) ?? 0) - (counter(left.bit_rate) ?? 0),
        )[0];
      return previewMedia(
        kind,
        variant?.url ?? media.url,
        media.preview_image_url,
      );
    })
    .slice(0, 20);
}

function xPostKind(
  item: Record<string, unknown>,
  accountId: string,
): AccountPost["postKind"] {
  const references = objects(item.referenced_tweets ?? item.referenced_posts);
  if (
    references.some(
      (reference) =>
        reference.type === "retweeted" || reference.type === "reposted",
    )
  )
    return "repost";
  if (references.some((reference) => reference.type === "replied_to"))
    // Self-thread continuations are authored content, not outgoing replies.
    return item.in_reply_to_user_id === accountId ? "post" : "reply";
  if (references.some((reference) => reference.type === "quoted"))
    return "quote";
  return "post";
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
        contentType: "unknown",
        postKind: "post",
        media: [],
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
          value: "created_at,public_metrics,note_post,attachments,entities",
          type: "query",
        },
        {
          name: "expansions",
          value:
            "attachments.media_keys,author_id,in_reply_to_user_id,referenced_posts",
          type: "query",
        },
        {
          name: "media.fields",
          value: "type,url,preview_image_url,variants,public_metrics",
          type: "query",
        },
      ]
    : [
        { name: "limit", value: "10", type: "query" },
        {
          name: "fields",
          value:
            "id,message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true),is_published,attachments{media,type,subattachments}",
          type: "query",
        },
      ];
  if (context.cursor)
    parameters.push({
      name: isX ? "pagination_token" : "after",
      value: context.cursor,
      type: "query",
    });
  return readNativeStatistics(context, endpoint, parameters);
}

export async function readNativeStatistics(
  context: SocialAccountStatisticsContext,
  endpoint: string,
  parameters: { name: string; value: string; type: string }[],
): Promise<Record<string, unknown>> {
  const isX = context.provider === "x";
  // Every endpoint is a fixed read shape; neither a user URL nor a caller header can reach the proxy.
  const allowed = isX
    ? /^https:\/\/api\.x\.com\/2\/(?:tweets(?:\/(?:[0-9]{1,19}\/(?:liking_users|retweeted_by)|search\/recent))?|users\/(?:[0-9]{1,19}\/(?:tweets|mentions|followers)|by\/username\/[A-Za-z0-9_]{1,15}))$/.test(
        endpoint,
      )
    : (context.provider === "facebook" &&
        endpoint ===
          `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${context.externalAccountId}/posts`) ||
      (context.provider === "linkedin" &&
        [
          "https://api.linkedin.com/rest/posts",
          "https://api.linkedin.com/rest/memberCreatorPostAnalytics",
          "https://api.linkedin.com/rest/memberFollowersCount",
          "https://api.linkedin.com/rest/organizationalEntityShareStatistics",
        ].includes(endpoint));
  if (!allowed || parameters.some((value) => value.type !== "query"))
    throw new TypeError("Unsupported native statistics endpoint or parameter");
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
          parameters: [
            ...parameters,
            ...(context.provider === "linkedin"
              ? [
                  {
                    name: "Linkedin-Version",
                    value: LINKEDIN_VERSION,
                    type: "header",
                  },
                  {
                    name: "X-Restli-Protocol-Version",
                    value: "2.0.0",
                    type: "header",
                  },
                  { name: "X-RestLi-Method", value: "FINDER", type: "header" },
                ]
              : []),
          ],
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
      endpoint.replace("https://api.x.com/", "https://api.twitter.com/"),
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

function linkedInAuthor(context: SocialAccountStatisticsContext): string {
  const id = context.externalAccountId;
  if (
    /^urn:li:(?:person:[A-Za-z0-9_-]{1,100}|organization:[0-9]{1,19})$/.test(id)
  )
    return id;
  if (/^[A-Za-z0-9_-]{1,100}$/.test(id)) return `urn:li:person:${id}`;
  throw new TypeError("Invalid LinkedIn author");
}

async function linkedInMetric(
  context: SocialAccountStatisticsContext,
  queryType: string,
  key: string,
  entity?: string,
): Promise<SocialAccountMetric> {
  const data = await readNativeStatistics(
    context,
    "https://api.linkedin.com/rest/memberCreatorPostAnalytics",
    [
      { name: "q", value: entity ? "entity" : "me", type: "query" },
      { name: "queryType", value: queryType, type: "query" },
      { name: "aggregation", value: "TOTAL", type: "query" },
      ...(entity
        ? [
            {
              name: "entity",
              value: `(${entity.startsWith("urn:li:ugcPost:") ? "ugc" : "share"}:${encodeURIComponent(entity)})`,
              type: "query",
            },
          ]
        : []),
    ],
  );
  const element = requiredList(data, "elements", 10).find((item) => {
    const metricType =
      string(item.metricType) ??
      Object.values(record(item.metricType) ?? {}).find(
        (value) => typeof value === "string",
      );
    return metricType === queryType;
  });
  if (!element || counter(element.count) === null)
    throw new TypeError("LinkedIn metric unavailable");
  if (entity) {
    const target = Object.values(record(element.targetEntity) ?? {});
    if (target.length && !target.includes(entity))
      throw new TypeError("LinkedIn metric belongs to another post");
  }
  return metric(key, counter(element.count));
}

async function linkedInMetrics(
  context: SocialAccountStatisticsContext,
  entity?: string,
): Promise<{ values: SocialAccountMetric[]; incomplete: boolean }> {
  // A denied first request avoids exhausting quotas on the same missing grant.
  const values = [
    await linkedInMetric(context, "IMPRESSION", "impressions", entity),
  ];
  let incomplete = false;
  for (let start = 1; start < LINKEDIN_METRICS.length; start += 3) {
    const results = await Promise.allSettled(
      LINKEDIN_METRICS.slice(start, start + 3).map(([type, key]) =>
        linkedInMetric(context, type, key, entity),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") values.push(result.value);
      else {
        context.signal?.throwIfAborted();
        incomplete = true;
        const specification = LINKEDIN_METRICS[start + index];
        if (specification) values.push(metric(specification[1], null));
      }
    });
  }
  return { values, incomplete };
}

async function linkedInOrganizationStatistics(
  context: SocialAccountStatisticsContext,
  posts: AccountPost[] = [],
) {
  const parameters = [
    { name: "q", value: "organizationalEntity", type: "query" },
    {
      name: "organizationalEntity",
      value: linkedInAuthor(context),
      type: "query",
    },
  ];
  for (const [name, prefix] of [
    ["shares", "urn:li:share:"],
    ["ugcPosts", "urn:li:ugcPost:"],
  ]) {
    const ids = posts
      .filter((entry) => entry.externalId.startsWith(prefix))
      .map((entry) => encodeURIComponent(entry.externalId));
    if (ids.length)
      parameters.push({ name, value: `List(${ids.join(",")})`, type: "query" });
  }
  const data = await readNativeStatistics(
    context,
    "https://api.linkedin.com/rest/organizationalEntityShareStatistics",
    parameters,
  );
  const elements = requiredList(data, "elements", posts.length || 1);
  if (
    elements.some(
      (item) => item.organizationalEntity !== linkedInAuthor(context),
    )
  )
    throw new TypeError("LinkedIn insights belong to another organization");
  return elements;
}

async function linkedInHistory(
  context: SocialAccountStatisticsContext,
  result: AccountPage,
) {
  const author = linkedInAuthor(context);
  const offset = context.cursor === null ? 0 : counter(context.cursor);
  if (offset === null) throw new TypeError("Invalid LinkedIn history cursor");
  const data = await readNativeStatistics(
    context,
    "https://api.linkedin.com/rest/posts",
    [
      { name: "q", value: "author", type: "query" },
      { name: "author", value: author, type: "query" },
      { name: "count", value: "5", type: "query" },
      { name: "start", value: String(offset), type: "query" },
      { name: "sortBy", value: "CREATED", type: "query" },
    ],
  );
  for (const item of requiredList(data, "elements", 5)) {
    if (item.author !== author || item.lifecycleState !== "PUBLISHED") continue;
    const id = string(item.id);
    if (!id || !/^urn:li:(?:share|ugcPost):[0-9]{1,19}$/.test(id)) continue;
    const milliseconds = counter(item.publishedAt);
    const entry = post(
      item,
      item.commentary,
      milliseconds === null ? null : date(new Date(milliseconds).toJSON()),
      `https://www.linkedin.com/feed/update/${id}/`,
    );
    if (!entry) continue;
    const content = record(item.content);
    const mediaId = string(record(content?.media)?.id);
    const article = record(content?.article);
    entry.postKind = record(item.reshareContext) ? "repost" : "post";
    entry.contentType = record(content?.multiImage)
      ? "carousel"
      : mediaId?.startsWith("urn:li:video:")
        ? "video"
        : mediaId?.startsWith("urn:li:image:")
          ? "image"
          : article
            ? "link"
            : content && Object.keys(content).length
              ? "unknown"
              : contentType(entry);
    entry.media = article ? previewMedia("image", article.thumbnail) : [];
    result.posts.push(entry);
  }
  const next = objects(record(data.paging)?.links).find(
    (link) => link.rel === "next",
  );
  if (next) {
    const href = url(next.href);
    if (!href) throw new TypeError("Invalid LinkedIn history pagination");
    const parsed = new URL(href);
    const nextOffset = counter(parsed.searchParams.get("start"));
    if (
      parsed.origin !== "https://api.linkedin.com" ||
      parsed.pathname !== "/rest/posts" ||
      nextOffset === null ||
      nextOffset <= offset
    )
      throw new TypeError("Invalid LinkedIn history pagination");
    result.nextCursor = String(nextOffset);
  }
  if (author.startsWith("urn:li:organization:")) {
    if (!result.posts.length) return;
    try {
      const insights = await linkedInOrganizationStatistics(
        context,
        result.posts,
      );
      const cutoff = new Date();
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
      for (const entry of result.posts) {
        const value = insights.find(
          (item) => (item.share ?? item.ugcPost) === entry.externalId,
        );
        const statistics = record(value?.totalShareStatistics);
        // Values outside the rolling window cannot be described as post lifetime counters.
        if (!entry.publishedAt || new Date(entry.publishedAt) < cutoff) {
          if (value)
            entry.additionalMetrics = counts(statistics, [
              "impressionCount",
              "likeCount",
              "commentCount",
              "shareCount",
              "clickCount",
              "uniqueImpressionsCount",
            ]).map((value) => ({
              ...value,
              key: `organic_${value.key}`,
              period: "rolling_12_months_organic",
            }));
          continue;
        }
        // LinkedIn explicitly documents that omitted in-window posts have zero activity.
        const count = (key: string) => (value ? counter(statistics?.[key]) : 0);
        entry.metrics = {
          ...metrics(),
          impressions: count("impressionCount"),
          likes: count("likeCount"),
          comments: count("commentCount"),
          shares: count("shareCount"),
        };
        entry.additionalMetrics = [
          metric("click_count", count("clickCount")),
          metric("unique_impressions", count("uniqueImpressionsCount")),
          ...(number(statistics?.likeCount) !== null &&
          (number(statistics?.likeCount) ?? 0) < 0
            ? [metric("organic_like_adjustments", statistics?.likeCount)]
            : []),
        ];
      }
    } catch {
      context.signal?.throwIfAborted();
      result.metricWarning =
        "LinkedIn organization insights require rw_organization_admin and an administrator role. Published posts remain available.";
    }
    return;
  }
  let permissionDenied = false;
  for (const entry of result.posts) {
    if (permissionDenied) break;
    try {
      const insights = await linkedInMetrics(context, entry.externalId);
      const counters = new Map(
        insights.values.map((value) => [value.key, value.value]),
      );
      entry.metrics = {
        ...metrics(),
        impressions: counter(counters.get("impressions")),
        likes: counter(counters.get("reactions")),
        comments: counter(counters.get("comments")),
        shares: counter(counters.get("shares")),
        saves: counter(counters.get("saves")),
      };
      entry.additionalMetrics = insights.values.filter(
        (value) =>
          !["impressions", "reactions", "comments", "shares", "saves"].includes(
            value.key,
          ),
      );
      if (insights.incomplete)
        result.metricWarning =
          "LinkedIn published posts were imported, but some member analytics are unavailable. Check the r_member_postAnalytics permission and Community Management app access.";
    } catch {
      context.signal?.throwIfAborted();
      permissionDenied = true;
      result.metricWarning =
        "LinkedIn published posts were imported, but member analytics are unavailable. Check the r_member_postAnalytics permission and Community Management app access.";
    }
  }
}

/** Private counters expire at X after 30 days; public history remains usable when OAuth denies them. */
async function enrichXPrivateMetrics(
  context: SocialAccountStatisticsContext,
  posts: AccountPost[],
) {
  const cutoff = Date.now() - 30 * 86400000;
  const eligible = posts.filter(
    (entry) =>
      entry.postKind !== "repost" &&
      /^\d{1,19}$/.test(entry.externalId) &&
      entry.publishedAt !== null &&
      new Date(entry.publishedAt).getTime() > cutoff,
  );
  if (!eligible.length) return;
  // The batch Composio lookup uses app authentication; native proxy keeps the owner's OAuth context.
  try {
    const data = await readNativeStatistics(
      context,
      "https://api.x.com/2/tweets",
      [
        {
          name: "ids",
          value: eligible.map((entry) => entry.externalId).join(","),
          type: "query",
        },
        {
          name: "post.fields",
          value: "non_public_metrics,organic_metrics",
          type: "query",
        },
        { name: "expansions", value: "author_id", type: "query" },
      ],
    );
    for (const item of requiredList(data, "data")) {
      const entry = eligible.find((post) => post.externalId === item.id);
      if (
        !entry ||
        (item.author_id !== undefined &&
          item.author_id !== context.externalAccountId)
      )
        continue;
      const nonPublic = record(item.non_public_metrics);
      const organic = record(item.organic_metrics);
      const privateMetrics = [
        ...counts(nonPublic, [
          "url_link_clicks",
          "user_profile_clicks",
          "engagements",
        ]),
        ...[
          "impression_count",
          "like_count",
          "reply_count",
          "repost_count",
        ].map((key) =>
          metric(
            `organic_${key}`,
            counter(
              organic?.[key] ??
                (key === "repost_count" ? organic?.retweet_count : undefined),
            ),
          ),
        ),
      ].map((value) => ({
        ...value,
        period: `lifetime:${new Date().toISOString()}`,
      }));
      entry.additionalMetrics = [
        ...entry.additionalMetrics.filter(
          (value) =>
            !privateMetrics.some((candidate) => candidate.key === value.key),
        ),
        ...privateMetrics,
      ];
    }
  } catch {
    context.signal?.throwIfAborted();
    // Missing scopes/private metrics must not stop the public timeline refresh.
  }
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
      try {
        if (linkedInAuthor(context).startsWith("urn:li:organization:")) {
          const [insight] = await linkedInOrganizationStatistics(context);
          if (!insight)
            throw new TypeError("LinkedIn organization insights unavailable");
          result.accountMetrics = counts(record(insight.totalShareStatistics), [
            "impressionCount",
            "uniqueImpressionsCount",
            "clickCount",
            "likeCount",
            "commentCount",
            "shareCount",
          ]).map((value) => ({
            ...value,
            period: "rolling_12_months_organic",
          }));
          const likes = number(record(insight.totalShareStatistics)?.likeCount);
          if (likes !== null && likes < 0)
            result.accountMetrics.push(
              metric(
                "organic_like_adjustments",
                likes,
                "rolling_12_months_organic",
              ),
            );
          break;
        }
        const analytics = await linkedInMetrics(context);
        result.accountMetrics = analytics.values;
        if (analytics.incomplete)
          result.accountError =
            "Some LinkedIn member analytics are unavailable. Check the r_member_postAnalytics permission and Community Management app access.";
      } catch {
        context.signal?.throwIfAborted();
        result.accountError = linkedInAuthor(context).startsWith(
          "urn:li:organization:",
        )
          ? "LinkedIn organization insights require rw_organization_admin and an administrator role. Reconnect after these are enabled."
          : "LinkedIn member analytics require the r_member_postAnalytics permission and approved Community Management app access. Reconnect after these are enabled.";
      }
      if (!linkedInAuthor(context).startsWith("urn:li:organization:"))
        try {
          const followerData = await readNativeStatistics(
            context,
            "https://api.linkedin.com/rest/memberFollowersCount",
            [{ name: "q", value: "me", type: "query" }],
          );
          const [follower] = requiredList(followerData, "elements", 1);
          const count = counter(follower?.memberFollowersCount);
          if (count === null)
            throw new TypeError("LinkedIn follower count unavailable");
          result.accountMetrics ??= [];
          result.accountMetrics.push(metric("followers_count", count));
        } catch {
          context.signal?.throwIfAborted();
          result.accountError ??=
            "LinkedIn follower counts require r_member_profileAnalytics and approved Community Management app access. Other permitted post analytics remain available.";
        }
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

export function parseXAccountPosts(
  data: Record<string, unknown>,
  accountId: string,
): AccountPost[] {
  const posts: AccountPost[] = [];
  for (const item of requiredList(data, "data")) {
    if (item.author_id !== undefined && item.author_id !== accountId) continue;
    const entry = post(
      item,
      record(item.note_post)?.text ??
        record(item.note_tweet)?.text ??
        item.text,
      date(item.created_at),
      `https://x.com/i/status/${string(item.id) ?? ""}`,
    );
    if (!entry) continue;
    entry.postKind = xPostKind(item, accountId);
    entry.media = xMedia(item, data);
    const mediaKeys = record(item.attachments)?.media_keys;
    const expandedMedia = objects(record(data.includes)?.media);
    const singleMedia = Array.isArray(mediaKeys)
      ? expandedMedia.find((value) => value.media_key === mediaKeys[0])
      : undefined;
    entry.contentType =
      Array.isArray(mediaKeys) && mediaKeys.length > 1
        ? "carousel"
        : singleMedia?.type === "photo"
          ? "image"
          : singleMedia?.type === "video" ||
              singleMedia?.type === "animated_gif"
            ? "video"
            : Array.isArray(mediaKeys) && mediaKeys.length
              ? "unknown"
              : contentType(entry);
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
    entry.additionalMetrics.push(
      ...counts(null, [
        "url_link_clicks",
        "user_profile_clicks",
        "engagements",
      ]),
    );
    if (Array.isArray(mediaKeys)) {
      const videoViews = expandedMedia
        .filter(
          (media) =>
            mediaKeys.includes(media.media_key) && media.type === "video",
        )
        .map((media) => counter(record(media.public_metrics)?.view_count));
      if (videoViews.length === 1) entry.metrics.views = videoViews[0];
      // X video counts belong to the media, so summing multiple videos would misrepresent post views.
    }
    posts.push(entry);
  }
  return posts;
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
      result.posts = parseXAccountPosts(data, context.externalAccountId);
      await enrichXPrivateMetrics(context, result.posts);
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
        entry.media = facebookMedia(item);
        const attachments = objects(record(item.attachments)?.data).flatMap(
          (value) => {
            const children = objects(record(value.subattachments)?.data);
            return children.length ? children : [value];
          },
        );
        const attachmentType = string(attachments[0]?.type);
        entry.contentType =
          attachments.length > 1
            ? "carousel"
            : attachmentType?.includes("video")
              ? "video"
              : attachmentType === "photo"
                ? "image"
                : attachmentType === "share" || attachmentType === "link"
                  ? "link"
                  : attachments.length && !entry.media.length
                    ? "unknown"
                    : contentType(entry);
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
          "id,caption,timestamp,permalink,like_count,comments_count,media_product_type,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}",
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
        entry.media = instagramMedia(item);
        entry.contentType =
          item.media_type === "CAROUSEL_ALBUM"
            ? "carousel"
            : item.media_type === "VIDEO" || item.media_product_type === "REELS"
              ? "video"
              : item.media_type === "IMAGE"
                ? "image"
                : contentType(entry);
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
        if (entry) {
          entry.contentType = "video";
          const thumbnails = record(snippet?.thumbnails);
          const thumbnail =
            record(thumbnails?.high)?.url ??
            record(thumbnails?.medium)?.url ??
            record(thumbnails?.default)?.url;
          // The Data API supplies a thumbnail, not an authorized playable video URL.
          entry.media = previewMedia("image", thumbnail);
        }
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
            const thumbnails = record(snippet.thumbnails);
            const thumbnail =
              record(thumbnails?.maxres)?.url ??
              record(thumbnails?.high)?.url ??
              record(thumbnails?.medium)?.url ??
              record(thumbnails?.default)?.url;
            if (thumbnail) entry.media = previewMedia("image", thumbnail);
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
        entry.contentType = "video";
        entry.media = previewMedia("image", detail.cover_image_url);
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
      try {
        await linkedInHistory(context, result);
      } catch {
        context.signal?.throwIfAborted();
        result.posts = [];
        result.nextCursor = null;
        result.historyError = linkedInAuthor(context).startsWith(
          "urn:li:organization:",
        )
          ? "LinkedIn organization history requires r_organization_social and a permitted organization role. Reconnect after these are enabled."
          : "LinkedIn published history requires the restricted r_member_social permission and approved Community Management app access. Reconnect after these are enabled.";
      }
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
        if (context.provider === "youtube" && isYouTubeQuotaError(error)) {
          result.accountError = YOUTUBE_QUOTA_ERROR;
          result.historyError = YOUTUBE_QUOTA_ERROR;
          return result;
        }
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
      result.historyError =
        context.provider === "youtube" && isYouTubeQuotaError(error)
          ? YOUTUBE_QUOTA_ERROR
          : statisticsFailureMessage(
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
