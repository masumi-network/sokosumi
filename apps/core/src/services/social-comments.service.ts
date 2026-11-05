import type { Prisma } from "@sokosumi/database";
import { socialPostProviderLabel } from "@sokosumi/utils";

import {
  isSocialCommentProvider,
  listPostComments,
  replyToComment,
  SOCIAL_COMMENT_PROVIDERS,
  SOCIAL_COMMENT_REPLY_MAX,
  type SocialCommentContext,
} from "@/clients/social-post-providers/comments";
import prisma from "@/lib/db/prisma";
import { projectExecutorUserId } from "@/services/project-social-connections.service";

const DAY_MS = 86_400_000;
/** Posts younger than this are checked for new comments. */
const POST_WINDOW_DAYS = 14;
/** Older comments were seen by the owner already; Cuso leaves them. */
const COMMENT_WINDOW_DAYS = 3;
/** New comments one call hands Cuso; the rest wait for the next round. */
const LIST_LIMIT = 25;
/** Replies one Project posts per day, across its networks. */
export const SOCIAL_REPLIES_PER_DAY = 20;

export class SocialCommentRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialCommentRefusedError";
  }
}

async function contextFor(
  projectId: string,
  socialConnectionId: string | null,
  provider: string,
): Promise<SocialCommentContext | null> {
  if (!socialConnectionId || !isSocialCommentProvider(provider)) return null;
  const connection = await prisma.projectSocialConnection.findFirst({
    where: { id: socialConnectionId, projectId, status: "active", provider },
  });
  if (!connection) return null;
  return {
    provider,
    connectedAccountId: connection.composioConnectedAccountId,
    executorUserId: projectExecutorUserId(projectId),
    externalAccountId: connection.externalAccountId,
  };
}

/**
 * Reads the comments on the Project's recent published posts, keeps the new
 * ones, and returns those not handled yet, oldest first. A network that
 * refuses is named in `unavailable` rather than failing the round.
 */
export async function collectNewSocialComments(input: {
  projectId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const posts = await prisma.socialPost.findMany({
    where: {
      projectId: input.projectId,
      status: "PUBLISHED",
      provider: { in: [...SOCIAL_COMMENT_PROVIDERS] },
      publishedExternalId: { not: null },
      publishedAt: { gte: new Date(now.getTime() - POST_WINDOW_DAYS * DAY_MS) },
    },
    select: {
      id: true,
      provider: true,
      publishedExternalId: true,
      socialConnectionId: true,
    },
  });
  const since = new Date(now.getTime() - COMMENT_WINDOW_DAYS * DAY_MS);
  const unavailable = new Set<string>();
  for (const post of posts) {
    const context = await contextFor(
      input.projectId,
      post.socialConnectionId,
      post.provider,
    );
    if (!context || !post.publishedExternalId) continue;
    const comments = await listPostComments(
      context,
      post.publishedExternalId,
    ).catch(() => {
      unavailable.add(socialPostProviderLabel(context.provider));
      return [];
    });
    const fresh = comments.filter(
      (comment) => !comment.commentedAt || comment.commentedAt >= since,
    );
    if (fresh.length === 0) continue;
    await prisma.socialComment.createMany({
      data: fresh.map((comment) => ({
        projectId: input.projectId,
        socialPostId: post.id,
        provider: post.provider,
        externalCommentId: comment.externalId,
        authorName: comment.authorName,
        authorExternalId: comment.authorExternalId,
        text: comment.text.slice(0, 2_000),
        commentedAt: comment.commentedAt,
      })),
      skipDuplicates: true,
    });
  }
  // Comments left for a later round age out too, or a busy day's backlog
  // keeps Cuso answering ever older comments first.
  const open = await prisma.socialComment.findMany({
    where: {
      projectId: input.projectId,
      status: "NEW",
      OR: [
        { commentedAt: { gte: since } },
        { commentedAt: null, createdAt: { gte: since } },
      ],
    },
    orderBy: { commentedAt: "asc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      provider: true,
      authorName: true,
      text: true,
      commentedAt: true,
      socialPost: { select: { text: true, publishedUrl: true } },
    },
  });
  return {
    comments: open.map((comment) => ({
      commentId: comment.id,
      network: isSocialCommentProvider(comment.provider)
        ? socialPostProviderLabel(comment.provider)
        : comment.provider,
      author: comment.authorName,
      text: comment.text,
      commentedAt: comment.commentedAt?.toISOString() ?? null,
      post: comment.socialPost.text.slice(0, 280),
      postUrl: comment.socialPost.publishedUrl,
    })),
    unavailable: [...unavailable],
    repliesLeftToday: await repliesLeftToday(input.projectId, now),
  };
}

async function repliesLeftToday(
  projectId: string,
  now: Date,
  exceptCommentId?: string,
) {
  const sent = await prisma.socialComment.count({
    where: {
      projectId,
      id: exceptCommentId ? { not: exceptCommentId } : undefined,
      status: "REPLIED",
      handledAt: { gte: new Date(now.getTime() - DAY_MS) },
    },
  });
  return Math.max(0, SOCIAL_REPLIES_PER_DAY - sent);
}

/**
 * Records what Cuso did with one comment: posts the reply, or marks it
 * skipped or for the owner. Only a comment of this Project that is still new,
 * within the day's cap, and one reply per person per post.
 */
export async function handleSocialComment(input: {
  projectId: string;
  commentId: string;
  action: "reply" | "skip" | "owner";
  reply?: string;
  note?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const comment = await prisma.socialComment.findFirst({
    where: { id: input.commentId, projectId: input.projectId },
    include: {
      socialPost: { select: { socialConnectionId: true, provider: true } },
    },
  });
  if (!comment) throw new SocialCommentRefusedError("No such comment.");
  const handled = () =>
    new SocialCommentRefusedError("This comment was handled already.");
  if (comment.status !== "NEW") throw handled();
  // Claiming the row first makes it the lock: of two racing calls only one
  // moves it off NEW, and the checks below count the other claims.
  const claim = (data: Prisma.SocialCommentUpdateManyMutationInput) =>
    prisma.socialComment.updateMany({
      where: { id: comment.id, status: "NEW" },
      data: { ...data, handledAt: now },
    });
  if (input.action !== "reply") {
    const { count } = await claim({
      status: input.action === "skip" ? "SKIPPED" : "OWNER",
      note: input.note?.slice(0, 500) ?? null,
    });
    if (count === 0) throw handled();
    return { status: input.action === "skip" ? "skipped" : "owner" };
  }
  const reply = input.reply?.trim() ?? "";
  if (!reply || reply.length > SOCIAL_COMMENT_REPLY_MAX)
    throw new SocialCommentRefusedError(
      `Write a reply of 1 to ${SOCIAL_COMMENT_REPLY_MAX} characters.`,
    );
  if ((await claim({ status: "REPLIED", reply })).count === 0) throw handled();
  let replyExternalId: string | null;
  try {
    if ((await repliesLeftToday(input.projectId, now, comment.id)) === 0)
      throw new SocialCommentRefusedError(
        `That was today's last reply (${SOCIAL_REPLIES_PER_DAY}). Leave the rest for tomorrow.`,
      );
    if (comment.authorExternalId) {
      const answered = await prisma.socialComment.count({
        where: {
          id: { not: comment.id },
          socialPostId: comment.socialPostId,
          authorExternalId: comment.authorExternalId,
          status: "REPLIED",
        },
      });
      if (answered > 0)
        throw new SocialCommentRefusedError(
          "You replied to this person on this post already. Skip this one.",
        );
    }
    const context = await contextFor(
      input.projectId,
      comment.socialPost.socialConnectionId,
      comment.provider,
    );
    if (!context)
      throw new SocialCommentRefusedError(
        "The account that published this post is no longer connected.",
      );
    replyExternalId = await replyToComment(
      context,
      comment.externalCommentId,
      reply,
    );
  } catch (error) {
    // Nothing was posted: the comment is new again for a later round.
    await prisma.socialComment.updateMany({
      where: { id: comment.id, status: "REPLIED", replyExternalId: null },
      data: { status: "NEW", reply: null, handledAt: null },
    });
    throw error;
  }
  await prisma.socialComment.update({
    where: { id: comment.id },
    data: { replyExternalId },
  });
  return { status: "replied", reply };
}

/** The comment a reply answers, for the safety check before posting. */
export async function socialCommentText(projectId: string, commentId: string) {
  const comment = await prisma.socialComment.findFirst({
    where: { id: commentId, projectId },
    select: { text: true },
  });
  return comment?.text ?? null;
}
