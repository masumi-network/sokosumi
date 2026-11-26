import type { Prisma } from "@sokosumi/database";
import { socialPostProviderLabel } from "@sokosumi/utils";

import {
  commentsReadable,
  isSocialCommentProvider,
  listPostComments,
  listXReplies,
  type ProviderComment,
  replyToComment,
  SOCIAL_COMMENT_PROVIDERS,
  type SocialCommentContext,
  type SocialCommentProvider,
  socialCommentReplyFits,
} from "@/clients/social-post-providers/comments";
import prisma from "@/lib/db/prisma";
import { recordCoreError } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { connectionExecutorUserId } from "@/services/project-social-connections.service";
import { TEST_COPY_NOTHING_AT_ONCE } from "@/services/project-test-copy";

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
  if (
    !connection ||
    !commentsReadable(provider, connection.composioConnectedAccountId)
  )
    return null;
  return {
    provider,
    connectedAccountId: connection.composioConnectedAccountId,
    executorUserId: connectionExecutorUserId(connection),
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
  const refused = (provider: SocialCommentProvider) => (error: unknown) => {
    unavailable.add(socialPostProviderLabel(provider));
    // Comment text can be in the error, so content-free metadata only.
    recordCoreError(
      { operation: "social_comments_read", provider },
      {
        message: `Could not read ${socialPostProviderLabel(provider)} comments`,
        why: "The network or Composio refused the comment read",
        fix: "Cuso's reply round skipped this network today. Look up the error under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return [];
  };
  const save = async (
    post: { id: string; provider: string },
    comments: ProviderComment[],
  ) => {
    const fresh = comments.filter(
      (comment) => !comment.commentedAt || comment.commentedAt >= since,
    );
    if (fresh.length === 0) return;
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
  };
  const xPosts = new Map<string, typeof posts>();
  for (const post of posts) {
    if (post.provider === "x" && post.socialConnectionId) {
      xPosts.set(post.socialConnectionId, [
        ...(xPosts.get(post.socialConnectionId) ?? []),
        post,
      ]);
      continue;
    }
    const context = await contextFor(
      input.projectId,
      post.socialConnectionId,
      post.provider,
    );
    if (!context || !post.publishedExternalId) continue;
    const comments = await listPostComments(
      context,
      post.publishedExternalId,
    ).catch(refused(context.provider));
    await save(post, comments);
  }
  // X: one read of the account's mentions covers all its posts.
  for (const [connectionId, accountPosts] of xPosts) {
    const context = await contextFor(input.projectId, connectionId, "x");
    if (!context) continue;
    const newest = await prisma.socialComment.findFirst({
      where: { projectId: input.projectId, provider: "x" },
      orderBy: { commentedAt: "desc" },
      select: { externalCommentId: true },
    });
    const replies = await listXReplies(context, {
      startTime: since,
      sinceId: newest?.externalCommentId,
    }).catch(refused("x"));
    for (const post of accountPosts) {
      await save(
        post,
        replies.filter(
          (reply) => reply.conversationId === post.publishedExternalId,
        ),
      );
    }
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
      ...(exceptCommentId ? { id: { not: exceptCommentId } } : {}),
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
      socialPost: {
        select: {
          socialConnectionId: true,
          publishedExternalId: true,
          provider: true,
          project: { select: { testCopyOfProjectId: true } },
        },
      },
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
  if (!isSocialCommentProvider(comment.provider))
    throw new SocialCommentRefusedError("No such comment.");
  const fit = socialCommentReplyFits(comment.provider, reply);
  if (!fit.fits)
    throw new SocialCommentRefusedError(
      `Write a reply of 1 to ${fit.max} characters.`,
    );
  // A reply goes out at once, on a real post (ADR 0073).
  if (comment.socialPost.project?.testCopyOfProjectId)
    throw new SocialCommentRefusedError(TEST_COPY_NOTHING_AT_ONCE);
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
      {
        externalCommentId: comment.externalCommentId,
        externalPostId:
          comment.socialPost.publishedExternalId ?? comment.externalCommentId,
        idempotencyKey: comment.id,
      },
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
