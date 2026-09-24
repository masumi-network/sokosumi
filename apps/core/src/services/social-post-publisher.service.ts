import { randomUUID } from "node:crypto";
import type { Prisma, SocialPostStatus } from "@sokosumi/database";
import type { SocialPostMediaRef } from "@sokosumi/utils";

import { publishXPost } from "@/clients/composio.client";
import { CALENDAR_BETA_USER_WHERE } from "@/helpers/calendar-beta-access";
import { badRequest, conflict, notFound } from "@/helpers/error";
import {
  downloadSocialPostMedia,
  requireSocialPostMedia,
} from "@/helpers/social-post-media";
import { classifyPublishError } from "@/helpers/social-post-publish-errors";
import prisma from "@/lib/db/prisma";
import { projectExecutorUserId } from "@/services/project-social-connections.service";
import {
  getSocialPost,
  type SocialPostSummary,
} from "@/services/social-posts.service";

export const LEASE_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
/** A retry never lands later than this after the planned time. */
export const RETRY_WINDOW_MS = 15 * 60_000;
/** A post first seen this long after its planned time is missed, not published. */
export const MISSED_AFTER_MS = 60 * 60_000;
export const RETRY_BACKOFF_MS = [60_000, 180_000] as const;

/** Leave time for session cleanup and durable settlement before runtime/lease expiry. */
const PUBLISH_BUDGET_MS = 240_000;
const SETTLEMENT_RESERVE_MS = 20_000;

const X_CREATE_POST_TOOL_SLUG = "TWITTER_CREATION_OF_A_POST";
const REVISION_CONFLICT_MESSAGE = "Social post was modified, reload and retry";
const CONNECTION_INACTIVE_ERROR = "Social connection needs reconnecting";
const PUBLISH_NOW_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "FAILED",
  "MISSED",
];

export interface PublishDueSocialPostsInput {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

export interface PublishDueSocialPostsResult {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  missed: number;
  /** Claim races lost to another worker plus leases lost mid-publish. */
  skipped: number;
}

export interface PublishSocialPostNowInput {
  projectId: string;
  workspaceId: string;
  userId: string;
  postId: string;
  revision: number;
}

const publisherInclude = {
  socialConnection: {
    select: {
      id: true,
      status: true,
      composioConnectedAccountId: true,
      externalHandle: true,
    },
  },
} satisfies Prisma.SocialPostInclude;

type PublisherPostRecord = Prisma.SocialPostGetPayload<{
  include: typeof publisherInclude;
}>;

/** A post this worker holds under a lease. */
interface ClaimedPost {
  id: string;
  projectId: string;
  text: string;
  /** Raw `media` Json column; parsed strictly at publish time. */
  media: unknown;
  scheduledAt: Date | null;
  attemptCount: number;
  leaseToken: string;
  recoveringLease?: boolean;
  socialConnection: PublisherPostRecord["socialConnection"];
}

type AttemptTrigger = "scheduler" | "publish_now";
type AttemptOutcome = "published" | "retried" | "failed" | "missed" | "skipped";

interface AttemptOptions {
  trigger: AttemptTrigger;
  actorUserId?: string;
  execution?: PublishDueSocialPostsInput;
}

function publishedUrl(handle: string | null, externalId: string): string {
  return handle
    ? `https://x.com/${encodeURIComponent(handle)}/status/${externalId}`
    : `https://x.com/i/web/status/${externalId}`;
}

function minutesLate(scheduledAt: Date, now: Date): number {
  return Math.floor((now.getTime() - scheduledAt.getTime()) / 60_000);
}

function leaseData(now: Date, leaseToken: string) {
  return {
    status: "PUBLISHING" as const,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    lastAttemptAt: now,
  };
}

/** Every post write after the claim is fenced on the lease; a lost lease never overwrites another worker. */
async function settle(
  post: ClaimedPost,
  data: Prisma.SocialPostUncheckedUpdateManyInput,
): Promise<boolean> {
  const result = await prisma.socialPost.updateMany({
    where: { id: post.id, leaseToken: post.leaseToken },
    data: {
      ...data,
      nextAttemptAt: data.nextAttemptAt ?? null,
      leaseToken: null,
      leaseExpiresAt: null,
      revision: { increment: 1 },
    },
  });
  if (result.count === 0) {
    console.warn("[social-post-publisher] Lost lease; leaving post untouched", {
      postId: post.id,
      status: data.status,
    });
    return false;
  }
  return true;
}

async function nextAttemptNumber(postId: string): Promise<number> {
  const { _max } = await prisma.socialPostPublishAttempt.aggregate({
    where: { socialPostId: postId },
    _max: { attempt: true },
  });
  return (_max.attempt ?? 0) + 1;
}

async function recordSkippedAttempt(
  post: ClaimedPost,
  options: AttemptOptions,
  outcome: "missed" | "connection_inactive",
  now: Date,
): Promise<void> {
  await prisma.socialPostPublishAttempt.create({
    data: {
      socialPostId: post.id,
      attempt: await nextAttemptNumber(post.id),
      trigger: options.trigger,
      actorUserId: options.actorUserId ?? null,
      toolSlug: null,
      finishedAt: now,
      outcome,
    },
    select: { id: true },
  });
}

async function attemptPublish(
  post: ClaimedPost,
  options: AttemptOptions,
): Promise<AttemptOutcome> {
  const now = new Date();

  if (post.recoveringLease) {
    const previous = await prisma.socialPostPublishAttempt.findFirst({
      where: { socialPostId: post.id },
      orderBy: { attempt: "desc" },
      select: {
        outcome: true,
        externalId: true,
        finishedAt: true,
        providerOutcome: true,
      },
    });
    if (previous?.finishedAt) {
      switch (previous.outcome) {
        case "succeeded": {
          if (!previous.externalId) break;
          const settled = await settle(post, {
            status: "PUBLISHED",
            publishedAt: previous.finishedAt,
            publishedExternalId: previous.externalId,
            publishedUrl: publishedUrl(
              post.socialConnection?.externalHandle ?? null,
              previous.externalId,
            ),
            lastError: null,
            attemptCount: post.attemptCount + 1,
          });
          return settled ? "published" : "skipped";
        }
        case "failed_transient": {
          const backoff = RETRY_BACKOFF_MS[post.attemptCount];
          if (backoff === undefined) break;
          const settled = await settle(post, {
            status: "SCHEDULED",
            nextAttemptAt: new Date(previous.finishedAt.getTime() + backoff),
            attemptCount: post.attemptCount + 1,
            lastError:
              previous.providerOutcome ?? "Publishing failed temporarily",
          });
          return settled ? "retried" : "skipped";
        }
        case "failed_permanent": {
          const settled = await settle(post, {
            status: "FAILED",
            lastError: previous.providerOutcome ?? "Publishing failed",
            attemptCount: post.attemptCount + 1,
          });
          return settled ? "failed" : "skipped";
        }
        case "missed": {
          if (!post.scheduledAt) break;
          const settled = await settle(post, {
            status: "MISSED",
            lastError: `Missed: found ${minutesLate(post.scheduledAt, previous.finishedAt)} minutes after the planned time`,
          });
          return settled ? "missed" : "skipped";
        }
        case "connection_inactive": {
          const settled = await settle(post, {
            status: "FAILED",
            lastError: CONNECTION_INACTIVE_ERROR,
          });
          return settled ? "failed" : "skipped";
        }
      }
    }
    const settled = await settle(post, {
      status: "FAILED",
      lastError:
        "The previous publishing attempt could not be confirmed. Check X before retrying to avoid a duplicate post.",
    });
    return settled ? "failed" : "skipped";
  }

  if (
    post.attemptCount > 0 &&
    post.scheduledAt &&
    now.getTime() > post.scheduledAt.getTime() + RETRY_WINDOW_MS
  ) {
    const settled = await settle(post, {
      status: "FAILED",
      lastError:
        "The publishing retry window expired. Reschedule or publish the post manually.",
    });
    return settled ? "failed" : "skipped";
  }

  if (
    post.attemptCount === 0 &&
    post.scheduledAt &&
    now.getTime() - post.scheduledAt.getTime() > MISSED_AFTER_MS
  ) {
    await recordSkippedAttempt(post, options, "missed", now);
    const settled = await settle(post, {
      status: "MISSED",
      lastError: `Missed: found ${minutesLate(post.scheduledAt, now)} minutes after the planned time`,
    });
    return settled ? "missed" : "skipped";
  }

  const connection = post.socialConnection;
  if (!connection || connection.status !== "active") {
    await recordSkippedAttempt(post, options, "connection_inactive", now);
    const settled = await settle(post, {
      status: "FAILED",
      lastError: CONNECTION_INACTIVE_ERROR,
    });
    return settled ? "failed" : "skipped";
  }

  const attempt = await prisma.socialPostPublishAttempt.create({
    data: {
      socialPostId: post.id,
      attempt: await nextAttemptNumber(post.id),
      trigger: options.trigger,
      actorUserId: options.actorUserId ?? null,
      toolSlug: X_CREATE_POST_TOOL_SLUG,
    },
    select: { id: true },
  });
  const attemptCount = post.attemptCount + 1;

  const deadlineMs = Math.min(
    Date.now() + PUBLISH_BUDGET_MS,
    options.execution
      ? options.execution.deadlineMs - SETTLEMENT_RESERVE_MS
      : Infinity,
  );
  const timeoutSignal = AbortSignal.timeout(
    Math.max(1, deadlineMs - Date.now()),
  );
  const signal = options.execution
    ? AbortSignal.any([options.execution.abortSignal, timeoutSignal])
    : timeoutSignal;
  let published: { externalId: string };
  let media: SocialPostMediaRef[] = [];
  try {
    if (Date.now() >= deadlineMs)
      throw new DOMException("Publish deadline exceeded", "TimeoutError");
    signal.throwIfAborted();
    media = requireSocialPostMedia(post.media, post.id);
    published = await publishXPost({
      connectedAccountId: connection.composioConnectedAccountId,
      executorUserId: projectExecutorUserId(post.projectId),
      text: post.text,
      media: await downloadSocialPostMedia(media, signal),
      signal,
    });
  } catch (error) {
    const finishedAt = new Date();
    const classified = classifyPublishError(error);
    const backoff = RETRY_BACKOFF_MS[post.attemptCount];
    const retryAt =
      backoff === undefined ? null : new Date(finishedAt.getTime() + backoff);
    const retrying =
      classified.transient &&
      attemptCount < MAX_ATTEMPTS &&
      retryAt !== null &&
      post.scheduledAt !== null &&
      retryAt.getTime() <= post.scheduledAt.getTime() + RETRY_WINDOW_MS;
    console.warn("[social-post-publisher] Publish attempt failed", {
      postId: post.id,
      attempt: attemptCount,
      kind: classified.kind,
      retrying,
    });
    await prisma.socialPostPublishAttempt.update({
      where: { id: attempt.id },
      data: {
        finishedAt,
        outcome: retrying ? "failed_transient" : "failed_permanent",
        errorKind: classified.kind,
        providerOutcome: classified.summary,
        externalId: null,
      },
    });
    const settled = await settle(
      post,
      retrying
        ? {
            status: "SCHEDULED",
            nextAttemptAt: retryAt,
            attemptCount,
            lastError: classified.summary,
          }
        : { status: "FAILED", lastError: classified.summary, attemptCount },
    );
    if (!settled) return "skipped";
    return retrying ? "retried" : "failed";
  }

  const finishedAt = new Date();
  await prisma.socialPostPublishAttempt.update({
    where: { id: attempt.id },
    data: {
      finishedAt,
      outcome: "succeeded",
      errorKind: null,
      providerOutcome:
        media.length > 0 ? `201 created, ${media.length} media` : "201 created",
      externalId: published.externalId,
    },
  });
  const settled = await settle(post, {
    status: "PUBLISHED",
    publishedAt: finishedAt,
    publishedExternalId: published.externalId,
    publishedUrl: publishedUrl(connection.externalHandle, published.externalId),
    lastError: null,
    attemptCount,
  });
  return settled ? "published" : "skipped";
}

type ClaimResult = { post: ClaimedPost } | "none" | "lost";

/**
 * Optimistic claim of the earliest due post (or one whose lease expired): the
 * row must still carry the observed status and revision when the lease lands.
 *
 * Fresh scheduled posts require a current Calendar beta member. Expired
 * publishing leases are always recovered so a previously started attempt can
 * be reconciled even after the scheduling user loses beta access.
 */
async function claimDuePost(): Promise<ClaimResult> {
  const now = new Date();
  const candidate = await prisma.socialPost.findFirst({
    where: {
      OR: [
        {
          status: "SCHEDULED",
          scheduledByUser: CALENDAR_BETA_USER_WHERE,
          scheduledAt: { lte: now },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: "PUBLISHING", leaseExpiresAt: { lt: now } },
      ],
    },
    include: publisherInclude,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
  if (!candidate) return "none";

  const leaseToken = randomUUID();
  const claimed = await prisma.socialPost.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      revision: candidate.revision,
    },
    data: { ...leaseData(now, leaseToken), revision: { increment: 1 } },
  });
  if (claimed.count === 0) return "lost";
  return {
    post: {
      id: candidate.id,
      projectId: candidate.projectId,
      text: candidate.text,
      media: candidate.media,
      scheduledAt: candidate.scheduledAt,
      attemptCount: candidate.attemptCount,
      leaseToken,
      recoveringLease: candidate.status === "PUBLISHING",
      socialConnection: candidate.socialConnection,
    },
  };
}

export async function publishDueSocialPosts(
  input: PublishDueSocialPostsInput,
): Promise<PublishDueSocialPostsResult> {
  const result: PublishDueSocialPostsResult = {
    claimed: 0,
    published: 0,
    retried: 0,
    failed: 0,
    missed: 0,
    skipped: 0,
  };
  while (
    input.shouldContinue() &&
    !input.abortSignal.aborted &&
    Date.now() < input.deadlineMs - SETTLEMENT_RESERVE_MS
  ) {
    const claim = await claimDuePost();
    if (claim === "none") break;
    if (claim === "lost") {
      result.skipped += 1;
      continue;
    }
    result.claimed += 1;
    const outcome = await attemptPublish(claim.post, {
      trigger: "scheduler",
      execution: input,
    });
    result[outcome] += 1;
  }
  return result;
}

/**
 * Human "publish now": resets the retry state, takes the lease under the
 * observed revision, and attempts inline. The missed rule cannot trigger
 * because the planned time becomes now.
 */
export async function publishSocialPostNow(
  input: PublishSocialPostNowInput,
): Promise<SocialPostSummary> {
  const post = await prisma.socialPost.findFirst({
    where: {
      id: input.postId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    },
    include: publisherInclude,
  });
  if (!post) {
    throw notFound("Social post not found");
  }
  if (!PUBLISH_NOW_STATUSES.includes(post.status)) {
    throw conflict("This post cannot be published now");
  }
  if (post.revision !== input.revision) {
    throw conflict(REVISION_CONFLICT_MESSAGE);
  }
  if (post.status === "DRAFT") {
    if (!post.socialConnection) {
      throw badRequest("A social connection is required to publish a post");
    }
    if (post.socialConnection.status !== "active") {
      throw conflict("Social connection is not active");
    }
  }

  const now = new Date();
  const leaseToken = randomUUID();
  const claimed = await prisma.socialPost.updateMany({
    where: { id: post.id, revision: input.revision },
    data: {
      ...leaseData(now, leaseToken),
      scheduledAt: now,
      scheduledByUserId: input.userId,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      revision: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    throw conflict(REVISION_CONFLICT_MESSAGE);
  }

  await attemptPublish(
    {
      id: post.id,
      projectId: post.projectId,
      text: post.text,
      media: post.media,
      scheduledAt: now,
      attemptCount: 0,
      leaseToken,
      socialConnection: post.socialConnection,
    },
    { trigger: "publish_now", actorUserId: input.userId },
  );
  return getSocialPost({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    postId: input.postId,
  });
}
