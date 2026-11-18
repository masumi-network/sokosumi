import { deleteComposioToolSession, record } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";

import { nonEmptyText } from "./text";

const USER_INFO_TOOL = "INSTAGRAM_GET_USER_INFO";
const MEDIA_LIMIT = 30;
const CAPTION_CHARS = 300;
const TOP_POSTS = 3;
const TOP_POST_DAYS = 30;
const WEEK_MS = 7 * 86_400_000;

/** Letters, digits, dots and underscores: nothing else is an Instagram handle. */
const HANDLE = /^[a-z0-9._]{1,30}$/i;

/** Type aliases: both are stored in `competitor_signal.raw`. */
export type InstagramPost = {
  id: string;
  url: string | null;
  /** The caption as posted, clipped. */
  caption: string | null;
  type: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
};

export type InstagramWeek = {
  handle: string;
  followers: number | null;
  /** Posts published in the last seven days. */
  postsThisWeek: number;
  /** Likes and comments per post over those posts; null without any count. */
  engagementPerPost: number | null;
  /** The three posts of the last thirty days with the most likes and comments. */
  topPosts: InstagramPost[];
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Likes and comments per post, rounded; null without any count. */
export function averageEngagement(counts: readonly number[]): number | null {
  return counts.length > 0
    ? Math.round(counts.reduce((sum, value) => sum + value, 0) / counts.length)
    : null;
}

function engagement(post: InstagramPost): number | null {
  return post.likes === null && post.comments === null
    ? null
    : (post.likes ?? 0) + (post.comments ?? 0);
}

/**
 * One week of an Instagram account from a business discovery answer. A post
 * whose owner hides likes still counts as a post; engagement is then read
 * from the posts that show a count.
 */
export function instagramWeek(
  handle: string,
  discovery: Record<string, unknown>,
  now: Date,
): InstagramWeek {
  const media = record(discovery.media);
  const posts = (Array.isArray(media?.data) ? media.data : []).flatMap(
    (item): InstagramPost[] => {
      const post = record(item);
      const id = nonEmptyText(post?.id);
      const postedAt = nonEmptyText(post?.timestamp);
      if (!post || !id || !postedAt || Number.isNaN(Date.parse(postedAt)))
        return [];
      return [
        {
          id,
          url: nonEmptyText(post.permalink),
          caption: nonEmptyText(post.caption)?.slice(0, CAPTION_CHARS) ?? null,
          type:
            nonEmptyText(post.media_product_type) ??
            nonEmptyText(post.media_type),
          postedAt,
          likes: count(post.like_count),
          comments: count(post.comments_count),
        },
      ];
    },
  );
  const age = (post: InstagramPost) =>
    now.getTime() - Date.parse(post.postedAt);
  const week = posts.filter((post) => age(post) >= 0 && age(post) <= WEEK_MS);
  const counted = week.flatMap((post) => engagement(post) ?? []);
  return {
    handle,
    followers: count(discovery.followers_count),
    postsThisWeek: week.length,
    engagementPerPost: averageEngagement(counted),
    topPosts: posts
      .filter(
        (post) =>
          age(post) >= 0 &&
          age(post) <= TOP_POST_DAYS * 86_400_000 &&
          engagement(post) !== null,
      )
      .sort((a, b) => (engagement(b) ?? 0) - (engagement(a) ?? 0))
      .slice(0, TOP_POSTS),
  };
}

/** "@Blue.Bottle", an instagram.com address or a bare handle, as the handle. */
export function instagramHandle(value: string): string | null {
  const trimmed = value.trim();
  const fromUrl = /instagram\.com\/([^/?#]+)/i.exec(trimmed)?.[1];
  const handle = (fromUrl ?? trimmed).replace(/^@/, "");
  return HANDLE.test(handle) ? handle.toLowerCase() : null;
}

/** The owner's connected Instagram account, which may look others up. */
export interface InstagramReader {
  composioConnectedAccountId: string;
  connectorUserId: string;
  externalAccountId: string;
}

/**
 * Reads a competitor's public Instagram numbers through the owner's connected
 * account (business discovery). Null when Instagram answers nothing for the
 * handle: a personal or age-gated account, or one that does not exist.
 */
export async function readCompetitorInstagram(input: {
  reader: InstagramReader;
  handle: string;
  now: Date;
  signal?: AbortSignal;
}): Promise<InstagramWeek | null> {
  const handle = instagramHandle(input.handle);
  if (!handle) return null;
  const sessionId = await createComposioToolSession({
    toolkitSlug: "instagram",
    connectedAccountId: input.reader.composioConnectedAccountId,
    executorUserId: input.reader.connectorUserId,
    toolSlugs: [USER_INFO_TOOL],
    context: "create competitor Instagram session",
    signal: input.signal,
  });
  try {
    const payload = await executeComposioTool({
      sessionId,
      toolSlug: USER_INFO_TOOL,
      arguments: {
        ig_user_id: input.reader.externalAccountId,
        fields: `business_discovery.username(${handle}){username,followers_count,media_count,media.limit(${MEDIA_LIMIT}){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`,
      },
      context: "read competitor Instagram",
      refused: "Instagram did not answer for this account.",
      signal: input.signal,
    });
    const discovery = record(payload?.business_discovery);
    return discovery ? instagramWeek(handle, discovery, input.now) : null;
  } finally {
    await deleteComposioToolSession(
      sessionId,
      "delete competitor Instagram session",
    );
  }
}
