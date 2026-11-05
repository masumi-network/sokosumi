import { socialPostProviderLabel } from "@sokosumi/utils";

import { deleteComposioToolSession, record } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";

/**
 * Networks whose comments can be read and answered through Composio.
 * LinkedIn has no tool that reads comments, and X needs paid search to find
 * replies, so both stay out until that changes.
 */
export const SOCIAL_COMMENT_PROVIDERS = [
  "instagram",
  "facebook",
  "youtube",
] as const;
export type SocialCommentProvider = (typeof SOCIAL_COMMENT_PROVIDERS)[number];

export function isSocialCommentProvider(
  provider: string,
): provider is SocialCommentProvider {
  return (SOCIAL_COMMENT_PROVIDERS as readonly string[]).includes(provider);
}

// Verified against docs.composio.dev/toolkits/{instagram,facebook,youtube}.
const COMMENT_TOOLS = {
  instagram: {
    list: "INSTAGRAM_GET_IG_MEDIA_COMMENTS",
    reply: "INSTAGRAM_POST_IG_COMMENT_REPLIES",
  },
  facebook: { list: "FACEBOOK_GET_COMMENTS", reply: "FACEBOOK_CREATE_COMMENT" },
  youtube: {
    list: "YOUTUBE_LIST_COMMENT_THREADS2",
    reply: "YOUTUBE_CREATE_COMMENT_REPLY",
  },
} as const satisfies Record<
  SocialCommentProvider,
  { list: string; reply: string }
>;

/** Instagram rejects longer replies; the others allow more. */
export const SOCIAL_COMMENT_REPLY_MAX = 300;

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
    commentedAt: date(item.timestamp) ?? date(item.created_time),
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
  const sessionId = await createComposioToolSession({
    toolkitSlug: context.provider,
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

/** Newest comments on one published post, without the account's own. */
export async function listPostComments(
  context: SocialCommentContext,
  externalPostId: string,
): Promise<ProviderComment[]> {
  const tools = COMMENT_TOOLS[context.provider];
  const payload = await withSession(context, "read", tools.list, (execute) =>
    execute(
      context.provider === "instagram"
        ? {
            ig_media_id: externalPostId,
            limit: 50,
            fields: "id,text,username,timestamp,from",
          }
        : context.provider === "facebook"
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
    .map((raw) => normalize(context.provider, raw))
    .filter(
      (comment): comment is ProviderComment =>
        comment !== null &&
        comment.authorExternalId !== context.externalAccountId,
    );
}

/** Posts the brand's reply under one comment; returns the reply's id when known. */
export async function replyToComment(
  context: SocialCommentContext,
  externalCommentId: string,
  message: string,
): Promise<string | null> {
  const tools = COMMENT_TOOLS[context.provider];
  const result = await withSession(
    context,
    "reply to",
    tools.reply,
    (execute) =>
      execute(
        context.provider === "instagram"
          ? { ig_comment_id: externalCommentId, message }
          : context.provider === "facebook"
            ? { object_id: externalCommentId, message }
            : { parentId: externalCommentId, textOriginal: message },
      ),
  );
  return text(record(result)?.id);
}
