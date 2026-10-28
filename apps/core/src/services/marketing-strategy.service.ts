import {
  type MarketingStrategy,
  type Prisma,
  type SocialPostStatus,
} from "@sokosumi/database";
import {
  type CmoBrandAnswer,
  type CmoCalendarEntry,
  type CmoSocialPostPlanning,
  type CmoStrategy,
  cmoSocialPostPlanningSchema,
  cmoStrategySchema,
} from "@sokosumi/soko-bot";
import {
  CMO_CHANNELS,
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostMediaRef,
  type SocialPostProvider,
} from "@sokosumi/utils";

import { conflict, forbidden, notFound } from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import { organizationRoleInWorkspace } from "@/helpers/soko-bot-management";
import {
  getLocalTimeParts,
  toLocalDateKey,
  zonedDateTimeLocalToUtc,
} from "@/helpers/task-schedule";
import prisma from "@/lib/db/prisma";
import {
  STRATEGY_TURN_PREFIX,
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "@/services/cmo-cuso.service";

/**
 * A Project's Marketing strategy (ADR 0062): one row per version. A write
 * adds a version and never changes another; the Workspace's owners or
 * admins approve one, and only that one is carried out. Reverting approves
 * an older version again.
 */

export function parseMarketingPlan(value: unknown): CmoStrategy | null {
  const parsed = cmoStrategySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Every column but the plan: what a list of versions shows. */
export const MARKETING_STRATEGY_VERSION_SELECT = {
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
  authorSokoBotId: true,
  authorUserId: true,
  turnId: true,
  approvedAt: true,
  approvedByUserId: true,
} as const satisfies Prisma.MarketingStrategySelect;

const NEWEST_FIRST = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.MarketingStrategyOrderByWithRelationInput[];

/** The version being carried out, or null before any approval. */
export function approvedMarketingStrategy(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy | null> {
  return db.marketingStrategy.findFirst({
    where: { projectId, approvedAt: { not: null } },
  });
}

/** The latest version, approved or not. */
export function newestMarketingStrategy(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy | null> {
  return db.marketingStrategy.findFirst({
    where: { projectId },
    orderBy: [...NEWEST_FIRST],
  });
}

export function listMarketingStrategies(projectId: string) {
  return prisma.marketingStrategy.findMany({
    where: { projectId },
    orderBy: [...NEWEST_FIRST],
    select: MARKETING_STRATEGY_VERSION_SELECT,
  });
}

export async function getMarketingStrategy(
  projectId: string,
  strategyId: string,
): Promise<MarketingStrategy> {
  const version = await prisma.marketingStrategy.findFirst({
    where: { id: strategyId, projectId },
  });
  if (!version) throw notFound("Marketing strategy version not found");
  return version;
}

/**
 * Approving commits the business: the Workspace's organization owners and
 * admins, or a personal Workspace's owner.
 */
export async function mayApproveMarketingStrategy(
  userId: string,
  workspace: {
    id: string;
    userId: string | null;
    organizationId: string | null;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  if (!workspace.organizationId) return workspace.userId === userId;
  const role = await organizationRoleInWorkspace(userId, workspace.id, db);
  return role !== null && isOrganizationOwnerOrAdmin(role);
}

/** A strategy turn of the Project's bot still running: its version is not done. */
async function strategyBeingWritten(projectId: string): Promise<boolean> {
  const writing = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBot: { projectId },
      clientTurnId: { startsWith: STRATEGY_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
  if (!writing) return false;
  return (await settledTurnStatus(writing, new Date())) === "running";
}

/**
 * Approves one version and withdraws the approval of any other, so the
 * Project carries out exactly this one. Approving an older version reverts.
 */
export async function approveMarketingStrategy(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  strategyId: string;
}): Promise<MarketingStrategy> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: {
      workspace: { select: { id: true, userId: true, organizationId: true } },
    },
  });
  if (!project) throw notFound("Project not found");
  if (!(await mayApproveMarketingStrategy(input.userId, project.workspace))) {
    throw forbidden(
      "Only the Workspace's owners and admins approve a Marketing strategy",
    );
  }
  if (await strategyBeingWritten(input.projectId)) {
    throw conflict(
      "A new version of the strategy is being written; approve when it is ready",
    );
  }
  return prisma.$transaction(async (tx) => {
    // One approval at a time per Project, so two never race the unique index.
    await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${input.projectId}::uuid FOR UPDATE`;
    const version = await tx.marketingStrategy.findFirst({
      where: { id: input.strategyId, projectId: input.projectId },
    });
    if (!version) throw notFound("Marketing strategy version not found");
    if (version.approvedAt) return version;
    await tx.marketingStrategy.updateMany({
      where: { projectId: input.projectId, approvedAt: { not: null } },
      data: { approvedAt: null, approvedByUserId: null },
    });
    const now = new Date();
    const approved = await tx.marketingStrategy.update({
      where: { id: version.id },
      data: { approvedAt: now, approvedByUserId: input.userId },
    });
    // Two plans never publish side by side: a revert too cancels the
    // replaced version's posts that have not gone out.
    await tx.socialPost.updateMany({
      where: {
        projectId: input.projectId,
        status: { in: [...UNPUBLISHED_POST_STATUSES] },
        marketingStrategy: { id: { not: version.id } },
      },
      data: { status: "CANCELED", canceledAt: now, revision: { increment: 1 } },
    });
    const today = now.toISOString().slice(0, 10);
    await planMarketingStrategyPosts(tx, {
      version,
      workspaceId: input.workspaceId,
      entries: (parseMarketingPlan(version.plan)?.calendar ?? []).filter(
        (entry) =>
          entry.date >= today &&
          entry.status !== "published" &&
          entry.status !== "skipped",
      ),
      creator: version.authorSokoBotId
        ? { sokoBotId: version.authorSokoBotId }
        : { userId: input.userId },
    });
    return approved;
  });
}

/** A version's posts a newer approval cancels: planned, not gone out yet. */
const UNPUBLISHED_POST_STATUSES = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
] as const satisfies readonly SocialPostStatus[];

/** Only live social networks become Social posts; other channels stay in the plan. */
function socialPostProvider(channel: string): SocialPostProvider | null {
  const entry = (
    CMO_CHANNELS as Record<string, { group: string; status: string }>
  )[channel];
  return entry?.group === "social" &&
    entry.status === "live" &&
    channel in SOCIAL_POST_TEXT_LIMITS
    ? (channel as SocialPostProvider)
    : null;
}

export function parseSocialPostPlanning(
  value: unknown,
): CmoSocialPostPlanning | null {
  const parsed = cmoSocialPostPlanningSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function clipText(text: string, provider: string): string {
  return text
    .trim()
    .slice(0, SOCIAL_POST_TEXT_LIMITS[provider as SocialPostProvider] ?? 280);
}

/**
 * Until a piece is written its text is the entry's brief (or title); a post
 * whose text differs has its words.
 */
function placeholderText(
  entry: Pick<CmoCalendarEntry, "brief" | "title">,
  provider: string,
): string {
  return clipText(entry.brief ?? entry.title, provider);
}

/** The zone calendar times are in: the Project's bot rhythms', else UTC. */
async function planTimeZone(
  projectId: string,
  db: Prisma.TransactionClient,
): Promise<string> {
  const schedule = await db.sokoBotSchedule.findFirst({
    where: { sokoBot: { projectId }, systemKey: { not: null } },
    select: { timezone: true },
  });
  return schedule?.timezone ?? "UTC";
}

function plannedAt(entry: CmoCalendarEntry, timeZone: string): Date | null {
  return zonedDateTimeLocalToUtc(
    `${entry.date}T${entry.time ?? "09:00"}`,
    timeZone,
  );
}

const withoutUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;

/**
 * Writes calendar entries on live social networks as the version's Social
 * posts: a new entry (or one whose post was canceled) becomes a draft with
 * its planning record, the connection set when the Project has one for that
 * network; an entry with a post updates its plan, and its words and time
 * while it is a draft; a skipped one cancels it. Returns the entries on
 * other channels, which stay in the plan.
 */
export async function planMarketingStrategyPosts(
  db: Prisma.TransactionClient,
  input: {
    version: Pick<MarketingStrategy, "id" | "projectId">;
    workspaceId: string;
    entries: CmoCalendarEntry[];
    creator: { sokoBotId: string } | { userId: string };
  },
): Promise<CmoCalendarEntry[]> {
  const { version } = input;
  const rest = input.entries.filter(
    (entry) => !socialPostProvider(entry.channel),
  );
  if (rest.length === input.entries.length) return rest;
  const posts = await db.socialPost.findMany({
    where: { marketingStrategyId: version.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, planning: true },
  });
  const connections = await db.projectSocialConnection.findMany({
    where: { projectId: version.projectId, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true },
  });
  const timeZone = await planTimeZone(version.projectId, db);
  // An entry is found by its post's id or by the plan's entry id; the
  // newest post of an entry wins.
  const byEntry = new Map<string, (typeof posts)[number]>();
  for (const post of posts) {
    byEntry.set(post.id, post);
    const entryId = parseSocialPostPlanning(post.planning)?.id;
    if (entryId) byEntry.set(entryId, post);
  }
  const now = new Date();
  const drafts: Prisma.SocialPostCreateManyInput[] = [];
  for (const entry of input.entries) {
    const provider = socialPostProvider(entry.channel);
    if (!provider) continue;
    const post = byEntry.get(entry.id);
    const stored = parseSocialPostPlanning(post?.planning);
    const planning = {
      ...stored,
      ...withoutUndefined(cmoSocialPostPlanningSchema.parse(entry)),
      id: stored?.id ?? entry.id,
    };
    if (!post || post.status === "CANCELED") {
      if (entry.status === "skipped" || entry.status === "published") continue;
      drafts.push({
        projectId: version.projectId,
        workspaceId: input.workspaceId,
        marketingStrategyId: version.id,
        provider,
        socialConnectionId:
          connections.find((connection) => connection.provider === provider)
            ?.id ?? null,
        text: entry.draft
          ? clipText(entry.draft, provider)
          : placeholderText(entry, provider),
        status: "DRAFT",
        scheduledAt: plannedAt(entry, timeZone),
        timezone: timeZone,
        ...("sokoBotId" in input.creator
          ? { creatorSokoBotId: input.creator.sokoBotId }
          : { creatorUserId: input.creator.userId }),
        planning,
      });
      continue;
    }
    if (
      !(UNPUBLISHED_POST_STATUSES as readonly SocialPostStatus[]).includes(
        post.status,
      )
    )
      continue;
    // A scheduled post's words and time change through Social, which checks them.
    const draft = post.status !== "SCHEDULED";
    await db.socialPost.update({
      where: { id: post.id },
      data:
        entry.status === "skipped"
          ? { status: "CANCELED", canceledAt: now, revision: { increment: 1 } }
          : {
              planning,
              ...(draft
                ? {
                    scheduledAt: plannedAt(entry, timeZone),
                    ...(entry.draft
                      ? { text: clipText(entry.draft, provider) }
                      : {}),
                  }
                : {}),
              revision: { increment: 1 },
            },
    });
  }
  if (drafts.length > 0) await db.socialPost.createMany({ data: drafts });
  return rest;
}

/** A version's Social post, as a calendar entry and the media it carries. */
export interface MarketingStrategyPost {
  entry: CmoCalendarEntry;
  /** The plan's entry it was made from, if any. */
  entryId: string | null;
  media: SocialPostMediaRef[];
}

const CALENDAR_STATUS: Record<SocialPostStatus, CmoCalendarEntry["status"]> = {
  DRAFT: "draft",
  NEEDS_APPROVAL: "draft",
  FAILED: "draft",
  MISSED: "draft",
  SCHEDULED: "scheduled",
  PUBLISHING: "scheduled",
  PUBLISHED: "published",
  CANCELED: "skipped",
};

/** The Social posts a version's calendar became, oldest first. */
export async function listMarketingStrategyPosts(
  version: Pick<MarketingStrategy, "id" | "projectId">,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategyPost[]> {
  const posts = await db.socialPost.findMany({
    where: { marketingStrategyId: version.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      provider: true,
      text: true,
      media: true,
      status: true,
      scheduledAt: true,
      createdAt: true,
      planning: true,
    },
  });
  if (posts.length === 0) return [];
  const timeZone = await planTimeZone(version.projectId, db);
  return posts.map((post) => {
    const planning = parseSocialPostPlanning(post.planning);
    const at = post.scheduledAt ?? post.createdAt;
    const { hour, minute } = getLocalTimeParts(at, timeZone);
    const title = planning?.title ?? post.text.slice(0, 80);
    const written =
      post.text.trim() !== "" &&
      post.text !== placeholderText({ ...planning, title }, post.provider);
    const status = CALENDAR_STATUS[post.status];
    return {
      entry: {
        ...planning,
        id: post.id,
        socialPostId: post.id,
        channel: post.provider,
        title,
        format: planning?.format ?? "post",
        date: toLocalDateKey(at, timeZone),
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        status: status === "draft" && !written ? "idea" : status,
        ...(written ? { draft: post.text } : {}),
      },
      entryId: planning?.id ?? null,
      media: Array.isArray(post.media)
        ? (post.media as unknown as SocialPostMediaRef[])
        : [],
    };
  });
}

/**
 * The calendar as carried out: each entry that became a Social post reads
 * from it (under the post's id), and posts added since join the plan's
 * other entries.
 */
export function withSocialPostCalendar(
  plan: CmoStrategy,
  posts: MarketingStrategyPost[],
): CmoStrategy {
  if (posts.length === 0) return plan;
  const made = new Map<string, CmoCalendarEntry>();
  for (const post of posts) made.set(post.entryId ?? post.entry.id, post.entry);
  const planned = plan.calendar.map((entry) => {
    const post = made.get(entry.id);
    made.delete(entry.id);
    return post ?? entry;
  });
  return {
    ...plan,
    calendar: [...planned, ...made.values()].sort((left, right) =>
      left.date === right.date
        ? (left.time ?? "").localeCompare(right.time ?? "")
        : left.date.localeCompare(right.date),
    ),
  };
}

/**
 * A version's plan as its readers see it: once approved, its social
 * entries are the Project's Social posts.
 */
export async function readMarketingPlan(
  version: MarketingStrategy | null,
  db: Prisma.TransactionClient = prisma,
): Promise<CmoStrategy | null> {
  const plan = parseMarketingPlan(version?.plan);
  if (!plan || !version?.approvedAt) return plan;
  return withSocialPostCalendar(
    plan,
    await listMarketingStrategyPosts(version, db),
  );
}

/**
 * Answers one of a version's yes/no questions. Answers belong to their
 * version, so answering an older one never touches the current plan.
 */
export async function answerMarketingStrategyQuestion(input: {
  projectId: string;
  strategyId: string;
  questionId: string;
  answer: CmoBrandAnswer;
  note?: string;
}): Promise<MarketingStrategy> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM marketing_strategy WHERE id = ${input.strategyId}::uuid FOR UPDATE`;
    const version = await tx.marketingStrategy.findFirst({
      where: { id: input.strategyId, projectId: input.projectId },
    });
    const plan = parseMarketingPlan(version?.plan);
    if (!version || !plan) {
      throw notFound("Marketing strategy version not found");
    }
    if (!plan.questions.some((question) => question.id === input.questionId)) {
      throw notFound("That question is not in the plan");
    }
    const note =
      input.answer === "no" ? input.note?.trim() || undefined : undefined;
    return tx.marketingStrategy.update({
      where: { id: version.id },
      data: {
        plan: {
          ...plan,
          questions: plan.questions.map((question) =>
            question.id === input.questionId
              ? { ...question, answer: input.answer, note }
              : question,
          ),
        },
      },
    });
  });
}
