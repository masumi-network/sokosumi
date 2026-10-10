import {
  type SocialPostProvider,
  socialPostProviderLabel,
} from "@sokosumi/utils";

import { deleteProjectSocialSession, record } from "@/clients/composio.client";
import { facebookInsightShareCount } from "@/clients/social-post-providers/facebook-shares";
import {
  ComposioToolError,
  createSocialPostToolSession,
  executeSocialPostTool,
} from "@/clients/social-post-providers/tools";
import type { SocialPostMetrics } from "@/schemas/social-post-statistics.schema";

export interface SocialPostStatisticsContext {
  provider: SocialPostProvider;
  connectedAccountId: string;
  executorUserId: string;
  externalAccountId: string;
  externalId: string;
  signal?: AbortSignal;
}

/** Product-safe failure: provider payloads and credentials never escape. */
export class SocialPostStatisticsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialPostStatisticsUnavailableError";
  }
}

// Verified against the input schemas embedded in docs.composio.dev/toolkits/*.
const STATISTICS_TOOLS = {
  x: ["TWITTER_POST_LOOKUP_BY_POST_ID"],
  instagram: ["INSTAGRAM_GET_IG_MEDIA_INSIGHTS"],
  facebook: ["FACEBOOK_GET_POST", "FACEBOOK_GET_POST_INSIGHTS"],
  youtube: ["YOUTUBE_GET_VIDEO_DETAILS_BATCH"],
  tiktok: ["TIKTOK_QUERY_VIDEOS"],
};

function emptyMetrics(): SocialPostMetrics {
  return {
    views: null,
    impressions: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
  };
}

/** YouTube serializes counters as decimal strings. Never coerce absent data to 0. */
function counter(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : null;
}

/** Meta media insights contain named lifetime values, not post object fields. */
function insightValues(data: Record<string, unknown> | null) {
  const values: Record<string, number | null> = {};
  if (!Array.isArray(data?.data)) return values;
  for (const item of data.data) {
    const metric = record(item);
    if (typeof metric?.name !== "string") continue;
    const first = Array.isArray(metric.values)
      ? record(metric.values[0])
      : null;
    values[metric.name] = counter(
      record(metric.total_value)?.value ?? first?.value,
    );
  }
  return values;
}

function matchingVideo(
  items: unknown,
  externalId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(items)) return null;
  return items.map(record).find((item) => item?.id === externalId) ?? null;
}

/** Reads only the published post through its existing connected account. */
export async function fetchSocialPostStatistics(
  context: SocialPostStatisticsContext,
): Promise<SocialPostMetrics> {
  const label = socialPostProviderLabel(context.provider);
  if (context.provider === "linkedin") {
    throw new SocialPostStatisticsUnavailableError(
      "LinkedIn personal post statistics are not available through this connection.",
    );
  }
  if (context.provider === "tiktok" && !/^\d+$/.test(context.externalId)) {
    throw new SocialPostStatisticsUnavailableError(
      "TikTok has not provided a published video ID for this post yet.",
    );
  }
  const unavailable = `${label} statistics are unavailable. Check the connection permissions or try again later.`;
  let sessionId: string | undefined;
  try {
    const activeSessionId = await createSocialPostToolSession({
      toolkitSlug: context.provider === "x" ? "twitter" : context.provider,
      connectedAccountId: context.connectedAccountId,
      executorUserId: context.executorUserId,
      toolSlugs: STATISTICS_TOOLS[context.provider],
      context: `create Project ${label} statistics session`,
      signal: context.signal,
    });
    sessionId = activeSessionId;
    const read = (toolSlug: string, args: Record<string, unknown>) =>
      executeSocialPostTool({
        sessionId: activeSessionId,
        toolSlug,
        arguments: args,
        context: `read ${label} post statistics`,
        refused: unavailable,
        signal: context.signal,
      });
    const metrics = emptyMetrics();
    switch (context.provider) {
      case "x": {
        const post = await read("TWITTER_POST_LOOKUP_BY_POST_ID", {
          id: context.externalId,
          tweet_fields: ["public_metrics"],
        });
        const counts = record(post?.public_metrics);
        metrics.impressions = counter(counts?.impression_count);
        metrics.likes = counter(counts?.like_count);
        metrics.comments = counter(counts?.reply_count);
        metrics.shares = counter(
          counts?.organic_repost_count ??
            counts?.repost_count ??
            counts?.retweet_count,
        );
        metrics.saves = counter(counts?.bookmark_count);
        break;
      }
      case "instagram": {
        const values = insightValues(
          await read("INSTAGRAM_GET_IG_MEDIA_INSIGHTS", {
            ig_media_id: context.externalId,
            metric: ["views", "likes", "comments", "shares", "saved"],
            period: "lifetime",
          }),
        );
        metrics.views = values.views ?? null;
        metrics.likes = values.likes ?? null;
        metrics.comments = values.comments ?? null;
        metrics.shares = values.shares ?? null;
        metrics.saves = values.saved ?? null;
        break;
      }
      case "facebook": {
        const post = await read("FACEBOOK_GET_POST", {
          post_id: context.externalId,
          fields: "id,reactions.summary(true),comments.summary(true),shares",
        });
        metrics.likes = counter(
          record(record(post?.reactions)?.summary)?.total_count,
        );
        metrics.comments = counter(
          record(record(post?.comments)?.summary)?.total_count,
        );
        metrics.shares = counter(record(post?.shares)?.count);
        // Insights requires read_insights in addition to basic engagement access.
        // Keep available engagement counters if the connection lacks that scope.
        try {
          const insightPayload = await read("FACEBOOK_GET_POST_INSIGHTS", {
            post_id: context.externalId,
            metrics: "post_media_view,post_activity_by_action_type",
            period: "lifetime",
          });
          metrics.views = insightValues(insightPayload).post_media_view ?? null;
          metrics.shares =
            facebookInsightShareCount(insightPayload) ?? metrics.shares;
        } catch (error) {
          context.signal?.throwIfAborted();
          if (
            !(error instanceof ComposioToolError) ||
            error.providerStatus !== 403
          ) {
            throw error;
          }
        }
        break;
      }
      case "youtube": {
        const result = await read("YOUTUBE_GET_VIDEO_DETAILS_BATCH", {
          id: [context.externalId],
          parts: ["statistics"],
        });
        const counts = record(
          matchingVideo(result?.items, context.externalId)?.statistics,
        );
        metrics.views = counter(counts?.viewCount);
        metrics.likes = counter(counts?.likeCount);
        metrics.comments = counter(counts?.commentCount);
        // favoriteCount is deprecated and always 0; it does not represent saves.
        break;
      }
      case "tiktok": {
        const result = await read("TIKTOK_QUERY_VIDEOS", {
          video_ids: [context.externalId],
        });
        const video = matchingVideo(result?.videos, context.externalId);
        metrics.views = counter(video?.view_count);
        metrics.likes = counter(video?.like_count);
        metrics.comments = counter(video?.comment_count);
        metrics.shares = counter(video?.share_count);
        break;
      }
    }
    if (Object.values(metrics).every((value) => value === null)) {
      throw new SocialPostStatisticsUnavailableError(unavailable);
    }
    return metrics;
  } catch {
    context.signal?.throwIfAborted();
    throw new SocialPostStatisticsUnavailableError(unavailable);
  } finally {
    if (sessionId) {
      await deleteProjectSocialSession(
        sessionId,
        `delete Project ${label} statistics session`,
      );
    }
  }
}
