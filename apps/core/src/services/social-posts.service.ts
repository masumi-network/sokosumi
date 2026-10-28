import type {
  Prisma,
  ProjectSocialConnection,
  SocialPostStatus,
} from "@sokosumi/database";
import {
  type SocialPostPlanning,
  socialPostPlanningSchema,
} from "@sokosumi/soko-bot";
import {
  CORE_API_ERROR_KINDS,
  isSocialProviderEnabled,
  SOCIAL_POST_FIRST_COMMENT_MAX,
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  SOCIAL_POST_TEXT_LIMITS,
  SOCIAL_POST_TEXT_REQUIRED,
  type SocialPostMediaRef,
  type SocialPostMediaValidationReason,
  type SocialPostProvider,
  socialPostFirstCommentLimit,
  socialPostMediaKindForMime,
  socialPostMediaRequirementMessage,
  socialPostMeetsMediaRequirement,
  socialPostProviderLabel,
  socialPostTextLength,
  socialPostTextLimit,
  validateSocialPostMedia,
} from "@sokosumi/utils";

import {
  requireSocialProviderEnabled,
  socialProviderProjectSelect,
  socialProviderWorkspaceForProject,
} from "@/config/social-providers";
import { requireWorkspaceDriveFileUrl } from "@/helpers/drive-file-ref";
import {
  badRequest,
  conflict,
  internalServerError,
  notFound,
} from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import {
  flagSocialPostQuotes,
  isSocialPostWaitingForQuote,
  type MovedSocialPostQuote,
  mapSocialPostQuote,
  moveSocialPostQuotes,
  QUOTED_POST_CANCELLED,
  requireSocialPostQuote,
  socialPostQuotePublishDecision,
  socialPostQuoteSelect,
} from "@/helpers/social-post-quote";
import {
  SOCIAL_POST_THREAD_MAX_PARTS,
  summarizeSocialPostThread,
} from "@/helpers/social-post-thread";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { socialPostFormattingError } from "@/lib/social-post-writing";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";
import {
  type SocialPostStatistics,
  socialPostStatisticsSchema,
} from "@/schemas/social-post-statistics.schema";
import {
  requireLockedOpenProject,
  requireScopedProject,
} from "@/services/project-social-connections.service";
import { resolveXSubscriptionType } from "@/services/x-subscription-tier.service";

const REVISION_CONFLICT_MESSAGE = "Social post was modified, reload and retry";
const CONNECTION_REQUIRED_MESSAGE =
  "A social connection is required to schedule a post";
const PROJECT_CLOSED_MESSAGE =
  "Cannot schedule or approve Social posts in a closing or closed Project";

const EDITABLE_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
];
const SCHEDULABLE_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
  "FAILED",
  "MISSED",
];
const CANCELABLE_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
  "FAILED",
  "MISSED",
];
const PUBLISH_NOW_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "FAILED",
  "MISSED",
];
const DUPLICATABLE_STATUSES: readonly SocialPostStatus[] = [
  "PUBLISHED",
  "FAILED",
  "MISSED",
];
/** Statuses where a stale connection blocks the next publish. */
const RECONNECT_SENSITIVE_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
];

const socialPostInclude = {
  threadParts: { orderBy: { position: "asc" } },
  quotedPost: { select: socialPostQuoteSelect },
  project: { select: socialProviderProjectSelect },
  socialConnection: {
    select: {
      id: true,
      provider: true,
      externalHandle: true,
      displayName: true,
      avatarUrl: true,
      subscriptionType: true,
      status: true,
    },
  },
  creatorUser: { select: { id: true, name: true } },
  creatorCoworker: { select: { id: true, name: true } },
  creatorSokoBot: { select: { id: true, name: true } },
  attempts: {
    orderBy: { attempt: "desc" },
    take: 1,
    select: {
      attempt: true,
      trigger: true,
      outcome: true,
      errorKind: true,
      providerOutcome: true,
      finishedAt: true,
    },
  },
} satisfies Prisma.SocialPostInclude;

type SocialPostRecord = Prisma.SocialPostGetPayload<{
  include: typeof socialPostInclude;
}>;

export interface SocialPostCreator {
  kind: "user" | "coworker" | "sokoBot";
  id: string;
  name: string | null;
}

export interface SocialPostLastAttempt {
  attempt: number;
  trigger: string;
  outcome: string | null;
  errorKind: string | null;
  providerOutcome: string | null;
  finishedAt: Date | null;
}

export interface SocialPostSummary {
  id: string;
  projectId: string;
  provider: string;
  text: string;
  firstComment: string | null;
  media: SocialPostMediaRef[];
  quotedPostId: string | null;
  quotedPost: ReturnType<typeof mapSocialPostQuote> | null;
  needsAttentionReason: string | null;
  waitingForQuotedPost?: boolean;
  movedQuotes?: MovedSocialPostQuote[];
  threadParts: SocialPostThreadPartSummary[];
  threadPartCount: number;
  publishedThreadPartCount: number;
  failedThreadPartPosition: number | null;
  partiallyPublished: boolean;
  publishingThreadPartPosition: number | null;
  status: SocialPostStatus;
  scheduledAt: Date | null;
  timezone: string | null;
  socialConnection: {
    id: string;
    externalHandle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    subscriptionType: string | null;
    status: string;
  } | null;
  creator: SocialPostCreator;
  scheduledByUserId: string | null;
  scheduledByCoworkerId: string | null;
  canceledAt: Date | null;
  publishedAt: Date | null;
  publishedExternalId: string | null;
  publishedUrl: string | null;
  statistics?: SocialPostStatistics | null;
  lastError: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastAttempt: SocialPostLastAttempt | null;
  revision: number;
  /** The Marketing strategy version that planned it, and its planning record. */
  marketingStrategyId?: string | null;
  planning?: SocialPostPlanning | null;
  createdAt: Date;
  updatedAt: Date;
  canEdit: boolean;
  canSchedule: boolean;
  canCancel: boolean;
  canPublishNow: boolean;
  canApprove: boolean;
  canReject: boolean;
  canDuplicate: boolean;
  /** The linked connection exists but is no longer active, so the post cannot go out. */
  connectionNeedsReconnect: boolean;
}

interface ProjectScope {
  projectId: string;
  workspaceId: string;
}

export interface ListSocialPostsInput extends ProjectScope {
  statuses?: readonly SocialPostStatus[];
  provider?: string;
  quoteCandidates?: boolean;
  excludePostId?: string;
  search?: string;
  publishedFrom?: Date;
  publishedUntil?: Date;
  cursor?: string;
  limit?: number;
}

export interface GetSocialPostInput extends ProjectScope {
  postId: string;
}

/** Active workspace owner: `null` for a personal workspace. Binds media refs to that Drive. */
interface WorkspaceOwnerScope {
  organizationId: string | null;
}

export interface SocialPostThreadPartInput {
  text: string;
  media?: SocialPostMediaRef[];
}

interface SocialPostThreadPartSummary {
  id: string;
  position: number;
  text: string;
  media: SocialPostMediaRef[];
  externalPostId: string | null;
  publishedAt: Date | null;
  error: string | null;
}

export interface CreateSocialPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  sokoBotId?: string;
  text: string;
  firstComment?: string;
  media?: SocialPostMediaRef[];
  threadParts?: SocialPostThreadPartInput[];
  quotedPostId?: string | null;
  socialConnectionId?: string;
  scheduledAt?: Date;
  timezone?: string;
  /** A Soko Bot keeps a link in the post body because the owner asked. */
  linkInPost?: boolean;
}

export interface UpdateSocialPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  /** The Soko Bot editing it: its writing is checked for formatting mistakes. */
  sokoBotId?: string;
  postId: string;
  text?: string;
  firstComment?: string;
  media?: SocialPostMediaRef[];
  threadParts?: SocialPostThreadPartInput[];
  quotedPostId?: string | null;
  socialConnectionId?: string | null;
  scheduledAt?: Date;
  timezone?: string;
  revision: number;
  /** A Soko Bot keeps a link in the post body because the owner asked. */
  linkInPost?: boolean;
}

export interface ScheduleSocialPostInput extends ProjectScope {
  userId: string;
  coworkerId?: string;
  postId: string;
  scheduledAt: Date;
  timezone?: string;
  socialConnectionId?: string;
  revision: number;
}

export interface CancelSocialPostInput extends ProjectScope {
  userId: string;
  coworkerId?: string;
  postId: string;
  revision: number;
}

export interface ApproveSocialPostInput extends ProjectScope {
  userId: string;
  postId: string;
  revision: number;
}

export interface ResumeSocialPostThreadInput extends ProjectScope {
  userId: string;
  postId: string;
  revision: number;
  confirmedNotPosted: true;
}

export interface RejectSocialPostInput extends ProjectScope {
  userId: string;
  postId: string;
  revision: number;
}

export interface DuplicateSocialPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  postId: string;
}

export interface RecycleSocialAccountPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  accountPostId: string;
  delayDays?: 7 | 14 | 30;
  timezone?: string;
}

function mapCreator(record: SocialPostRecord): SocialPostCreator {
  if (record.creatorUser) {
    return { kind: "user", ...record.creatorUser };
  }
  if (record.creatorCoworker) {
    return { kind: "coworker", ...record.creatorCoworker };
  }
  if (record.creatorSokoBot) {
    return { kind: "sokoBot", ...record.creatorSokoBot };
  }
  throw internalServerError("Social post has no creator");
}

export function mapSocialPost(record: SocialPostRecord): SocialPostSummary {
  const media = parseSocialPostMedia(record.media, record.id);
  const provider = isSocialPostProvider(record.provider)
    ? record.provider
    : null;
  const quoteReady =
    socialPostQuotePublishDecision(record, record.quotedPost, new Date())
      .kind === "ready";
  const providerEnabled =
    isSocialProviderEnabled(
      record.provider,
      socialProviderWorkspaceForProject(record.project),
    ) &&
    (!record.socialConnection ||
      isSocialProviderEnabled(
        record.socialConnection.provider,
        socialProviderWorkspaceForProject(record.project),
      ));
  return {
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    text: record.text,
    firstComment: record.firstComment,
    media,
    quotedPostId: record.quotedPostId,
    quotedPost: record.quotedPost
      ? mapSocialPostQuote(record.quotedPost)
      : null,
    needsAttentionReason: record.needsAttentionReason,
    waitingForQuotedPost: isSocialPostWaitingForQuote(
      record,
      record.quotedPost,
      new Date(),
    ),
    threadParts: record.threadParts.map((part) => ({
      id: part.id,
      position: part.position,
      text: part.text,
      media: parseSocialPostMedia(part.media, part.id),
      externalPostId: part.externalPostId,
      publishedAt: part.publishedAt,
      error:
        part.error ??
        (record.status === "FAILED" &&
        record.publishingThreadPartPosition === part.position
          ? record.lastError
          : null),
    })),
    ...summarizeSocialPostThread(record),
    publishingThreadPartPosition: record.publishingThreadPartPosition,
    status: record.status,
    scheduledAt: record.scheduledAt,
    timezone: record.timezone,
    socialConnection: record.socialConnection,
    creator: mapCreator(record),
    scheduledByUserId: record.scheduledByUserId,
    scheduledByCoworkerId: record.scheduledByCoworkerId,
    canceledAt: record.canceledAt,
    publishedAt: record.publishedAt,
    publishedExternalId: record.publishedExternalId,
    publishedUrl: record.publishedUrl,
    statistics:
      socialPostStatisticsSchema.safeParse(record.statistics).data ?? null,
    lastError: record.lastError,
    attemptCount: record.attemptCount,
    nextAttemptAt: record.nextAttemptAt,
    lastAttemptAt: record.lastAttemptAt,
    lastAttempt: record.attempts[0] ?? null,
    revision: record.revision,
    marketingStrategyId: record.marketingStrategyId ?? null,
    planning: socialPostPlanningSchema.safeParse(record.planning).data ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    canEdit:
      (EDITABLE_STATUSES.includes(record.status) ||
        (record.status === "FAILED" && record.needsAttentionReason !== null) ||
        canRepairDisabledPost(record)) &&
      !hasStartedThread(record),
    canSchedule:
      providerEnabled &&
      SCHEDULABLE_STATUSES.includes(record.status) &&
      record.publishingThreadPartPosition == null,
    canCancel: CANCELABLE_STATUSES.includes(record.status),
    canPublishNow:
      providerEnabled &&
      PUBLISH_NOW_STATUSES.includes(record.status) &&
      record.publishingThreadPartPosition == null &&
      quoteReady &&
      provider !== null &&
      socialPostMeetsMediaRequirement(provider, media),
    canDuplicate:
      providerEnabled && DUPLICATABLE_STATUSES.includes(record.status),
    canApprove: providerEnabled && record.status === "NEEDS_APPROVAL",
    canReject: record.status === "NEEDS_APPROVAL",
    connectionNeedsReconnect:
      RECONNECT_SENSITIVE_STATUSES.includes(record.status) &&
      record.socialConnection !== null &&
      record.socialConnection.status !== "active",
  };
}

async function requireScopedPost(
  input: GetSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostRecord> {
  const post = await tx.socialPost.findFirst({
    where: {
      id: input.postId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    },
    include: socialPostInclude,
  });
  if (!post) {
    throw notFound("Social post not found");
  }
  return post;
}

function isSocialPostProvider(value: string): value is SocialPostProvider {
  return value in SOCIAL_POST_TEXT_LIMITS;
}

/** Failed disabled-provider posts can be rescued as drafts with an enabled account. */
function canRepairDisabledPost(post: SocialPostRecord): boolean {
  return (
    (post.status === "FAILED" || post.status === "MISSED") &&
    (!isSocialProviderEnabled(
      post.provider,
      socialProviderWorkspaceForProject(post.project),
    ) ||
      (post.socialConnection !== null &&
        !isSocialProviderEnabled(
          post.socialConnection.provider,
          socialProviderWorkspaceForProject(post.project),
        )))
  );
}

function requireProvider(provider: string): SocialPostProvider {
  if (!isSocialPostProvider(provider)) {
    throw badRequest(`Unsupported social provider: ${provider}`);
  }
  return provider;
}

/** Text rules differ per provider: some require text, others accept media only. */
function requireFirstCommentWithinLimit(
  value: string | null | undefined,
  provider: string,
  subscriptionType?: string | null,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return null;
  const scopedProvider = requireProvider(provider);
  const limit = socialPostFirstCommentLimit(scopedProvider, subscriptionType);
  const cap = limit ?? SOCIAL_POST_FIRST_COMMENT_MAX;
  if (socialPostTextLength(scopedProvider, trimmed) > cap) {
    throw badRequest(
      limit === null
        ? `First comment must be at most ${cap.toLocaleString("en-US")} characters`
        : `First comment must be at most ${cap.toLocaleString("en-US")} characters for ${provider}`,
    );
  }
  return trimmed;
}

function requireTextWithinLimit(
  text: string,
  provider: string,
  hasMedia: boolean,
  subscriptionType?: string | null,
): string {
  const scopedProvider = requireProvider(provider);
  const label = socialPostProviderLabel(scopedProvider);
  const trimmed = text.trim();
  const limit = socialPostTextLimit(scopedProvider, subscriptionType);
  if (SOCIAL_POST_TEXT_REQUIRED[scopedProvider] && trimmed.length === 0) {
    throw badRequest(`${label} requires text`);
  }
  if (trimmed.length === 0 && !hasMedia) {
    throw badRequest("Text is required");
  }
  if (socialPostTextLength(scopedProvider, trimmed) > limit) {
    throw badRequest(
      `Text must be at most ${limit.toLocaleString("en-US")} characters for ${label}`,
    );
  }
  return trimmed;
}

/** A Soko Bot's post that would show raw Markdown or a wall of hashtags. */
function requireBotFormatting(
  provider: string,
  post: Parameters<typeof socialPostFormattingError>[1],
): void {
  const error = socialPostFormattingError(requireProvider(provider), post);
  if (error) throw badRequest(error);
}

/** Publish and schedule refuse a post without the media the network needs. */
function requireMediaRequirement(
  provider: SocialPostProvider,
  media: readonly SocialPostMediaRef[],
): void {
  const message = socialPostMediaRequirementMessage(provider);
  if (message && !socialPostMeetsMediaRequirement(provider, media)) {
    throw badRequest(message);
  }
}

interface NormalizeMediaInput extends WorkspaceOwnerScope {
  userId: string;
  provider: string;
  media: readonly SocialPostMediaRef[];
}

/** Human-readable reason for a media rule violation, keyed by the shared reason. */
function mediaValidationMessage(
  provider: SocialPostProvider,
  reason: SocialPostMediaValidationReason,
): string {
  const label = socialPostProviderLabel(provider);
  switch (reason) {
    case "too_many_images":
      return `${label} allows at most ${SOCIAL_POST_MEDIA_RULES[provider].maxImages} images per post`;
    case "too_many_gifs":
      return `${label} allows one GIF per post`;
    case "too_many_videos":
      return `${label} allows one video per post`;
    case "mixed_media":
      return `${label} does not allow a post that mixes images, a GIF, or a video`;
    case "unsupported_type":
      return `${label} does not accept this file type`;
    case "too_large":
      return `A file is too large for ${label}`;
  }
}

/**
 * Pins every ref to a Drive file in the active workspace store, checks its
 * declared type, and applies the provider's media rules. Returns the refs as
 * they will be stored.
 */
function normalizeSocialPostMedia(
  input: NormalizeMediaInput,
): SocialPostMediaRef[] {
  const provider = requireProvider(input.provider);
  const media = input.media.map((ref): SocialPostMediaRef => {
    const fileUrl = requireWorkspaceDriveFileUrl(input, ref);
    const mimeType = ref.mimeType.trim().toLowerCase();
    if (socialPostMediaKindForMime(mimeType) !== ref.kind) {
      throw badRequest(
        `Media file "${ref.name}" is not a file type ${socialPostProviderLabel(provider)} accepts`,
      );
    }
    return {
      pathname: ref.pathname,
      fileUrl,
      name: ref.name,
      size: ref.size,
      mimeType,
      kind: ref.kind,
    };
  });
  const validation = validateSocialPostMedia(provider, media);
  if (!validation.ok) {
    throw badRequest(mediaValidationMessage(provider, validation.reason));
  }
  return media;
}

/** Prisma Json input wants a plain JSON value; refs are plain objects already. */
function mediaJson(media: SocialPostMediaRef[]): Prisma.InputJsonValue {
  return media.map((ref) => ({ ...ref }));
}

function requireThreadPartsAllowed(provider: string, partCount: number): void {
  if (partCount > 0 && provider !== "x") {
    throw badRequest("Thread parts are only supported for X accounts");
  }
  if (partCount >= SOCIAL_POST_THREAD_MAX_PARTS) {
    throw badRequest(
      `Threads allow at most ${SOCIAL_POST_THREAD_MAX_PARTS} parts including the main post`,
    );
  }
}

function normalizeThreadParts(
  input: Omit<NormalizeMediaInput, "media"> & {
    threadParts: readonly SocialPostThreadPartInput[];
    subscriptionType?: string | null;
  },
): Prisma.SocialPostThreadPartCreateWithoutPostInput[] {
  requireThreadPartsAllowed(input.provider, input.threadParts.length);
  return input.threadParts.map((part, index) => {
    const media = normalizeSocialPostMedia({
      ...input,
      media: part.media ?? [],
    });
    return {
      position: index + 2,
      text: requireTextWithinLimit(
        part.text,
        input.provider,
        media.length > 0,
        input.subscriptionType,
      ),
      media: mediaJson(media),
    };
  });
}

function requireStoredThreadParts(
  post: SocialPostRecord,
  provider: SocialPostProvider,
  subscriptionType?: string | null,
): void {
  requireThreadPartsAllowed(provider, post.threadParts.length);
  for (const part of post.threadParts) {
    if (part.externalPostId) continue;
    const media = parseSocialPostMedia(part.media, part.id);
    requireTextWithinLimit(
      part.text,
      provider,
      media.length > 0,
      subscriptionType,
    );
    const validation = validateSocialPostMedia(provider, media);
    if (!validation.ok) {
      throw badRequest(mediaValidationMessage(provider, validation.reason));
    }
  }
}

function hasStartedThread(post: SocialPostRecord): boolean {
  return (
    post.threadParts.length > 0 &&
    (post.publishedExternalId !== null ||
      post.publishingThreadPartPosition != null ||
      post.threadParts.some((part) => part.externalPostId !== null))
  );
}

function requireFutureScheduledAt(scheduledAt: Date): void {
  if (scheduledAt.getTime() <= Date.now() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS) {
    throw badRequest("Scheduled time must be in the future");
  }
}

type ConnectionCandidate = Pick<
  ProjectSocialConnection,
  | "id"
  | "projectId"
  | "provider"
  | "status"
  | "subscriptionType"
  | "composioConnectedAccountId"
>;

/** Loads a connection that belongs to the Project. Disconnected rows never qualify. */
async function requireProjectConnection(
  projectId: string,
  socialConnectionId: string,
  tx: Prisma.TransactionClient,
): Promise<ConnectionCandidate> {
  const connection = await tx.projectSocialConnection.findFirst({
    where: { id: socialConnectionId, projectId },
    select: {
      id: true,
      projectId: true,
      provider: true,
      status: true,
      subscriptionType: true,
      composioConnectedAccountId: true,
      project: { select: socialProviderProjectSelect },
    },
  });
  if (!connection) {
    throw notFound("Project social connection not found");
  }
  requireProvider(connection.provider);
  requireSocialProviderEnabled(connection.provider, connection.project);
  if (connection.status === "disconnected") {
    throw conflict("Social connection is disconnected");
  }
  return {
    ...connection,
    // Keep the refreshed tier even when post validation rolls back this transaction.
    subscriptionType: await resolveXSubscriptionType(connection),
  };
}

async function requireActiveProjectConnection(
  projectId: string,
  socialConnectionId: string | null | undefined,
  tx: Prisma.TransactionClient,
): Promise<ConnectionCandidate> {
  if (!socialConnectionId) {
    throw badRequest(CONNECTION_REQUIRED_MESSAGE);
  }
  const connection = await requireProjectConnection(
    projectId,
    socialConnectionId,
    tx,
  );
  if (connection.status !== "active") {
    throw conflict("Social connection is not active");
  }
  return connection;
}

function requireRevision(post: SocialPostRecord, revision: number): void {
  if (post.revision !== revision) {
    throw conflict(REVISION_CONFLICT_MESSAGE, {
      kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
    });
  }
}

/**
 * Optimistic-lock write: the row must still carry the observed revision.
 * Returns the refreshed record; a zero-row update means someone else wrote first.
 */
async function writeWithRevision(
  input: GetSocialPostInput,
  revision: number,
  data: Prisma.SocialPostUncheckedUpdateManyInput,
  tx: Prisma.TransactionClient,
): Promise<SocialPostRecord> {
  const result = await tx.socialPost.updateMany({
    where: { id: input.postId, revision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (result.count === 0) {
    throw conflict(REVISION_CONFLICT_MESSAGE, {
      kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
    });
  }
  return requireScopedPost(input, tx);
}

export async function listSocialPosts(
  input: ListSocialPostsInput,
): Promise<{ posts: SocialPostSummary[]; pagination: CursorPaginationMeta }> {
  await requireScopedProject(input);
  const { cursor, take, skip } = parseCursorPagination(input);
  const where: Prisma.SocialPostWhereInput = {
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    ...(input.statuses ? { status: { in: [...input.statuses] } } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.quoteCandidates
      ? {
          provider: "x",
          status: { in: ["SCHEDULED", "NEEDS_APPROVAL", "PUBLISHED"] },
        }
      : {}),
    ...(input.excludePostId ? { id: { not: input.excludePostId } } : {}),
    ...(input.search
      ? { text: { contains: input.search, mode: "insensitive" } }
      : {}),
    ...(input.publishedFrom || input.publishedUntil
      ? {
          publishedAt: {
            ...(input.publishedFrom ? { gte: input.publishedFrom } : {}),
            ...(input.publishedUntil ? { lte: input.publishedUntil } : {}),
          },
        }
      : {}),
  };
  const upcoming = input.statuses?.every(
    (status) => status === "SCHEDULED" || status === "PUBLISHING",
  );
  const attention =
    Boolean(input.statuses?.length) &&
    input.statuses?.every(
      (status) => status === "FAILED" || status === "MISSED",
    );
  const [rows, count] = await Promise.all([
    prisma.socialPost.findMany({
      where,
      include: socialPostInclude,
      orderBy: input.quoteCandidates
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : upcoming
          ? [{ scheduledAt: "asc" }, { id: "asc" }]
          : input.statuses?.length === 1 && input.statuses[0] === "PUBLISHED"
            ? [{ publishedAt: "desc" }, { id: "desc" }]
            : attention
              ? [
                  { lastAttemptAt: { sort: "desc", nulls: "last" } },
                  { scheduledAt: { sort: "desc", nulls: "last" } },
                  { id: "desc" },
                ]
              : [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip } : {}),
    }),
    prisma.socialPost.count({ where }),
  ]);
  const posts = rows.slice(0, take).map(mapSocialPost);
  return {
    posts,
    pagination: createPaginationMeta(
      posts,
      count,
      take,
      rows.length > take,
      cursor,
    ),
  };
}

export async function getSocialPost(
  input: GetSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  await requireScopedProject(input, { client: tx });
  return mapSocialPost(await requireScopedPost(input, tx));
}

export async function createSocialPost(
  input: CreateSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if ((input.scheduledAt || input.quotedPostId) && tx === prisma) {
    return serializableTransaction(
      (tx) => createSocialPost(input, tx),
      "Project changed while scheduling a Social post",
    );
  }
  if (input.coworkerId && input.sokoBotId) {
    throw badRequest(
      "A social post cannot have both a Coworker and Soko Bot creator",
    );
  }
  if (input.scheduledAt) {
    await requireLockedOpenProject(tx, input, {
      closedMessage: PROJECT_CLOSED_MESSAGE,
    });
  } else {
    await requireScopedProject(input, { client: tx });
  }

  let connection: ConnectionCandidate | null = null;
  if (input.scheduledAt) {
    requireFutureScheduledAt(input.scheduledAt);
    connection = await requireActiveProjectConnection(
      input.projectId,
      input.socialConnectionId,
      tx,
    );
  } else if (input.socialConnectionId) {
    connection = await requireProjectConnection(
      input.projectId,
      input.socialConnectionId,
      tx,
    );
  }

  const provider = connection?.provider ?? "x";
  const media = normalizeSocialPostMedia({
    userId: input.userId,
    organizationId: input.organizationId,
    provider,
    media: input.media ?? [],
  });
  const text = requireTextWithinLimit(
    input.text,
    provider,
    media.length > 0,
    connection?.subscriptionType,
  );
  const firstComment = requireFirstCommentWithinLimit(
    input.firstComment,
    provider,
    connection?.subscriptionType,
  );
  const threadParts = normalizeThreadParts({
    ...input,
    provider,
    threadParts: input.threadParts ?? [],
    subscriptionType: connection?.subscriptionType,
  });
  if (input.sokoBotId)
    requireBotFormatting(provider, {
      texts: [text, firstComment, ...threadParts.map((part) => part.text)],
      body: text,
      firstComment,
      linkInPost: input.linkInPost,
    });
  const scheduled = input.scheduledAt !== undefined;
  if (scheduled) {
    requireMediaRequirement(requireProvider(provider), media);
  }
  const agentDraft = Boolean(input.coworkerId || input.sokoBotId);
  await requireSocialPostQuote(
    { ...input, provider, quotedPostId: input.quotedPostId ?? null },
    tx,
  );

  const post = await tx.socialPost.create({
    data: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      socialConnectionId: connection?.id ?? null,
      provider,
      text,
      firstComment,
      media: mediaJson(media),
      quotedPostId: input.quotedPostId ?? null,
      ...(threadParts.length > 0
        ? { threadParts: { create: threadParts } }
        : {}),
      status: agentDraft ? "NEEDS_APPROVAL" : scheduled ? "SCHEDULED" : "DRAFT",
      scheduledAt: input.scheduledAt ?? null,
      timezone: input.timezone ?? null,
      creatorUserId: input.coworkerId || input.sokoBotId ? null : input.userId,
      creatorCoworkerId: input.coworkerId ?? null,
      creatorSokoBotId: input.sokoBotId ?? null,
      scheduledByUserId: scheduled ? input.userId : null,
      scheduledByCoworkerId: scheduled ? (input.coworkerId ?? null) : null,
    },
    include: socialPostInclude,
  });
  return mapSocialPost(post);
}

export async function updateSocialPost(
  input: UpdateSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    return serializableTransaction(
      (tx) => updateSocialPost(input, tx),
      "Project changed while editing a Social post",
    );
  }
  await requireScopedProject(input, { client: tx });
  const post = await requireScopedPost(input, tx);
  if (post.status === "SCHEDULED" || input.scheduledAt) {
    await requireLockedOpenProject(tx, input, {
      closedMessage: PROJECT_CLOSED_MESSAGE,
    });
  }
  if (hasStartedThread(post)) {
    throw conflict("A thread cannot be edited after publishing has started");
  }
  const repairingDisabledPost = canRepairDisabledPost(post);
  const repairingQuote =
    post.status === "FAILED" &&
    post.needsAttentionReason !== null &&
    input.quotedPostId !== undefined;
  if (
    !EDITABLE_STATUSES.includes(post.status) &&
    !repairingDisabledPost &&
    !repairingQuote
  ) {
    throw conflict(
      "Only a draft, scheduled, or needs-approval post can be edited",
    );
  }
  requireRevision(post, input.revision);
  if (input.scheduledAt) requireFutureScheduledAt(input.scheduledAt);

  const data: Prisma.SocialPostUncheckedUpdateManyInput = repairingDisabledPost
    ? {
        status: "DRAFT",
        scheduledAt: null,
        scheduledByUserId: null,
        scheduledByCoworkerId: null,
        nextAttemptAt: null,
        lastError: null,
        attemptCount: 0,
      }
    : post.status === "SCHEDULED"
      ? {
          scheduledByUserId: input.userId,
          scheduledByCoworkerId: input.coworkerId ?? null,
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: null,
          // Past-due + attemptCount 0 is marked MISSED. Keep the slot due now.
          ...(post.scheduledAt && post.scheduledAt.getTime() < Date.now()
            ? { scheduledAt: new Date() }
            : {}),
        }
      : {};
  if (input.scheduledAt) data.scheduledAt = input.scheduledAt;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  const currentProvider = requireProvider(post.provider);
  let provider = currentProvider;
  let subscriptionType = post.socialConnection?.subscriptionType;
  if (input.socialConnectionId === null) {
    if (post.status === "SCHEDULED") {
      throw badRequest("A scheduled post must keep a social connection");
    }
    data.socialConnectionId = null;
    provider = "x";
    subscriptionType = null;
  } else if (input.socialConnectionId !== undefined) {
    const connection =
      post.status === "SCHEDULED"
        ? await requireActiveProjectConnection(
            input.projectId,
            input.socialConnectionId,
            tx,
          )
        : await requireProjectConnection(
            input.projectId,
            input.socialConnectionId,
            tx,
          );
    data.socialConnectionId = connection.id;
    provider = requireProvider(connection.provider);
    subscriptionType = connection.subscriptionType;
  } else if (
    post.socialConnectionId &&
    post.socialConnection?.status !== "disconnected"
  ) {
    const connection =
      post.status === "SCHEDULED"
        ? await requireActiveProjectConnection(
            input.projectId,
            post.socialConnectionId,
            tx,
          )
        : await requireProjectConnection(
            input.projectId,
            post.socialConnectionId,
            tx,
          );
    subscriptionType = connection.subscriptionType;
  } else if (post.socialConnection) {
    requireSocialProviderEnabled(post.socialConnection.provider, post.project);
  }

  requireSocialProviderEnabled(provider, post.project);
  const providerChanged = provider !== currentProvider;
  if (providerChanged) {
    data.provider = provider;
  }
  let media = parseSocialPostMedia(post.media, post.id);
  if (input.media !== undefined) {
    media = normalizeSocialPostMedia({
      userId: input.userId,
      organizationId: input.organizationId,
      provider,
      media: input.media,
    });
    data.media = mediaJson(media);
  }
  const text = requireTextWithinLimit(
    input.text ?? post.text,
    provider,
    media.length > 0,
    subscriptionType,
  );
  if (
    input.text !== undefined ||
    input.media !== undefined ||
    input.socialConnectionId !== undefined ||
    providerChanged
  ) {
    data.text = text;
    if (input.media === undefined) {
      const validation = validateSocialPostMedia(provider, media);
      if (!validation.ok) {
        throw badRequest(mediaValidationMessage(provider, validation.reason));
      }
    }
    if (post.status === "SCHEDULED") {
      requireMediaRequirement(provider, media);
    }
  }

  const firstComment = requireFirstCommentWithinLimit(
    input.firstComment !== undefined ? input.firstComment : post.firstComment,
    provider,
    subscriptionType,
  );
  if (input.firstComment !== undefined || providerChanged) {
    data.firstComment = firstComment;
  }

  const threadParts =
    input.threadParts !== undefined
      ? normalizeThreadParts({
          ...input,
          provider,
          threadParts: input.threadParts,
          subscriptionType,
        })
      : undefined;
  if (threadParts === undefined)
    requireStoredThreadParts(post, provider, subscriptionType);
  if (
    input.sokoBotId &&
    (input.text !== undefined ||
      input.firstComment !== undefined ||
      input.threadParts !== undefined ||
      providerChanged)
  )
    requireBotFormatting(provider, {
      texts: [
        text,
        firstComment,
        ...(threadParts ?? post.threadParts).map((part) => part.text),
      ],
      body: text,
      firstComment,
      linkInPost: input.linkInPost,
    });

  const quotedPostId =
    input.quotedPostId !== undefined ? input.quotedPostId : post.quotedPostId;
  await requireSocialPostQuote(
    {
      ...input,
      provider,
      quotedPostId,
      scheduledAt:
        post.status === "SCHEDULED" || input.scheduledAt
          ? data.scheduledAt instanceof Date
            ? data.scheduledAt
            : post.scheduledAt
          : null,
      needsAttentionReason:
        input.quotedPostId !== undefined ? null : post.needsAttentionReason,
    },
    tx,
  );
  if (input.quotedPostId !== undefined) {
    data.quotedPostId = quotedPostId;
    data.needsAttentionReason = null;
    data.lastError = null;
  }
  let movedQuotes: MovedSocialPostQuote[] = [];
  if (providerChanged || data.scheduledAt instanceof Date) {
    movedQuotes = await moveSocialPostQuotes(
      post,
      {
        provider,
        scheduledAt:
          data.scheduledAt instanceof Date
            ? data.scheduledAt
            : post.scheduledAt,
      },
      tx,
    );
  }

  const updated = await writeWithRevision(input, input.revision, data, tx);
  if (threadParts !== undefined) {
    return {
      ...mapSocialPost(
        await tx.socialPost.update({
          where: { id: post.id },
          data: { threadParts: { deleteMany: {}, create: threadParts } },
          include: socialPostInclude,
        }),
      ),
      movedQuotes,
    };
  }

  return { ...mapSocialPost(updated), movedQuotes };
}

export async function scheduleSocialPost(
  input: ScheduleSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    return serializableTransaction(
      (tx) => scheduleSocialPost(input, tx),
      "Project changed while scheduling a Social post",
    );
  }
  await requireLockedOpenProject(tx, input, {
    closedMessage: PROJECT_CLOSED_MESSAGE,
  });
  const post = await requireScopedPost(input, tx);
  if (!SCHEDULABLE_STATUSES.includes(post.status)) {
    throw conflict("This post can no longer be scheduled");
  }
  requireRevision(post, input.revision);
  requireFutureScheduledAt(input.scheduledAt);
  if (post.publishingThreadPartPosition != null) {
    throw conflict(
      `Thread part ${post.publishingThreadPartPosition} has an unconfirmed publishing result. Check X before retrying to avoid a duplicate post.`,
    );
  }
  if (
    hasStartedThread(post) &&
    input.socialConnectionId &&
    input.socialConnectionId !== post.socialConnectionId
  ) {
    throw conflict(
      "A partially published thread must keep its original X account",
    );
  }
  const media = parseSocialPostMedia(post.media, post.id);
  const currentProvider = requireProvider(post.provider);
  const connection = await requireActiveProjectConnection(
    input.projectId,
    input.socialConnectionId ?? post.socialConnectionId,
    tx,
  );
  const provider = requireProvider(connection.provider);
  requireStoredThreadParts(post, provider, connection.subscriptionType);
  if (!post.publishedExternalId) {
    const validation = validateSocialPostMedia(provider, media);
    if (!validation.ok) {
      throw badRequest(mediaValidationMessage(provider, validation.reason));
    }
    requireTextWithinLimit(
      post.text,
      provider,
      media.length > 0,
      connection.subscriptionType,
    );
    requireMediaRequirement(provider, media);
  }
  requireFirstCommentWithinLimit(
    post.firstComment,
    provider,
    connection.subscriptionType,
  );

  if (!post.publishedExternalId)
    await requireSocialPostQuote(
      {
        ...input,
        provider,
        quotedPostId: post.quotedPostId,
        needsAttentionReason: post.needsAttentionReason,
      },
      tx,
    );
  const movedQuotes = await moveSocialPostQuotes(
    post,
    { provider, scheduledAt: input.scheduledAt },
    tx,
  );

  return {
    ...mapSocialPost(
      await writeWithRevision(
        input,
        input.revision,
        {
          status:
            post.status === "NEEDS_APPROVAL" ? "NEEDS_APPROVAL" : "SCHEDULED",
          scheduledAt: input.scheduledAt,
          timezone: input.timezone ?? post.timezone,
          socialConnectionId: connection.id,
          ...(provider !== currentProvider ? { provider } : {}),
          scheduledByUserId: input.userId,
          scheduledByCoworkerId: input.coworkerId ?? null,
          lastError: null,
          needsAttentionReason: null,
          attemptCount: 0,
          nextAttemptAt: null,
        },
        tx,
      ),
    ),
    movedQuotes,
  };
}

export async function resumeSocialPostThread(
  input: ResumeSocialPostThreadInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    return serializableTransaction(
      (tx) => resumeSocialPostThread(input, tx),
      "Project changed while resuming a Social thread",
    );
  }
  await requireLockedOpenProject(tx, input, {
    closedMessage: PROJECT_CLOSED_MESSAGE,
  });
  const post = await requireScopedPost(input, tx);
  requireRevision(post, input.revision);
  if (
    input.confirmedNotPosted !== true ||
    post.status !== "FAILED" ||
    post.provider !== "x" ||
    post.threadParts.length === 0 ||
    post.publishingThreadPartPosition == null ||
    (post.leaseExpiresAt && post.leaseExpiresAt > new Date())
  ) {
    throw conflict(
      "Only a failed X thread with an unconfirmed part can be resumed",
    );
  }
  return mapSocialPost(
    await writeWithRevision(
      input,
      input.revision,
      { publishingThreadPartPosition: null },
      tx,
    ),
  );
}

export async function cancelSocialPost(
  input: CancelSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    return serializableTransaction(
      (tx) => cancelSocialPost(input, tx),
      "Post changed while cancelling a Social post",
    );
  }
  await requireScopedProject(input, { client: tx });
  const post = await requireScopedPost(input, tx);
  if (post.status === "CANCELED") {
    return mapSocialPost(post);
  }
  if (!CANCELABLE_STATUSES.includes(post.status)) {
    throw conflict(
      "Only a draft, scheduled, needs-approval, failed, or missed post can be canceled",
    );
  }
  requireRevision(post, input.revision);

  const canceled = await writeWithRevision(
    input,
    input.revision,
    {
      status: "CANCELED",
      canceledAt: new Date(),
    },
    tx,
  );
  await flagSocialPostQuotes(post.id, QUOTED_POST_CANCELLED, tx);
  return mapSocialPost(canceled);
}

export async function approveSocialPost(
  input: ApproveSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    return serializableTransaction(
      (tx) => approveSocialPost(input, tx),
      "Project changed while approving a Social post",
    );
  }
  await requireLockedOpenProject(tx, input, {
    closedMessage: PROJECT_CLOSED_MESSAGE,
  });
  const post = await requireScopedPost(input, tx);
  if (post.status !== "NEEDS_APPROVAL") {
    throw conflict("Only a post that needs approval can be approved");
  }
  requireRevision(post, input.revision);
  const due = post.scheduledAt;
  requireSocialProviderEnabled(post.provider, post.project);
  if (post.socialConnection) {
    requireSocialProviderEnabled(post.socialConnection.provider, post.project);
  }
  const schedule =
    due != null &&
    due.getTime() >= Date.now() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS;
  if (schedule) {
    await requireActiveProjectConnection(
      input.projectId,
      post.socialConnectionId,
      tx,
    );
    await requireSocialPostQuote(
      {
        ...input,
        provider: post.provider,
        quotedPostId: post.quotedPostId,
        needsAttentionReason: post.needsAttentionReason,
        scheduledAt: due,
      },
      tx,
    );
  }

  const approved = await writeWithRevision(
    input,
    input.revision,
    {
      status: schedule ? "SCHEDULED" : "DRAFT",
      ...(schedule
        ? {
            scheduledByUserId: input.userId,
            scheduledByCoworkerId: null,
          }
        : {}),
    },
    tx,
  );
  if (!schedule) await flagSocialPostQuotes(post.id, QUOTED_POST_CANCELLED, tx);
  return mapSocialPost(approved);
}

export async function rejectSocialPost(
  input: RejectSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    return serializableTransaction(
      (tx) => rejectSocialPost(input, tx),
      "Post changed while rejecting a Social post",
    );
  }
  await requireScopedProject(input, { client: tx });
  const post = await requireScopedPost(input, tx);
  if (post.status !== "NEEDS_APPROVAL") {
    throw conflict("Only a post that needs approval can be rejected");
  }
  requireRevision(post, input.revision);

  const rejected = await writeWithRevision(
    input,
    input.revision,
    {
      status: "CANCELED",
      canceledAt: new Date(),
    },
    tx,
  );
  await flagSocialPostQuotes(post.id, QUOTED_POST_CANCELLED, tx);
  return mapSocialPost(rejected);
}

export async function duplicateSocialPost(
  input: DuplicateSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  await requireScopedProject(input, { client: tx });
  const source = await requireScopedPost(input, tx);
  if (!DUPLICATABLE_STATUSES.includes(source.status)) {
    throw conflict(
      "Only a published, failed, or missed post can be duplicated",
    );
  }

  const provider = requireProvider(source.provider);
  requireSocialProviderEnabled(provider, source.project);
  if (source.socialConnection) {
    requireSocialProviderEnabled(
      source.socialConnection.provider,
      source.project,
    );
  }
  const media = normalizeSocialPostMedia({
    userId: input.userId,
    organizationId: input.organizationId,
    provider,
    media: parseSocialPostMedia(source.media, source.id),
  });
  const connection =
    source.socialConnection && source.socialConnection.status !== "disconnected"
      ? await requireProjectConnection(
          input.projectId,
          source.socialConnection.id,
          tx,
        )
      : null;
  const text = requireTextWithinLimit(
    source.text,
    provider,
    media.length > 0,
    connection?.subscriptionType,
  );
  const threadParts = normalizeThreadParts({
    ...input,
    provider,
    threadParts: source.threadParts.map((part) => ({
      text: part.text,
      media: parseSocialPostMedia(part.media, part.id),
    })),
    subscriptionType: connection?.subscriptionType,
  });
  requireMediaRequirement(provider, media);
  const firstComment = requireFirstCommentWithinLimit(
    source.firstComment,
    provider,
    connection?.subscriptionType,
  );

  const post = await tx.socialPost.create({
    data: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      socialConnectionId: connection?.id ?? null,
      provider,
      text,
      firstComment,
      quotedPostId: source.quotedPostId,
      needsAttentionReason: source.needsAttentionReason,
      media: mediaJson(media),
      ...(threadParts.length > 0
        ? { threadParts: { create: threadParts } }
        : {}),
      status: input.coworkerId ? "NEEDS_APPROVAL" : "DRAFT",
      creatorUserId: input.coworkerId ? null : input.userId,
      creatorCoworkerId: input.coworkerId ?? null,
    },
    include: socialPostInclude,
  });
  return mapSocialPost(post);
}

const DAY_MS = 86_400_000;

export async function recycleSocialAccountPost(
  input: RecycleSocialAccountPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (input.delayDays && tx === prisma) {
    return serializableTransaction(
      (tx) => recycleSocialAccountPost(input, tx),
      "Project changed while scheduling a Social post",
    );
  }
  if (input.delayDays) {
    await requireLockedOpenProject(tx, input, {
      closedMessage: PROJECT_CLOSED_MESSAGE,
    });
  } else {
    await requireScopedProject(input, { client: tx });
  }
  const accountPost = await tx.socialAccountPost.findFirst({
    where: {
      id: input.accountPostId,
      connection: {
        projectId: input.projectId,
        project: { workspaceId: input.workspaceId },
      },
    },
    include: {
      connection: {
        select: {
          id: true,
          status: true,
          provider: true,
          project: { select: socialProviderProjectSelect },
        },
      },
    },
  });
  if (!accountPost) {
    throw notFound("Performance post not found");
  }
  requireSocialProviderEnabled(
    accountPost.connection.provider,
    accountPost.connection.project,
  );

  const match = await tx.socialPost.findFirst({
    where: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      publishedExternalId: accountPost.externalId,
      status: { in: [...DUPLICATABLE_STATUSES] },
    },
    select: { id: true },
  });

  let post: SocialPostSummary;
  if (match) {
    post = await duplicateSocialPost({ ...input, postId: match.id }, tx);
  } else if (!accountPost.text.trim()) {
    throw badRequest("This post has no text to reshare");
  } else {
    post = await createSocialPost(
      {
        ...input,
        text: accountPost.text,
        socialConnectionId: accountPost.connection.id,
      },
      tx,
    );
  }

  if (!input.delayDays) return post;
  if (!input.timezone) {
    throw badRequest("timezone is required when scheduling");
  }
  return scheduleSocialPost(
    {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      coworkerId: input.coworkerId,
      postId: post.id,
      scheduledAt: new Date(Date.now() + input.delayDays * DAY_MS),
      timezone: input.timezone,
      socialConnectionId:
        post.socialConnection?.id ?? accountPost.connection.id,
      revision: post.revision,
    },
    tx,
  );
}
