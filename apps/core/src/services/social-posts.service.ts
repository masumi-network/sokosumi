import type { Prisma, SocialPostStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  isVercelBlobPublicHost,
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostMediaRef,
  type SocialPostMediaValidationReason,
  type SocialPostProvider,
  socialPostMediaKindForMime,
  validateSocialPostMedia,
} from "@sokosumi/utils";

import { assertDriveStoreMatchesWorkspace } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
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
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";

const REVISION_CONFLICT_MESSAGE = "Social post was modified, reload and retry";
const CONNECTION_REQUIRED_MESSAGE =
  "A social connection is required to schedule a post";

const EDITABLE_STATUSES: readonly SocialPostStatus[] = ["DRAFT", "SCHEDULED"];
const SCHEDULABLE_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "FAILED",
  "MISSED",
];
const CANCELABLE_STATUSES: readonly SocialPostStatus[] = ["DRAFT", "SCHEDULED"];
const PUBLISH_NOW_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "FAILED",
  "MISSED",
];
/** Statuses where a stale connection blocks the next publish. */
const RECONNECT_SENSITIVE_STATUSES: readonly SocialPostStatus[] = [
  "DRAFT",
  "SCHEDULED",
];

const socialPostInclude = {
  socialConnection: {
    select: { id: true, externalHandle: true, status: true },
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
  media: SocialPostMediaRef[];
  status: SocialPostStatus;
  scheduledAt: Date | null;
  timezone: string | null;
  socialConnection: {
    id: string;
    externalHandle: string | null;
    status: string;
  } | null;
  creator: SocialPostCreator;
  scheduledByUserId: string | null;
  scheduledByCoworkerId: string | null;
  canceledAt: Date | null;
  publishedAt: Date | null;
  publishedExternalId: string | null;
  publishedUrl: string | null;
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
  /** The linked connection exists but is no longer active, so the post cannot go out. */
  connectionNeedsReconnect: boolean;
}

interface ProjectScope {
  projectId: string;
  workspaceId: string;
}

export interface ListSocialPostsInput extends ProjectScope {
  statuses?: readonly SocialPostStatus[];
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
  text: string;
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
  return {
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    text: record.text,
    media: parseSocialPostMedia(record.media, record.id),
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
    canPublishNow: PUBLISH_NOW_STATUSES.includes(record.status),
    connectionNeedsReconnect:
      RECONNECT_SENSITIVE_STATUSES.includes(record.status) &&
      record.socialConnection !== null &&
      record.socialConnection.status !== "active",
  };
}

async function requireScopedProject(input: ProjectScope): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }
}

async function requireScopedPost(
  input: GetSocialPostInput,
): Promise<SocialPostRecord> {
  const post = await prisma.socialPost.findFirst({
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

/** Text is optional once media is attached; the post still needs one of the two. */
function requireTextWithinLimit(
  text: string,
  provider: string,
  hasMedia: boolean,
): string {
  const trimmed = text.trim();
  const limit = SOCIAL_POST_TEXT_LIMITS[requireProvider(provider)];
  if (trimmed.length === 0 && !hasMedia) {
    throw badRequest("Text is required");
  }
  if (trimmed.length > limit) {
    throw badRequest(
      `Text must be at most ${limit} characters for ${provider}`,
    );
  }
  return trimmed;
}

interface NormalizeMediaInput extends WorkspaceOwnerScope {
  userId: string;
  provider: string;
  media: readonly SocialPostMediaRef[];
}

function providerLabel(provider: SocialPostProvider): string {
  return provider === "x" ? "X" : provider;
}

/** Human-readable reason for a media rule violation, keyed by the shared reason. */
function mediaValidationMessage(
  provider: SocialPostProvider,
  reason: SocialPostMediaValidationReason,
): string {
  const label = providerLabel(provider);
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

function requireDriveFileUrl(ref: SocialPostMediaRef): string {
  let url: URL;
  let decodedPathname: string;
  try {
    url = new URL(ref.fileUrl);
    decodedPathname = decodeURIComponent(url.pathname);
  } catch {
    throw badRequest(`Media file "${ref.name}" has an invalid URL`);
  }
  if (
    url.protocol !== "https:" ||
    !isVercelBlobPublicHost(url.hostname) ||
    decodedPathname !== `/${ref.pathname}`
  ) {
    throw badRequest(`Media file "${ref.name}" is not a Drive file`);
  }
  return url.toString();
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
    const { scope, ownerId } = parseDriveFilePathname(
      ref.pathname,
      input.userId,
    );
    assertDriveStoreMatchesWorkspace(input, scope, ownerId);
    const fileUrl = requireDriveFileUrl(ref);
    const mimeType = ref.mimeType.trim().toLowerCase();
    if (socialPostMediaKindForMime(mimeType) !== ref.kind) {
      throw badRequest(
        `Media file "${ref.name}" is not a file type ${providerLabel(provider)} accepts`,
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

interface ConnectionCandidate {
  id: string;
  provider: string;
  status: string;
}

/** Loads a connection that belongs to the Project. Disconnected rows never qualify. */
async function requireProjectConnection(
  projectId: string,
  socialConnectionId: string,
): Promise<ConnectionCandidate> {
  const connection = await prisma.projectSocialConnection.findFirst({
    where: { id: socialConnectionId, projectId },
    select: { id: true, provider: true, status: true },
  });
  if (!connection) {
    throw notFound("Project social connection not found");
  }
  if (connection.status === "disconnected") {
    throw conflict("Social connection is disconnected");
  }
  return connection;
}

async function requireActiveProjectConnection(
  projectId: string,
  socialConnectionId: string | null | undefined,
): Promise<ConnectionCandidate> {
  if (!socialConnectionId) {
    throw badRequest(CONNECTION_REQUIRED_MESSAGE);
  }
  const connection = await requireProjectConnection(
    projectId,
    socialConnectionId,
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
): Promise<SocialPostRecord> {
  const result = await prisma.socialPost.updateMany({
    where: { id: input.postId, revision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (result.count === 0) {
    throw conflict(REVISION_CONFLICT_MESSAGE, {
      kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
    });
  }
  return requireScopedPost(input);
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
  };
  const upcoming = input.statuses?.every(
    (status) => status === "SCHEDULED" || status === "PUBLISHING",
  );
  const [rows, count] = await Promise.all([
    prisma.socialPost.findMany({
      where,
      include: socialPostInclude,
      orderBy: upcoming
        ? [{ scheduledAt: "asc" }, { id: "asc" }]
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
): Promise<SocialPostSummary> {
  await requireScopedProject(input);
  return mapSocialPost(await requireScopedPost(input));
}

export async function createSocialPost(
  input: CreateSocialPostInput,
): Promise<SocialPostSummary> {
  await requireScopedProject(input);

  let connection: ConnectionCandidate | null = null;
  if (input.scheduledAt) {
    requireFutureScheduledAt(input.scheduledAt);
    connection = await requireActiveProjectConnection(
      input.projectId,
      input.socialConnectionId,
    );
  } else if (input.socialConnectionId) {
    connection = await requireProjectConnection(
      input.projectId,
      input.socialConnectionId,
    );
  }

  const provider = connection?.provider ?? "x";
  const media = normalizeSocialPostMedia({
    userId: input.userId,
    organizationId: input.organizationId,
    provider,
    media: input.media ?? [],
  });
  const text = requireTextWithinLimit(input.text, provider, media.length > 0);
  const scheduled = input.scheduledAt !== undefined;

  const post = await prisma.socialPost.create({
    data: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      socialConnectionId: connection?.id ?? null,
      provider,
      text,
      media: mediaJson(media),
      status: scheduled ? "SCHEDULED" : "DRAFT",
      scheduledAt: input.scheduledAt ?? null,
      timezone: input.timezone ?? null,
      creatorUserId: input.coworkerId ? null : input.userId,
      creatorCoworkerId: input.coworkerId ?? null,
      scheduledByUserId: scheduled ? input.userId : null,
      scheduledByCoworkerId: scheduled ? (input.coworkerId ?? null) : null,
    },
    include: socialPostInclude,
  });
  return mapSocialPost(post);
}

export async function updateSocialPost(
  input: UpdateSocialPostInput,
): Promise<SocialPostSummary> {
  await requireScopedProject(input);
  const post = await requireScopedPost(input);
  if (!EDITABLE_STATUSES.includes(post.status)) {
    throw conflict("Only a draft or scheduled post can be edited");
  }
  requireRevision(post, input.revision);

  const data: Prisma.SocialPostUncheckedUpdateManyInput =
    post.status === "SCHEDULED"
      ? {
          scheduledByUserId: input.userId,
          scheduledByCoworkerId: input.coworkerId ?? null,
        }
      : {};
  let media = parseSocialPostMedia(post.media, post.id);
  if (input.media !== undefined) {
    media = normalizeSocialPostMedia({
      userId: input.userId,
      organizationId: input.organizationId,
      provider: post.provider,
      media: input.media,
    });
    data.media = mediaJson(media);
  }
  if (input.text !== undefined || input.media !== undefined) {
    data.text = requireTextWithinLimit(
      input.text ?? post.text,
      post.provider,
      media.length > 0,
    );
  }

  if (input.socialConnectionId === null) {
    if (post.status === "SCHEDULED") {
      throw badRequest("A scheduled post must keep a social connection");
    }
    data.socialConnectionId = null;
  } else if (input.socialConnectionId !== undefined) {
    const connection =
      post.status === "SCHEDULED"
        ? await requireActiveProjectConnection(
            input.projectId,
            input.socialConnectionId,
          )
        : await requireProjectConnection(
            input.projectId,
            input.socialConnectionId,
          );
    data.socialConnectionId = connection.id;
  } else if (post.status === "SCHEDULED") {
    await requireActiveProjectConnection(
      input.projectId,
      post.socialConnectionId,
    );
  }

  return mapSocialPost(await writeWithRevision(input, input.revision, data));
}

export async function scheduleSocialPost(
  input: ScheduleSocialPostInput,
): Promise<SocialPostSummary> {
  await requireScopedProject(input);
  const post = await requireScopedPost(input);
  if (!SCHEDULABLE_STATUSES.includes(post.status)) {
    throw conflict("This post can no longer be scheduled");
  }
  requireRevision(post, input.revision);
  requireFutureScheduledAt(input.scheduledAt);
  const media = parseSocialPostMedia(post.media, post.id);
  const validation = validateSocialPostMedia(
    requireProvider(post.provider),
    media,
  );
  if (!validation.ok) {
    throw badRequest(
      mediaValidationMessage(requireProvider(post.provider), validation.reason),
    );
  }
  requireTextWithinLimit(post.text, post.provider, media.length > 0);
  const connection = await requireActiveProjectConnection(
    input.projectId,
    input.socialConnectionId ?? post.socialConnectionId,
  );

  return mapSocialPost(
    await writeWithRevision(input, input.revision, {
      status: "SCHEDULED",
      scheduledAt: input.scheduledAt,
      timezone: input.timezone ?? post.timezone,
      socialConnectionId: connection.id,
      scheduledByUserId: input.userId,
      scheduledByCoworkerId: input.coworkerId ?? null,
      lastError: null,
      attemptCount: 0,
      nextAttemptAt: null,
    }),
  );
}

export async function cancelSocialPost(
  input: CancelSocialPostInput,
): Promise<SocialPostSummary> {
  await requireScopedProject(input);
  const post = await requireScopedPost(input);
  if (post.status === "CANCELED") {
    return mapSocialPost(post);
  }
  if (!CANCELABLE_STATUSES.includes(post.status)) {
    throw conflict("Only a draft or scheduled post can be canceled");
  }
  requireRevision(post, input.revision);

  return mapSocialPost(
    await writeWithRevision(input, input.revision, {
      status: "CANCELED",
      canceledAt: new Date(),
    }),
  );
}
