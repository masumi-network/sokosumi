import type { Prisma, SocialPostStatus } from "@sokosumi/database";
import { SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";

import {
  badRequest,
  conflict,
  internalServerError,
  notFound,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";

const LIST_LIMIT = 200;
/** A post must be scheduled at least this far ahead so the publisher can pick it up. */
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
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
}

export interface GetSocialPostInput extends ProjectScope {
  postId: string;
}

export interface CreateSocialPostInput extends ProjectScope {
  userId: string;
  text: string;
  socialConnectionId?: string;
  scheduledAt?: Date;
  timezone?: string;
}

export interface UpdateSocialPostInput extends ProjectScope {
  userId: string;
  postId: string;
  text?: string;
  socialConnectionId?: string | null;
  revision: number;
}

export interface ScheduleSocialPostInput extends ProjectScope {
  userId: string;
  postId: string;
  scheduledAt: Date;
  timezone?: string;
  socialConnectionId?: string;
  revision: number;
}

export interface CancelSocialPostInput extends ProjectScope {
  userId: string;
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
    status: record.status,
    scheduledAt: record.scheduledAt,
    timezone: record.timezone,
    socialConnection: record.socialConnection,
    creator: mapCreator(record),
    scheduledByUserId: record.scheduledByUserId,
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

function requireTextWithinLimit(text: string, provider: string): string {
  const trimmed = text.trim();
  const limit =
    SOCIAL_POST_TEXT_LIMITS[provider as keyof typeof SOCIAL_POST_TEXT_LIMITS];
  if (limit === undefined) {
    throw badRequest(`Unsupported social provider: ${provider}`);
  }
  if (trimmed.length === 0) {
    throw badRequest("Text is required");
  }
  if (trimmed.length > limit) {
    throw badRequest(
      `Text must be at most ${limit} characters for ${provider}`,
    );
  }
  return trimmed;
}

function requireFutureScheduledAt(scheduledAt: Date): void {
  if (scheduledAt.getTime() <= Date.now() + MIN_SCHEDULE_LEAD_MS) {
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
    throw conflict(REVISION_CONFLICT_MESSAGE);
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
    throw conflict(REVISION_CONFLICT_MESSAGE);
  }
  return requireScopedPost(input);
}

export async function listSocialPosts(
  input: ListSocialPostsInput,
): Promise<SocialPostSummary[]> {
  await requireScopedProject(input);
  const posts = await prisma.socialPost.findMany({
    where: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      ...(input.statuses ? { status: { in: [...input.statuses] } } : {}),
    },
    include: socialPostInclude,
    orderBy: [
      { scheduledAt: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: LIST_LIMIT,
  });
  return posts.map(mapSocialPost);
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
  const text = requireTextWithinLimit(input.text, provider);
  const scheduled = input.scheduledAt !== undefined;

  const post = await prisma.socialPost.create({
    data: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      socialConnectionId: connection?.id ?? null,
      provider,
      text,
      status: scheduled ? "SCHEDULED" : "DRAFT",
      scheduledAt: input.scheduledAt ?? null,
      timezone: input.timezone ?? null,
      creatorUserId: input.userId,
      scheduledByUserId: scheduled ? input.userId : null,
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

  const data: Prisma.SocialPostUncheckedUpdateManyInput = {};
  if (input.text !== undefined) {
    data.text = requireTextWithinLimit(input.text, post.provider);
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
