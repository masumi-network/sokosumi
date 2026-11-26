import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Prisma,
  ProjectSocialConnection,
  SocialPostStatus,
} from "@sokosumi/database";
import {
  LINKEDIN_HOOK_RULE,
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
  SOCIAL_POST_THREAD_MAX_PARTS,
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
import {
  socialPostConnectionSelect,
  socialPostConnectionSummary,
} from "@/helpers/project-social-connection-summary";
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
import { summarizeSocialPostThread } from "@/helpers/social-post-thread";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { EmbedTexts } from "@/lib/embeddings";
import { findRepeats, similarities } from "@/lib/repeats";
import {
  socialPostFormattingError,
  stackedCaveatsProblem,
  tagOwnLinks,
} from "@/lib/social-post-writing";
import { evaluateWithJev } from "@/lib/soko-bot/jev";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";
import {
  type SocialPostStatistics,
  socialPostStatisticsSchema,
} from "@/schemas/social-post-statistics.schema";
import {
  requireLockedOpenProject,
  requireScopedProject,
} from "@/services/project-social-connections.service";
import {
  scheduleLeadMs,
  TEST_COPY_SCHEDULE_FLOOR_MESSAGE,
} from "@/services/project-test-copy";
import {
  prepareSocialPostMedia,
  requirePreparedSocialPostProvider,
} from "@/services/social-post-media-preparation.service";
import { recordSocialStudioAdEvents } from "@/services/social-studio-events.service";
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
  "FAILED",
  "MISSED",
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
  "FAILED",
  "MISSED",
];

const socialPostInclude = {
  threadParts: { orderBy: { position: "asc" } },
  quotedPost: { select: socialPostQuoteSelect },
  project: { select: socialProviderProjectSelect },
  socialConnection: { select: socialPostConnectionSelect },
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
    personalProfile: boolean;
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
  /** ADR 0077: no person at the keyboard (API key, OAuth or MCP token, Coworker); the write waits for a person's approval. */
  agent?: boolean;
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
  /** ADR 0077: no person at the keyboard (API key, OAuth or MCP token, Coworker); the write waits for a person's approval. */
  agent?: boolean;
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
  organizationId?: string | null;
  /** Prepared before the scheduling transaction when the target account changes. */
  media?: SocialPostMediaRef[];
  coworkerId?: string;
  /** ADR 0077: no person at the keyboard (API key, OAuth or MCP token, Coworker); the write waits for a person's approval. */
  agent?: boolean;
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
  /** ADR 0077: no person at the keyboard (API key, OAuth or MCP token, Coworker); the write waits for a person's approval. */
  agent?: boolean;
  postId: string;
}

export interface RecycleSocialAccountPostInput
  extends ProjectScope,
    WorkspaceOwnerScope {
  userId: string;
  coworkerId?: string;
  /** ADR 0077: no person at the keyboard (API key, OAuth or MCP token, Coworker); the write waits for a person's approval. */
  agent?: boolean;
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

/** The post's provider, and its connection's, are available to the owning Project. */
export function isSocialPostProviderEnabled(
  record: Pick<SocialPostRecord, "provider" | "project"> & {
    socialConnection: { provider: string } | null;
  },
): boolean {
  const workspace = socialProviderWorkspaceForProject(record.project);
  return (
    isSocialProviderEnabled(record.provider, workspace) &&
    (!record.socialConnection ||
      isSocialProviderEnabled(record.socialConnection.provider, workspace))
  );
}

export function mapSocialPost(record: SocialPostRecord): SocialPostSummary {
  const media = parseSocialPostMedia(record.media, record.id);
  const provider = isSocialPostProvider(record.provider)
    ? record.provider
    : null;
  const quoteReady =
    socialPostQuotePublishDecision(record, record.quotedPost, new Date())
      .kind === "ready";
  const providerEnabled = isSocialPostProviderEnabled(record);
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
    socialConnection: socialPostConnectionSummary(record.socialConnection),
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
      record.socialConnection !== null &&
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
    const near = await nearPostId(input, tx);
    throw notFound(
      near
        ? `Social post not found. Did you mean ${near}?`
        : "Social post not found",
    );
  }
  return post;
}

/**
 * The one post in the scope whose id ends like the one asked for: a bot
 * once copied "b3d8" for "b3d9" in a month of near-identical ids and
 * retried the wrong id until its runs ran out.
 */
async function nearPostId(
  input: GetSocialPostInput,
  tx: Prisma.TransactionClient,
): Promise<string | null> {
  const tail = input.postId.match(/-([0-9a-f]{12})$/i)?.[1]?.toLowerCase();
  if (!tail) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM social_post
    WHERE "projectId" = ${input.projectId}::uuid
      AND "workspaceId" = ${input.workspaceId}::uuid
      AND id::text LIKE ${`%-${tail}`}
    LIMIT 2`;
  return rows.length === 1 ? (rows[0]?.id ?? null) : null;
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

/**
 * What a Soko Bot's post in a marketing month does to its links: those to
 * the business's own site get UTM tags (network, social, cmo-YYYY-MM), so
 * analytics can tell the visits Cuso brought. Every other text stays as is.
 */
async function cmoLinkTags(
  tx: Prisma.TransactionClient,
  input: { sokoBotId?: string | null },
  post: {
    projectId: string;
    marketingStrategyId: string | null;
    scheduledAt: Date | null;
  },
  provider: SocialPostProvider,
): Promise<(text: string) => string> {
  if (!input.sokoBotId || !post.marketingStrategyId) return (text) => text;
  const project = await tx.project.findUnique({
    where: { id: post.projectId },
    select: { websiteUrl: true },
  });
  const siteUrl = project?.websiteUrl;
  if (!siteUrl) return (text) => text;
  const campaign = `cmo-${(post.scheduledAt ?? new Date()).toISOString().slice(0, 7)}`;
  return (text) => tagOwnLinks(text, { siteUrl, source: provider, campaign });
}

/**
 * A Soko Bot's post in a marketing month carries its own pictures (one
 * picture once went on three posts) and states its facts plainly.
 */
async function requireOwnInMonth(
  tx: Prisma.TransactionClient,
  post: { id: string; marketingStrategyId: string },
  change: { text: string | null; media: readonly SocialPostMediaRef[] },
): Promise<void> {
  const siblings = await tx.socialPost.findMany({
    where: {
      marketingStrategyId: post.marketingStrategyId,
      id: { not: post.id },
      status: { not: "CANCELED" },
    },
    select: { id: true, text: true, media: true },
  });
  for (const item of change.media) {
    const holder = siblings.find((sibling) =>
      parseSocialPostMedia(sibling.media, sibling.id).some(
        (other) => other.pathname === item.pathname,
      ),
    );
    if (holder)
      throw badRequest(
        `Use another picture: "${item.name}" is already on the post "${firstLine(holder.text)}", and each post gets its own.`,
      );
  }
  if (change.text === null) return;
  const caveats = stackedCaveatsProblem(change.text);
  if (caveats) throw badRequest(`Rewrite the post: it ${caveats}.`);
}

const batchStorage = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Runs an update_social_posts batch. `unsaved` holds the batch's posts whose
 * new text is not settled yet. The checks still compare with the words those
 * posts hold now, since each edit commits on its own and a later one can
 * fail; a match on one of them only asks the post to wait for it.
 */
export function withSocialPostBatch<T>(
  unsaved: ReadonlySet<string>,
  run: () => Promise<T>,
): Promise<T> {
  return batchStorage.run(unsaved, run);
}

/** Whether a post's words may still change in the running batch. */
function unsavedInBatch(postId: string): boolean {
  return batchStorage.getStore()?.has(postId) ?? false;
}

/**
 * A check's answer. `waitsForBatch` marks a match on a post of the running
 * batch that may still get new words: the edit is tried again after it.
 */
export interface SocialPostCheck {
  problem: string | null;
  costUsd: number;
  waitsForBatch?: true;
}

/**
 * The month's other posts as `id:revision`, read before a post's words are
 * checked and again in the save's transaction: two edits checked at once
 * each passed against the other's old words and both saved "April release."
 * (Codex round 11). Null for a post outside a marketing month.
 */
export async function monthSiblingsStamp(
  input: { postId: string; workspaceId: string },
  client: Pick<Prisma.TransactionClient, "socialPost"> = prisma,
): Promise<string | null> {
  const post = await client.socialPost.findFirst({
    where: { id: input.postId, workspaceId: input.workspaceId },
    select: { marketingStrategyId: true },
  });
  if (!post?.marketingStrategyId) return null;
  const siblings = await client.socialPost.findMany({
    where: {
      marketingStrategyId: post.marketingStrategyId,
      id: { not: input.postId },
      status: { not: "CANCELED" },
    },
    select: { id: true, revision: true },
    orderBy: { id: "asc" },
  });
  return siblings.map((sibling) => `${sibling.id}:${sibling.revision}`).join();
}

/** Another post of the month changed between a post's check and its save. */
export class MonthPostsChangedError extends Error {
  constructor() {
    super(
      "Another post of this month changed while this edit was checked: send it again, and its words are checked against the new ones.",
    );
  }
}

function waitForBatchPost(text: string, costUsd: number): SocialPostCheck {
  return {
    problem: `Wait for another post of this batch: this text says nearly what the post "${firstLine(text)}" says now.`,
    costUsd,
    waitsForBatch: true,
  };
}

/**
 * Why a Soko Bot's new text for a post in a marketing month says what
 * another post of the month says (a month once repeated four messages
 * across 45 posts), or null, with what comparing cost. It waits on the
 * embedding model, so callers run it before the save's transaction.
 */
export async function ownMessageProblem(
  input: { postId: string; workspaceId: string; text: string },
  embed?: EmbedTexts,
): Promise<SocialPostCheck> {
  const post = await prisma.socialPost.findFirst({
    where: { id: input.postId, workspaceId: input.workspaceId },
    select: { marketingStrategyId: true, planning: true },
  });
  if (!post?.marketingStrategyId) return { problem: null, costUsd: 0 };
  // A talking video's posts on several networks say the same thing on purpose.
  const videoOf = (planning: unknown) => {
    const plan = planning as { id?: unknown; videoOf?: unknown } | null;
    return plan?.videoOf ?? plan?.id ?? null;
  };
  const video = videoOf(post.planning);
  const siblings = await prisma.socialPost.findMany({
    where: {
      marketingStrategyId: post.marketingStrategyId,
      id: { not: input.postId },
      status: { not: "CANCELED" },
    },
    select: { id: true, text: true, planning: true },
  });
  // An idea still shows its plan's brief or title until it is written.
  const written = siblings.filter((sibling) => {
    const planning = sibling.planning as { brief?: unknown; title?: unknown };
    return (
      sibling.text !== planning?.brief &&
      sibling.text !== planning?.title &&
      (video === null || videoOf(sibling.planning) !== video)
    );
  });
  const { repeats, costUsd } = await findRepeats(
    [...written.map((sibling) => sibling.text), input.text],
    "post",
    embed,
  );
  const repeated = written[repeats.at(-1) ?? -1];
  if (repeated && unsavedInBatch(repeated.id))
    return waitForBatchPost(repeated.text, costUsd);
  return {
    problem: repeated
      ? `Rewrite the post: it says nearly what the post "${firstLine(repeated.text)}" says. Give it its own message from its pillar: another claim, number, customer or step.`
      : null,
    costUsd,
  };
}

const OPENING_REFUSAL = "Rewrite the post's first line";
const MAX_OPENING_REFUSALS = 2;

/**
 * Below this Jev reads the opening as a miss. LINKEDIN_HOOK_RULE's labelled
 * lines split cleanly at 0.35, but on NMKR's real month advice lines ("A
 * token mint does not finish a launch.") scored 0.36 to 0.45 and failed the
 * month review.
 */
const OPENING_PASS = 0.45;

/**
 * The line a LinkedIn reader decides on before "see more". Two lines once let
 * a flat first line pass on the result Cuso moved to the second, which Jev's
 * month review then failed.
 */
export function linkedInOpening(text: string): string {
  return (
    text
      .trim()
      .split(/\n+/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 160) ?? ""
  );
}

/**
 * cmo-v8: a LinkedIn post in a month opens on a result, a number, a named
 * customer or a surprising decision. cal.com's month (2026-11-20) failed
 * Jev's hook rule on 2 of 2 runs with openings that gave advice.
 */
export async function linkedInOpeningProblem(
  input: { postId: string; workspaceId: string; text: string },
  evaluate: typeof evaluateWithJev = evaluateWithJev,
  embed?: EmbedTexts,
): Promise<SocialPostCheck> {
  const post = await prisma.socialPost.findFirst({
    where: { id: input.postId, workspaceId: input.workspaceId },
    select: { marketingStrategyId: true, provider: true },
  });
  if (!post?.marketingStrategyId || post.provider.toLowerCase() !== "linkedin")
    return { problem: null, costUsd: 0 };
  // A post's opening is held up twice at most: on NMKR's one-pillar month
  // the same posts came back again and again, and the month never finished.
  const [{ refused } = { refused: 0 }] = await prisma.$queryRaw<
    { refused: number }[]
  >`
    SELECT count(*)::int AS refused FROM "soko_bot_tool_call"
    WHERE "capability" = 'update_social_post' AND "status" = 'FAILED'
      AND "input"->>'postId' = ${input.postId}
      AND "errorDetail" LIKE ${`%${OPENING_REFUSAL}%`}
  `.catch(() => [{ refused: 0 }]);
  if (refused >= MAX_OPENING_REFUSALS) return { problem: null, costUsd: 0 };
  const opening = linkedInOpening(input.text);
  // One proof as five posts' first line (NMKR's month opened on Book.io's
  // 130,000 NFTs again and again) reads as one post.
  const others = await prisma.socialPost.findMany({
    where: {
      marketingStrategyId: post.marketingStrategyId,
      id: { not: input.postId },
      provider: post.provider,
      status: { not: "CANCELED" },
    },
    select: { id: true, text: true, planning: true },
  });
  const written = others.filter((other) => {
    const planning = other.planning as { title?: unknown; brief?: unknown };
    return other.text !== planning?.title && other.text !== planning?.brief;
  });
  const openings = written.map((other) => linkedInOpening(other.text));
  const { repeats, costUsd: compared } = await findRepeats(
    [...openings, opening],
    "title",
    embed,
  );
  const echoedIndex = repeats.at(-1) ?? -1;
  const echoed = openings[echoedIndex];
  const echoedPost = written[echoedIndex];
  if (echoedPost && unsavedInBatch(echoedPost.id))
    return waitForBatchPost(echoedPost.text, compared);
  if (echoed)
    return {
      problem: `${OPENING_REFUSAL}: it opens like another LinkedIn post of the month ("${echoed}"). Open with another true fact from the piece: its own result, number, customer or decision.`,
      costUsd: compared,
    };
  try {
    const { answers, costUsd } = await evaluate({
      state: { opening },
      questions: {
        hook: {
          type: "boolean",
          instructions: `Does this LinkedIn post's opening line follow this rule? ${LINKEDIN_HOOK_RULE}`,
        },
      },
      timeoutMs: 15_000,
    });
    const answer = answers.get("hook");
    const passed =
      answer?.type !== "boolean" || answer.probability >= OPENING_PASS;
    return {
      problem: passed
        ? null
        : `${OPENING_REFUSAL}: "${opening}" gives no reason to tap "see more". Open with the most surprising true thing in the piece: a result with its number, a price or another number from the business, a named customer and what they did, or a decision that sounds wrong at first. Advice or a question is not an opening.`,
      costUsd: costUsd + compared,
    };
  } catch {
    // A quality check: when Jev does not answer, the post is not held up.
    return { problem: null, costUsd: 0 };
  }
}

/**
 * How much closer to another piece's claim than to its own a post must be
 * to argue that one instead (cmo-v8), and how close at least.
 */
export const CLAIM_MARGIN = 0.15;
export const CLAIM_FLOOR = 0.6;

/**
 * A post whose words argue another piece's claim rather than its own: the
 * same point in other words, which a word-by-word compare misses.
 */
export async function otherClaimArgued(
  text: string,
  own: string | null,
  claims: readonly string[],
  embed?: EmbedTexts,
): Promise<{ problem: string | null; costUsd: number }> {
  const theirs = [...new Set(claims)].filter((claim) => claim !== own);
  if (!own || theirs.length === 0) return { problem: null, costUsd: 0 };
  const { scores, costUsd } = await similarities(text, [own, ...theirs], embed);
  if (!scores) return { problem: null, costUsd };
  const [ownScore = 0, ...others] = scores;
  const best = others.reduce(
    (top, score, index) => (score > top.score ? { score, index } : top),
    { score: 0, index: -1 },
  );
  const claim = theirs[best.index];
  return {
    problem:
      claim &&
      best.score >= CLAIM_FLOOR &&
      best.score >= ownScore + CLAIM_MARGIN
        ? `Rewrite the post: it argues another piece's claim ("${claim}"), not its own ("${own}"). Make the post argue its own claim.`
        : null,
    costUsd,
  };
}

/**
 * A bot schedules a month post with a picture only once Core put the
 * picture on it: Core attaches pictures to drafts alone, so an X post Cuso
 * scheduled early would have gone out without its image.
 */
export async function requireMonthPostPicture(
  tx: Prisma.TransactionClient,
  input: { postId: string; workspaceId: string },
): Promise<void> {
  const post = await tx.socialPost.findFirst({
    where: { id: input.postId, workspaceId: input.workspaceId },
    select: { marketingStrategyId: true, planning: true, media: true },
  });
  const visual = (post?.planning as { visual?: unknown } | null)?.visual;
  if (
    post?.marketingStrategyId &&
    typeof visual === "string" &&
    visual.trim() &&
    parseSocialPostMedia(post.media, input.postId).length === 0
  )
    throw badRequest(
      "Leave this post as a draft: Core is making its picture and schedules it once the picture is on it.",
    );
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
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
  requirePreparedSocialPostProvider(input.media, provider);
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
      ...(ref.aiGenerated && { aiGenerated: true }),
      ...(ref.transformation ? { transformation: ref.transformation } : {}),
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

/** A time far enough ahead: at once for most, 12 hours for a test copy (ADR 0073). */
function requireFutureScheduledAt(
  scheduledAt: Date,
  project: { testCopyOfProjectId: string | null },
): void {
  const leadMs = scheduleLeadMs(project, SOCIAL_POST_MIN_SCHEDULE_LEAD_MS);
  if (scheduledAt.getTime() <= Date.now() + leadMs) {
    throw badRequest(
      project.testCopyOfProjectId
        ? TEST_COPY_SCHEDULE_FLOOR_MESSAGE
        : "Scheduled time must be in the future",
    );
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
  | "executorProjectId"
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
      executorProjectId: true,
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
  return readSocialPostsPage(input);
}

/**
 * Social posts of every Project in the workspace: the same Projects a member
 * can open one at a time, read in one list (Social's All projects view).
 */
export function listWorkspaceSocialPosts(
  input: Omit<ListSocialPostsInput, "projectId">,
): Promise<{ posts: SocialPostSummary[]; pagination: CursorPaginationMeta }> {
  return readSocialPostsPage(input);
}

async function readSocialPostsPage(
  input: Omit<ListSocialPostsInput, "projectId"> & { projectId?: string },
): Promise<{ posts: SocialPostSummary[]; pagination: CursorPaginationMeta }> {
  const { cursor, take } = parseCursorPagination(input);
  const where: Prisma.SocialPostWhereInput = {
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
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
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

interface SocialPostMediaMutationInput {
  organizationId?: string | null;
  workspaceId: string;
  userId: string;
  projectId: string;
  postId?: string;
  socialConnectionId?: string | null;
  media?: readonly SocialPostMediaRef[];
  threadParts?: SocialPostThreadPartInput[];
}

/** Resolves image adaptations before opening the mutation's database transaction. */
export async function prepareSocialPostMutationMedia<
  T extends SocialPostMediaMutationInput,
>(input: T): Promise<T> {
  if (
    input.media === undefined &&
    input.socialConnectionId === undefined &&
    !input.threadParts?.some((part) => part.media?.length)
  )
    return input;
  await requireScopedProject(input);
  const post = input.postId
    ? await prisma.socialPost.findUnique({
        where: {
          id: input.postId,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
        },
        select: {
          id: true,
          provider: true,
          media: true,
          socialConnectionId: true,
        },
      })
    : null;
  if (input.postId && !post) throw notFound("Social post not found");
  const connectionId =
    input.socialConnectionId !== undefined
      ? input.socialConnectionId
      : post?.socialConnectionId;
  const provider = connectionId
    ? requireProvider(
        (await requireProjectConnection(input.projectId, connectionId, prisma))
          .provider,
      )
    : post && input.socialConnectionId === undefined
      ? requireProvider(post.provider)
      : "x";
  const media =
    input.media ?? (post ? parseSocialPostMedia(post.media, post.id) : []);
  if (
    media.length === 0 &&
    input.media === undefined &&
    !input.threadParts?.some((part) => part.media?.length)
  )
    return input;
  const organizationId =
    input.organizationId !== undefined
      ? input.organizationId
      : (
          await prisma.workspace.findUniqueOrThrow({
            where: { id: input.workspaceId },
            select: { organizationId: true },
          })
        ).organizationId;
  const scope = { ...input, organizationId };
  return {
    ...input,
    media: await prepareSocialPostMedia(scope, provider, media),
    ...(input.threadParts
      ? {
          threadParts: await Promise.all(
            input.threadParts.map(async (part) => ({
              ...part,
              ...(part.media
                ? {
                    media: await prepareSocialPostMedia(
                      scope,
                      provider,
                      part.media,
                    ),
                  }
                : {}),
            })),
          ),
        }
      : {}),
  };
}

export async function createSocialPost(
  input: CreateSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) input = await prepareSocialPostMutationMedia(input);
  if ((input.scheduledAt || input.quotedPostId) && tx === prisma) {
    const post = await serializableTransaction(
      (tx) => createSocialPost(input, tx),
      "Project changed while scheduling a Social post",
    );
    await recordSocialStudioAdEvents({
      ...input,
      postId: post.id,
      type: "attached_to_post",
      media: post.media,
      threadParts: post.threadParts,
    });
    if (post.status === "SCHEDULED") {
      await recordSocialStudioAdEvents({
        ...input,
        postId: post.id,
        type: "scheduled",
        media: post.media,
        threadParts: post.threadParts,
      });
    }
    return post;
  }
  if (input.coworkerId && input.sokoBotId) {
    throw badRequest(
      "A social post cannot have both a Coworker and Soko Bot creator",
    );
  }
  const project = input.scheduledAt
    ? await requireLockedOpenProject(tx, input, {
        closedMessage: PROJECT_CLOSED_MESSAGE,
      })
    : await requireScopedProject(input, { client: tx });

  let connection: ConnectionCandidate | null = null;
  if (input.scheduledAt) {
    requireFutureScheduledAt(input.scheduledAt, project);
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
  const agentDraft = Boolean(
    input.agent || input.coworkerId || input.sokoBotId,
  );
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
  const summary = mapSocialPost(post);
  if (tx === prisma) {
    await recordSocialStudioAdEvents({
      ...input,
      postId: summary.id,
      type: "attached_to_post",
      media: summary.media,
      threadParts: summary.threadParts,
    });
  }
  return summary;
}

export async function updateSocialPost(
  input: UpdateSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    input = await prepareSocialPostMutationMedia(input);
    const previous =
      input.media !== undefined || input.threadParts !== undefined
        ? await getSocialPost(input).catch(() => undefined)
        : undefined;
    const post = await serializableTransaction(
      (tx) => updateSocialPost(input, tx),
      "Project changed while editing a Social post",
    );
    if (previous) {
      await recordSocialStudioAdEvents({
        ...input,
        postId: post.id,
        type: "attached_to_post",
        media: post.media,
        threadParts: post.threadParts,
        previousMedia: previous.media,
        previousThreadParts: previous.threadParts,
      });
    }
    if (input.scheduledAt && post.status === "SCHEDULED") {
      await recordSocialStudioAdEvents({
        ...input,
        postId: post.id,
        type: "scheduled",
        media: post.media,
        threadParts: post.threadParts,
      });
    }
    return post;
  }
  const project = await requireScopedProject(input, { client: tx });
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
  if (input.scheduledAt) requireFutureScheduledAt(input.scheduledAt, project);

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
      : post.status === "FAILED" || post.status === "MISSED"
        ? { lastError: null, attemptCount: 0, nextAttemptAt: null }
        : {};
  // ADR 0077: an agent's edit never publishes on its own; a person approves it.
  if (input.agent || input.coworkerId) data.status = "NEEDS_APPROVAL";
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
  const tag = await cmoLinkTags(tx, input, post, provider);
  const text = requireTextWithinLimit(
    input.text !== undefined ? tag(input.text) : post.text,
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
    if (
      post.status === "SCHEDULED" ||
      post.status === "FAILED" ||
      post.status === "MISSED"
    ) {
      requireMediaRequirement(provider, media);
    }
  }

  const firstComment = requireFirstCommentWithinLimit(
    input.firstComment !== undefined
      ? input.firstComment && tag(input.firstComment)
      : post.firstComment,
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
  if (
    input.sokoBotId &&
    post.marketingStrategyId &&
    (input.text !== undefined || input.media !== undefined)
  )
    await requireOwnInMonth(
      tx,
      { id: post.id, marketingStrategyId: post.marketingStrategyId },
      {
        text: input.text !== undefined ? text : null,
        media: input.media !== undefined ? media : [],
      },
    );

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
    input = await prepareSocialPostMutationMedia(input);
    const previous =
      input.media !== undefined
        ? await getSocialPost(input).catch(() => undefined)
        : undefined;
    const post = await serializableTransaction(
      (tx) => scheduleSocialPost(input, tx),
      "Project changed while scheduling a Social post",
    );
    if (previous) {
      await recordSocialStudioAdEvents({
        ...input,
        postId: post.id,
        type: "attached_to_post",
        media: post.media,
        threadParts: post.threadParts,
        previousMedia: previous.media,
        previousThreadParts: previous.threadParts,
      });
    }
    if (post.status === "SCHEDULED") {
      await recordSocialStudioAdEvents({
        ...input,
        postId: post.id,
        type: "scheduled",
        media: post.media,
        threadParts: post.threadParts,
      });
    }
    return post;
  }
  const project = await requireLockedOpenProject(tx, input, {
    closedMessage: PROJECT_CLOSED_MESSAGE,
  });
  const post = await requireScopedPost(input, tx);
  if (!SCHEDULABLE_STATUSES.includes(post.status)) {
    throw conflict("This post can no longer be scheduled");
  }
  requireRevision(post, input.revision);
  requireFutureScheduledAt(input.scheduledAt, project);
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
  const media = input.media ?? parseSocialPostMedia(post.media, post.id);
  const currentProvider = requireProvider(post.provider);
  const connection = await requireActiveProjectConnection(
    input.projectId,
    input.socialConnectionId ?? post.socialConnectionId,
    tx,
  );
  const provider = requireProvider(connection.provider);
  requirePreparedSocialPostProvider(media, provider);
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
          // ADR 0077: an agent's schedule waits for a person's approval.
          status:
            input.agent || input.coworkerId || post.status === "NEEDS_APPROVAL"
              ? "NEEDS_APPROVAL"
              : "SCHEDULED",
          scheduledAt: input.scheduledAt,
          timezone: input.timezone ?? post.timezone,
          socialConnectionId: connection.id,
          ...(input.media ? { media: mediaJson(media) } : {}),
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

export interface RestoreCanceledSocialPostInput extends CancelSocialPostInput {
  organizationId?: string | null;
  /** The time it was planned at before the cancel; kept on the draft. */
  scheduledAt: Date | null;
  timezone?: string;
  /** It was scheduled: it is scheduled again through Social's own checks. */
  schedule: boolean;
}

/**
 * Takes back a cancel (an owner's change undone, cmo-v25): the post comes
 * back as a draft at its planned time, still at the revision the cancel
 * left, and the posts quoting it lose the flag the cancel put on them. A
 * post that was scheduled is then scheduled again through
 * `scheduleSocialPost`, so every check a schedule passes runs again.
 */
export async function restoreCanceledSocialPost(
  input: RestoreCanceledSocialPostInput,
): Promise<SocialPostSummary> {
  const draft = await serializableTransaction(async (tx) => {
    await requireScopedProject(input, { client: tx });
    const post = await requireScopedPost(input, tx);
    if (post.status !== "CANCELED")
      throw conflict("Only a canceled post can be restored");
    requireRevision(post, input.revision);
    const restored = await writeWithRevision(
      input,
      input.revision,
      {
        status: "DRAFT",
        canceledAt: null,
        scheduledAt: input.scheduledAt,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
      tx,
    );
    await tx.socialPost.updateMany({
      where: {
        quotedPostId: post.id,
        needsAttentionReason: QUOTED_POST_CANCELLED,
        status: { notIn: ["PUBLISHED", "CANCELED"] },
      },
      data: {
        needsAttentionReason: null,
        lastError: null,
        revision: { increment: 1 },
      },
    });
    return mapSocialPost(restored);
  }, "Post changed while restoring a Social post");
  if (!input.schedule || !input.scheduledAt) return draft;
  return scheduleSocialPost({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    organizationId: input.organizationId,
    ...(input.coworkerId ? { coworkerId: input.coworkerId } : {}),
    postId: draft.id,
    revision: draft.revision,
    scheduledAt: input.scheduledAt,
    ...(input.timezone ? { timezone: input.timezone } : {}),
  });
}

export async function approveSocialPost(
  input: ApproveSocialPostInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostSummary> {
  if (tx === prisma) {
    const post = await serializableTransaction(
      (tx) => approveSocialPost(input, tx),
      "Project changed while approving a Social post",
    );
    if (post.status === "SCHEDULED") {
      await recordSocialStudioAdEvents({
        ...input,
        postId: post.id,
        type: "scheduled",
        media: post.media,
        threadParts: post.threadParts,
      });
    }
    return post;
  }
  const project = await requireLockedOpenProject(tx, input, {
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
  // A test copy's approved post sooner than its floor stays a draft.
  const schedule =
    due != null &&
    due.getTime() >=
      Date.now() + scheduleLeadMs(project, SOCIAL_POST_MIN_SCHEDULE_LEAD_MS);
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
      status: input.agent || input.coworkerId ? "NEEDS_APPROVAL" : "DRAFT",
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
      agent: input.agent,
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
