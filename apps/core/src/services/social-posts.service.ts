import type {
  Prisma,
  ProjectSocialConnection,
  SocialPostStatus,
} from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
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
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
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

export interface CreateSocialPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  sokoBotId?: string;
  text: string;
  firstComment?: string;
  media?: SocialPostMediaRef[];
  socialConnectionId?: string;
  scheduledAt?: Date;
  timezone?: string;
}

export interface UpdateSocialPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  postId: string;
  text?: string;
  firstComment?: string;
  media?: SocialPostMediaRef[];
  socialConnectionId?: string | null;
  revision: number;
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
  return {
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    text: record.text,
    firstComment: record.firstComment,
    media,
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
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    canEdit: EDITABLE_STATUSES.includes(record.status),
    canSchedule: SCHEDULABLE_STATUSES.includes(record.status),
    canCancel: CANCELABLE_STATUSES.includes(record.status),
    canPublishNow:
      PUBLISH_NOW_STATUSES.includes(record.status) &&
      provider !== null &&
      socialPostMeetsMediaRequirement(provider, media),
    canDuplicate: DUPLICATABLE_STATUSES.includes(record.status),
    canApprove: record.status === "NEEDS_APPROVAL",
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
    },
  });
  if (!connection) {
    throw notFound("Project social connection not found");
  }
  requireProvider(connection.provider);
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
      orderBy: upcoming
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
  if (input.scheduledAt && tx === prisma) {
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
  const scheduled = input.scheduledAt !== undefined;
  if (scheduled) {
    requireMediaRequirement(requireProvider(provider), media);
  }
  const agentDraft = Boolean(input.coworkerId || input.sokoBotId);

  const post = await tx.socialPost.create({
    data: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      socialConnectionId: connection?.id ?? null,
      provider,
      text,
      firstComment,
      media: mediaJson(media),
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
  if (post.status === "SCHEDULED") {
    await requireLockedOpenProject(tx, input, {
      closedMessage: PROJECT_CLOSED_MESSAGE,
    });
  }
  if (!EDITABLE_STATUSES.includes(post.status)) {
    throw conflict(
      "Only a draft, scheduled, or needs-approval post can be edited",
    );
  }
  requireRevision(post, input.revision);

  const data: Prisma.SocialPostUncheckedUpdateManyInput =
    post.status === "SCHEDULED"
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
  const currentProvider = requireProvider(post.provider);
  let provider = currentProvider;
  let subscriptionType = post.socialConnection?.subscriptionType;
  if (input.socialConnectionId === null) {
    if (post.status === "SCHEDULED") {
      throw badRequest("A scheduled post must keep a social connection");
    }
    data.socialConnectionId = null;
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
  }

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

  return mapSocialPost(
    await writeWithRevision(input, input.revision, data, tx),
  );
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
  const media = parseSocialPostMedia(post.media, post.id);
  const currentProvider = requireProvider(post.provider);
  const connection = await requireActiveProjectConnection(
    input.projectId,
    input.socialConnectionId ?? post.socialConnectionId,
    tx,
  );
  const provider = requireProvider(connection.provider);
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
  requireFirstCommentWithinLimit(
    post.firstComment,
    provider,
    connection.subscriptionType,
  );
  requireMediaRequirement(provider, media);

  return mapSocialPost(
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
        attemptCount: 0,
        nextAttemptAt: null,
      },
      tx,
    ),
  );
}

export async function cancelSocialPost(
  input: CancelSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
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

  return mapSocialPost(
    await writeWithRevision(
      input,
      input.revision,
      {
        status: "CANCELED",
        canceledAt: new Date(),
      },
      tx,
    ),
  );
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
  const schedule =
    due != null &&
    due.getTime() >= Date.now() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS;
  if (schedule) {
    await requireActiveProjectConnection(
      input.projectId,
      post.socialConnectionId,
      tx,
    );
  }

  return mapSocialPost(
    await writeWithRevision(
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
    ),
  );
}

export async function rejectSocialPost(
  input: RejectSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  await requireScopedProject(input, { client: tx });
  const post = await requireScopedPost(input, tx);
  if (post.status !== "NEEDS_APPROVAL") {
    throw conflict("Only a post that needs approval can be rejected");
  }
  requireRevision(post, input.revision);

  return mapSocialPost(
    await writeWithRevision(
      input,
      input.revision,
      {
        status: "CANCELED",
        canceledAt: new Date(),
      },
      tx,
    ),
  );
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
      media: mediaJson(media),
      status: "DRAFT",
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
      connection: { select: { id: true, status: true, provider: true } },
    },
  });
  if (!accountPost) {
    throw notFound("Performance post not found");
  }

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
