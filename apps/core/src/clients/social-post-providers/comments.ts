import { socialPostProviderLabel, socialPostTextLength } from "@sokosumi/utils";

import { deleteComposioToolSession, record } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";
import { getZernioAccountId, zernioRequest } from "@/clients/zernio.client";

/**
 * Networks whose comments Cuso reads and answers. Instagram, Facebook and
 * YouTube go through Composio per post; X through the account's mentions
 * (one call a round, since replies mention the brand); LinkedIn and TikTok
 * through Zernio's comments API, so only accounts connected through Zernio.
 */
export const SOCIAL_COMMENT_PROVIDERS = [
  "instagram",
  "facebook",
  "youtube",
  "x",
  "linkedin",
  "tiktok",
] as const;
export type SocialCommentProvider = (typeof SOCIAL_COMMENT_PROVIDERS)[number];

export function isSocialCommentProvider(
  provider: string,
): provider is SocialCommentProvider {
  return (SOCIAL_COMMENT_PROVIDERS as readonly string[]).includes(provider);
}

const ZERNIO_ONLY: readonly SocialCommentProvider[] = ["linkedin", "tiktok"];

/** Whether this account's comments can be read: LinkedIn and TikTok only through Zernio. */
export function commentsReadable(
  provider: SocialCommentProvider,
  connectedAccountId: string,
): boolean {
  return (
    !ZERNIO_ONLY.includes(provider) ||
    getZernioAccountId(connectedAccountId) !== null
  );
}

// Verified against docs.composio.dev/toolkits/{instagram,facebook,youtube,twitter}.
const COMPOSIO_COMMENT_TOOLS = {
  instagram: {
    list: "INSTAGRAM_GET_IG_MEDIA_COMMENTS",
    reply: "INSTAGRAM_POST_IG_COMMENT_REPLIES",
  },
  facebook: { list: "FACEBOOK_GET_COMMENTS", reply: "FACEBOOK_CREATE_COMMENT" },
  youtube: {
    list: "YOUTUBE_LIST_COMMENT_THREADS2",
    reply: "YOUTUBE_CREATE_COMMENT_REPLY",
  },
  x: { list: "TWITTER_GET_USER_MENTIONS", reply: "TWITTER_CREATION_OF_A_POST" },
} as const;

/** Instagram rejects longer replies; the others allow more. */
export const SOCIAL_COMMENT_REPLY_MAX = 300;
const X_REPLY_MAX = 280;

/** The reply's length as its network counts it, and the most it may be. */
export function socialCommentReplyFits(
  provider: SocialCommentProvider,
  reply: string,
): { max: number; fits: boolean } {
  const max = provider === "x" ? X_REPLY_MAX : SOCIAL_COMMENT_REPLY_MAX;
  const length = socialPostTextLength(provider, reply);
  return { max, fits: length > 0 && length <= max };
}

export interface SocialCommentContext {
  provider: SocialCommentProvider;
  connectedAccountId: string;
  executorUserId: string;
  /** The connected account itself, so its own comments are left out. */
  externalAccountId: string;
  signal?: AbortSignal;
}

export interface ProviderComment {
  externalId: string;
  text: string;
  authorName: string | null;
  authorExternalId: string | null;
  commentedAt: Date | null;
}

/** An X reply found among the account's mentions, with the thread it is in. */
export interface ProviderXReply extends ProviderComment {
  conversationId: string;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(value: unknown): Date | null {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

/** The first array in a provider payload: Graph APIs nest it under data, YouTube under items. */
function items(payload: Record<string, unknown> | null): unknown[] {
  if (!payload) return [];
  for (const key of ["data", "items", "comments"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  return [];
}

function normalize(
  provider: SocialCommentProvider,
  raw: unknown,
): ProviderComment | null {
  const item = record(raw);
  if (!item) return null;
  if (provider === "youtube") {
    const top = record(record(item.snippet)?.topLevelComment);
    const snippet = record(top?.snippet);
    const id = text(top?.id);
    const body = text(snippet?.textOriginal) ?? text(snippet?.textDisplay);
    if (!id || !body) return null;
    return {
      externalId: id,
      text: body,
      authorName: text(snippet?.authorDisplayName),
      authorExternalId: text(record(snippet?.authorChannelId)?.value),
      commentedAt: date(snippet?.publishedAt),
    };
  }
  const id = text(item.id);
  const body = text(item.text) ?? text(item.message);
  if (!id || !body) return null;
  const from = record(item.from);
  return {
    externalId: id,
    text: body,
    authorName: text(item.username) ?? text(from?.username) ?? text(from?.name),
    authorExternalId: text(from?.id),
    commentedAt:
      date(item.timestamp) ?? date(item.created_time) ?? date(item.createdTime),
  };
}

async function withSession<T>(
  context: SocialCommentContext,
  purpose: string,
  toolSlug: string,
  run: (
    execute: (args: Record<string, unknown>) => Promise<unknown>,
  ) => Promise<T>,
): Promise<T> {
  const label = socialPostProviderLabel(context.provider);
  const toolkitSlug = context.provider === "x" ? "twitter" : context.provider;
  const sessionId = await createComposioToolSession({
    toolkitSlug,
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: [toolSlug],
    context: `create Project ${label} comments session`,
    signal: context.signal,
  });
  try {
    return await run((args) =>
      executeComposioTool({
        sessionId,
        toolSlug,
        arguments: args,
        context: `${purpose} ${label} comments`,
        refused: `${label} comments are unavailable. Check the connection permissions.`,
        signal: context.signal,
      }),
    );
  } finally {
    await deleteComposioToolSession(
      sessionId,
      `delete Project ${label} comments session`,
    ).catch(() => undefined);
  }
}

function zernioAccount(context: SocialCommentContext): string {
  const accountId = getZernioAccountId(context.connectedAccountId);
  if (!accountId)
    throw new Error(
      `${socialPostProviderLabel(context.provider)} comments need a Zernio account`,
    );
  return accountId;
}

const notOwn =
  (context: SocialCommentContext) =>
  (comment: ProviderComment | null): comment is ProviderComment =>
    comment !== null && comment.authorExternalId !== context.externalAccountId;

/** Newest comments on one published post, without the account's own. X reads by account: {@link listXReplies}. */
export async function listPostComments(
  context: SocialCommentContext,
  externalPostId: string,
): Promise<ProviderComment[]> {
  if (getZernioAccountId(context.connectedAccountId)) {
    const query = new URLSearchParams({
      accountId: zernioAccount(context),
      limit: "50",
    });
    const payload = record(
      await zernioRequest(
        `/inbox/comments/${encodeURIComponent(externalPostId)}?${query}`,
        { signal: context.signal },
      ),
    );
    return items(payload)
      .filter((raw) => record(record(raw)?.from)?.isOwner !== true)
      .map((raw) => normalize(context.provider, raw))
      .filter(notOwn(context));
  }
  if (context.provider === "x" || ZERNIO_ONLY.includes(context.provider))
    throw new Error(
      `${socialPostProviderLabel(context.provider)} comments are not read per post`,
    );
  const provider = context.provider as "instagram" | "facebook" | "youtube";
  const tools = COMPOSIO_COMMENT_TOOLS[provider];
  const payload = await withSession(context, "read", tools.list, (execute) =>
    execute(
      provider === "instagram"
        ? {
            ig_media_id: externalPostId,
            limit: 50,
            fields: "id,text,username,timestamp,from",
          }
        : provider === "facebook"
          ? {
              object_id: externalPostId,
              limit: 50,
              order: "reverse_chronological",
              filter: "toplevel",
              fields: "id,message,created_time,from",
            }
          : {
              part: "snippet",
              videoId: externalPostId,
              maxResults: 50,
              order: "time",
              textFormat: "plainText",
            },
    ),
  );
  return items(record(payload))
    .map((raw) => normalize(provider, raw))
    .filter(notOwn(context));
}

/**
 * Replies to the X account since a time, read from its mentions: one call a
 * round for every post, since a reply always mentions the account it answers.
 * X bills each post read, so the window stays short and `sinceId` skips what
 * an earlier round read.
 */
export async function listXReplies(
  context: SocialCommentContext,
  input: { startTime: Date; sinceId?: string | null },
): Promise<ProviderXReply[]> {
  const payload = record(
    await withSession(
      context,
      "read",
      COMPOSIO_COMMENT_TOOLS.x.list,
      (execute) =>
        execute({
          id: context.externalAccountId,
          max_results: 100,
          start_time: input.startTime.toISOString(),
          ...(input.sinceId ? { since_id: input.sinceId } : {}),
          tweet_fields: ["conversation_id", "created_at", "text"],
          expansions: ["author_id"],
          user_fields: ["username"],
        }),
    ),
  );
  const usernames = new Map(
    (Array.isArray(record(payload?.includes)?.users)
      ? (record(payload?.includes)?.users as unknown[])
      : []
    ).flatMap((raw) => {
      const user = record(raw);
      const id = text(user?.id);
      const username = text(user?.username);
      return id && username ? [[id, `@${username}`] as const] : [];
    }),
  );
  return items(payload).flatMap((raw) => {
    const post = record(raw);
    const id = text(post?.id);
    const body = text(post?.text);
    const conversationId = text(post?.conversation_id);
    const authorId = text(post?.author_id);
    if (!id || !body || !conversationId || id === conversationId) return [];
    if (authorId === context.externalAccountId) return [];
    return [
      {
        externalId: id,
        text: body,
        authorName: authorId ? (usernames.get(authorId) ?? null) : null,
        authorExternalId: authorId,
        commentedAt: date(post?.created_at),
        conversationId,
      },
    ];
  });
}

/** Posts the brand's reply under one comment; returns the reply's id when known. */
export async function replyToComment(
  context: SocialCommentContext,
  comment: {
    externalCommentId: string;
    externalPostId: string;
    /** Makes a retried Zernio reply post once. */
    idempotencyKey: string;
  },
  message: string,
): Promise<string | null> {
  if (getZernioAccountId(context.connectedAccountId)) {
    const result = record(
      await zernioRequest(
        `/inbox/comments/${encodeURIComponent(comment.externalPostId)}`,
        {
          method: "POST",
          idempotencyKey: comment.idempotencyKey,
          signal: context.signal,
          body: {
            accountId: zernioAccount(context),
            commentId: comment.externalCommentId,
            message,
          },
        },
      ),
    );
    return text(record(result?.data)?.commentId);
  }
  if (ZERNIO_ONLY.includes(context.provider))
    throw new Error(
      `${socialPostProviderLabel(context.provider)} replies need a Zernio account`,
    );
  const provider = context.provider as keyof typeof COMPOSIO_COMMENT_TOOLS;
  const tools = COMPOSIO_COMMENT_TOOLS[provider];
  const id = comment.externalCommentId;
  const result = await withSession(
    context,
    "reply to",
    tools.reply,
    (execute) =>
      execute(
        provider === "instagram"
          ? { ig_comment_id: id, message }
          : provider === "facebook"
            ? { object_id: id, message }
            : provider === "x"
              ? { text: message, reply_in_reply_to_tweet_id: id }
              : { parentId: id, textOriginal: message },
      ),
  );
  return text(record(result)?.id);
}
