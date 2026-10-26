import type { Prisma, SocialPostStatus } from "@sokosumi/database";
import { badRequest, conflict } from "@/helpers/error";
import { parseSocialPostMedia } from "@/helpers/social-post-media";

export const SOCIAL_POST_QUOTE_WAIT_MS = 30 * 60_000;
export const SOCIAL_POST_QUOTE_BACKOFF_MS = 60_000;
export const QUOTED_POST_CANCELLED = "The quoted post was cancelled";
export const QUOTED_POST_FAILED = "The post it quotes failed to publish";
export const QUOTED_POST_WAIT_EXPIRED =
  "The quoted post did not publish within 30 minutes of this post's scheduled time. Retry after it publishes, pick another post, or remove the quote.";

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

/** Protect existing quotes when their target changes provider or moves later. */
export async function requireSocialPostQuotingPosts(
  post: {
    id: string;
    projectId: string;
    workspaceId: string;
    publishedExternalId: string | null;
  },
  change: { provider: string; scheduledAt: Date | null },
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (post.publishedExternalId) return;
  const dependents = await tx.socialPost.findMany({
    where: {
      quotedPostId: post.id,
      projectId: post.projectId,
      workspaceId: post.workspaceId,
      status:
        change.provider === "x"
          ? { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED", "PUBLISHING"] }
          : { notIn: ["PUBLISHED", "CANCELED"] },
      ...(change.provider === "x"
        ? { scheduledAt: { lte: change.scheduledAt ?? new Date(0) } }
        : {}),
    },
    select: { id: true, text: true, scheduledAt: true },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
  if (dependents.length === 0) return;
  if (change.provider !== "x") {
    throw badRequest("This post must target X because other posts quote it");
  }
  throw conflict(
    dependents
      .map(
        (quote) =>
          `Post ${quote.id} (${quote.text.slice(0, 80)}) quotes this post and is scheduled at ${quote.scheduledAt?.toISOString()}; move it first`,
      )
      .join(". "),
  );
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
    scheduledAt: Date | null;
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
  const deadline =
    (post.scheduledAt ?? now).getTime() + SOCIAL_POST_QUOTE_WAIT_MS;
  if (now.getTime() >= deadline) {
    return { kind: "blocked", reason: QUOTED_POST_WAIT_EXPIRED };
  }
  return {
    kind: "defer",
    retryAt: new Date(
      Math.min(now.getTime() + SOCIAL_POST_QUOTE_BACKOFF_MS, deadline),
    ),
  };
}
