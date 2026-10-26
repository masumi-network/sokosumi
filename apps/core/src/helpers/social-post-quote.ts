import type { Prisma, SocialPostStatus } from "@sokosumi/database";
import { badRequest } from "@/helpers/error";
import { parseSocialPostMedia } from "@/helpers/social-post-media";

export const SOCIAL_POST_QUOTE_BACKOFF_MS = 60_000;
export const SOCIAL_POST_QUOTE_MAX_BACKOFF_MS = 5 * 60_000;
export const QUOTED_POST_CANCELLED = "The quoted post was cancelled";
export const QUOTED_POST_FAILED = "The post it quotes failed to publish";

export const socialPostQuoteSelect = {
  id: true,
  projectId: true,
  workspaceId: true,
  provider: true,
  status: true,
  scheduledAt: true,
  timezone: true,
  publishedExternalId: true,
  publishedUrl: true,
  text: true,
  media: true,
  quotedPostId: true,
  socialConnection: {
    select: {
      id: true,
      externalHandle: true,
      displayName: true,
      avatarUrl: true,
      subscriptionType: true,
      status: true,
    },
  },
} satisfies Prisma.SocialPostSelect;

type QuotedPostRecord = Prisma.SocialPostGetPayload<{
  select: typeof socialPostQuoteSelect;
}>;

export function mapSocialPostQuote(post: QuotedPostRecord) {
  return {
    id: post.id,
    provider: post.provider,
    status: post.status,
    scheduledAt: post.scheduledAt,
    timezone: post.timezone,
    publishedExternalId: post.publishedExternalId,
    publishedUrl: post.publishedUrl,
    account: post.socialConnection,
    text: post.text,
    media: parseSocialPostMedia(post.media, post.id).slice(0, 1),
  };
}

interface QuoteScope {
  projectId: string;
  workspaceId: string;
  postId?: string;
  provider: string;
  quotedPostId: string | null;
  needsAttentionReason?: string | null;
  scheduledAt?: Date | null;
  publishNow?: boolean;
}

/** Validates edits and every path that schedules/dispatches a post, inside its transaction. */
export async function requireSocialPostQuote(
  input: QuoteScope,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (!input.quotedPostId) {
    if (input.needsAttentionReason)
      throw badRequest(input.needsAttentionReason);
    return;
  }
  if (input.provider !== "x") {
    throw badRequest("Only X posts can quote another post");
  }
  if (input.quotedPostId === input.postId) {
    throw badRequest("A post cannot quote itself");
  }
  const quoted = await tx.socialPost.findFirst({
    where: {
      id: input.quotedPostId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    },
    select: socialPostQuoteSelect,
  });
  if (!quoted) {
    throw badRequest("The quoted post must belong to the same project");
  }
  if (quoted.provider !== "x") {
    throw badRequest("The quoted post must target X");
  }
  const visited = new Set(input.postId ? [input.postId] : []);
  let ancestor: { id: string; quotedPostId: string | null } | null = quoted;
  while (ancestor) {
    if (visited.has(ancestor.id)) {
      throw badRequest("Posts cannot form a quote cycle");
    }
    visited.add(ancestor.id);
    ancestor = ancestor.quotedPostId
      ? await tx.socialPost.findFirst({
          where: {
            id: ancestor.quotedPostId,
            projectId: input.projectId,
            workspaceId: input.workspaceId,
          },
          select: { id: true, quotedPostId: true },
        })
      : null;
  }

  if (input.needsAttentionReason === QUOTED_POST_CANCELLED) {
    throw badRequest(QUOTED_POST_CANCELLED);
  }
  if (quoted.status === "CANCELED") throw badRequest(QUOTED_POST_CANCELLED);
  // A failed thread with a confirmed head is still a valid quote target.
  if (quoted.publishedExternalId) return;
  if (["FAILED", "MISSED", "PUBLISHED"].includes(quoted.status)) {
    throw badRequest(QUOTED_POST_FAILED);
  }
  if (input.publishNow) {
    throw badRequest(
      "This post cannot be published now because the quoted post is not live yet. Schedule it after the quoted post.",
    );
  }
  // Drafts/duplicates may keep a reference before either schedule is chosen.
  if (!input.scheduledAt) return;
  if (!quoted.scheduledAt) {
    throw badRequest("Schedule the quoted post before scheduling this quote");
  }
  if (input.scheduledAt.getTime() <= quoted.scheduledAt.getTime()) {
    throw badRequest(
      `This quote must be scheduled strictly after the quoted post at ${quoted.scheduledAt.toISOString()}`,
    );
  }
}

export interface MovedSocialPostQuote {
  id: string;
  scheduledAt: Date;
}

/** Move dependent schedules in the same transaction, leaving approval and ownership intact. */
export async function moveSocialPostQuotes(
  post: {
    id: string;
    projectId: string;
    workspaceId: string;
    publishedExternalId: string | null;
    scheduledAt: Date | null;
  },
  change: { provider: string; scheduledAt: Date | null },
  tx: Prisma.TransactionClient,
): Promise<MovedSocialPostQuote[]> {
  if (post.publishedExternalId) return [];
  if (change.provider !== "x") {
    const dependents = await tx.socialPost.findMany({
      where: {
        quotedPostId: post.id,
        projectId: post.projectId,
        workspaceId: post.workspaceId,
        status: { notIn: ["PUBLISHED", "CANCELED"] },
      },
      select: { id: true },
    });
    if (dependents.length > 0)
      throw badRequest("This post must target X because other posts quote it");
    return [];
  }
  if (
    !change.scheduledAt ||
    (post.scheduledAt && change.scheduledAt <= post.scheduledAt)
  )
    return [];

  const moved: MovedSocialPostQuote[] = [];
  const pending = [
    { id: post.id, oldTime: post.scheduledAt, newTime: change.scheduledAt },
  ];
  const visited = new Set([post.id]);
  for (let index = 0; index < pending.length; index++) {
    const parent = pending[index];
    const quotes = await tx.socialPost.findMany({
      where: {
        quotedPostId: parent.id,
        projectId: post.projectId,
        workspaceId: post.workspaceId,
        publishedExternalId: null,
        status: { notIn: ["PUBLISHED", "CANCELED"] },
        scheduledAt: { lte: parent.newTime },
      },
      select: { id: true, scheduledAt: true },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    });
    for (const quote of quotes) {
      if (visited.has(quote.id) || !quote.scheduledAt) continue;
      visited.add(quote.id);
      const gap = parent.oldTime
        ? quote.scheduledAt.getTime() - parent.oldTime.getTime()
        : 0;
      const scheduledAt = new Date(
        parent.newTime.getTime() + (gap > 0 ? gap : 60_000),
      );
      await tx.socialPost.updateMany({
        where: { id: quote.id },
        data: { scheduledAt, nextAttemptAt: null, revision: { increment: 1 } },
      });
      moved.push({ id: quote.id, scheduledAt });
      pending.push({
        id: quote.id,
        oldTime: quote.scheduledAt,
        newTime: scheduledAt,
      });
    }
  }
  return moved;
}

/** Drafts keep approval ownership; queued dependents stop and require a human retry. */
export async function flagSocialPostQuotes(
  quotedPostId: string,
  reason: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const where = {
    quotedPostId,
    publishedExternalId: null,
  };
  const dependents = await tx.socialPost.findMany({
    where: { ...where, status: { notIn: ["PUBLISHED", "CANCELED"] } },
    select: { id: true, status: true },
  });
  const drafts = dependents.filter((post) =>
    ["DRAFT", "NEEDS_APPROVAL"].includes(post.status),
  );
  const queued = dependents.filter(
    (post) => !["DRAFT", "NEEDS_APPROVAL"].includes(post.status),
  );
  const data = {
    needsAttentionReason: reason,
    lastError: reason,
    nextAttemptAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    revision: { increment: 1 },
  };
  if (drafts.length > 0)
    await tx.socialPost.updateMany({
      where: {
        ...where,
        id: { in: drafts.map((post) => post.id) },
        status: { in: ["DRAFT", "NEEDS_APPROVAL"] },
      },
      data,
    });
  if (queued.length > 0)
    await tx.socialPost.updateMany({
      where: {
        ...where,
        id: { in: queued.map((post) => post.id) },
        status: { in: ["SCHEDULED", "PUBLISHING", "FAILED", "MISSED"] },
      },
      data: { ...data, status: "FAILED" },
    });
}

interface QuoteDependency {
  status: SocialPostStatus;
  publishedExternalId: string | null;
}

type QuotePublishDecision =
  | { kind: "ready"; externalId?: string }
  | { kind: "defer"; retryAt: Date }
  | { kind: "blocked"; reason: string };

export function socialPostQuotePublishDecision(
  post: {
    quotedPostId: string | null;
    needsAttentionReason: string | null;
    publishedExternalId: string | null;
    lastAttemptAt?: Date | null;
    nextAttemptAt?: Date | null;
  },
  quoted: QuoteDependency | null,
  now: Date,
): QuotePublishDecision {
  // A resumed thread only posts replies; its quote is already on X.
  if (post.publishedExternalId) return { kind: "ready" };
  if (post.needsAttentionReason === QUOTED_POST_CANCELLED) {
    return { kind: "blocked", reason: QUOTED_POST_CANCELLED };
  }
  if (!post.quotedPostId) {
    return post.needsAttentionReason
      ? { kind: "blocked", reason: post.needsAttentionReason }
      : { kind: "ready" };
  }
  if (!quoted || quoted.status === "CANCELED" || quoted.status === "DRAFT") {
    return { kind: "blocked", reason: QUOTED_POST_CANCELLED };
  }
  if (quoted.publishedExternalId) {
    return { kind: "ready", externalId: quoted.publishedExternalId };
  }
  if (["FAILED", "MISSED", "PUBLISHED"].includes(quoted.status)) {
    return { kind: "blocked", reason: QUOTED_POST_FAILED };
  }
  const previousDelay =
    post.nextAttemptAt && post.lastAttemptAt
      ? post.nextAttemptAt.getTime() - post.lastAttemptAt.getTime()
      : 0;
  const delay = Math.min(
    SOCIAL_POST_QUOTE_MAX_BACKOFF_MS,
    Math.max(SOCIAL_POST_QUOTE_BACKOFF_MS, previousDelay * 2),
  );
  return {
    kind: "defer",
    retryAt: new Date(now.getTime() + delay),
  };
}

export function isSocialPostWaitingForQuote(
  post: Parameters<typeof socialPostQuotePublishDecision>[0] & {
    status: SocialPostStatus;
    scheduledAt: Date | null;
  },
  quoted: QuoteDependency | null,
  now: Date,
): boolean {
  return (
    (post.status === "SCHEDULED" || post.status === "PUBLISHING") &&
    post.scheduledAt !== null &&
    post.scheduledAt <= now &&
    socialPostQuotePublishDecision(post, quoted, now).kind === "defer"
  );
}
