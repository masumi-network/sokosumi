import {
  type MarketingStrategy,
  type Prisma,
  type SocialPostStatus,
} from "@sokosumi/database";
import {
  type CmoBrandAnswer,
  type CmoCalendarEntry,
  type CmoSearchAd,
  cmoSearchAdSchema,
  type MarketingStrategyPlan,
  marketingStrategyPlanSchema,
  type SocialPostPlanning,
  socialPostPlanningSchema,
} from "@sokosumi/soko-bot";
import {
  CMO_CHANNELS,
  CMO_SHORT_VIDEO_FORMATS,
  cmoShortVideoFormat,
  isCmoShortVideoFormat,
  isCmoTalkingFormat,
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostMediaRef,
  type SocialPostProvider,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import {
  conflict,
  forbidden,
  internalServerError,
  notFound,
} from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import { jsonInput } from "@/helpers/prisma-json";
import { answerNote, changesAfterPlanAnswer } from "@/helpers/question-answers";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import { organizationRoleInWorkspace } from "@/helpers/soko-bot-management";
import {
  getLocalTimeParts,
  toLocalDateKey,
  zonedDateTimeLocalToUtc,
} from "@/helpers/task-schedule";
import prisma from "@/lib/db/prisma";
import { madeTestCopy } from "@/services/project-test-copy";
import {
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "@/services/soko-bot-turn-progress.service";

/**
 * A Project's Marketing strategy (ADR 0062): one row per version. A write
 * adds a version and never changes another; the Workspace's owners or
 * admins approve one, and only that one is carried out. Reverting approves
 * an older version again.
 */

export function parseMarketingPlan(
  value: unknown,
): MarketingStrategyPlan | null {
  const parsed = marketingStrategyPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * `clientTurnId` prefix of a bot turn writing a new strategy version: a
 * plan (`cmo:strategy:<bot>:<time>`), a patch (`…:patch:<time>`) or a Brand
 * Brain fix (`…:fix:<time>`).
 */
export const STRATEGY_TURN_PREFIX = "cmo:strategy:";

/** What a plan turn is for, from its id: a fix, a patch, or null for a (re)plan. */
export function cmoChangeKind(
  clientTurnId: string | null,
): "fix" | "patch" | null {
  if (!clientTurnId?.startsWith(STRATEGY_TURN_PREFIX)) return null;
  const kind = clientTurnId.split(":")[3];
  return kind === "fix" || kind === "patch" ? kind : null;
}

/** Every column but the plan: what a list of versions shows. */
export const MARKETING_STRATEGY_VERSION_SELECT = {
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
  authorSokoBotId: true,
  authorUserId: true,
  authorTurnId: true,
  approvedAt: true,
  approvedByUserId: true,
} as const satisfies Prisma.MarketingStrategySelect;

export type MarketingStrategyVersion = Prisma.MarketingStrategyGetPayload<{
  select: typeof MARKETING_STRATEGY_VERSION_SELECT;
}>;

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

/** A page of versions, newest first, and how many the Project has. */
export async function listMarketingStrategies(
  projectId: string,
  page: { cursor: string | undefined; take: number; skip: number | undefined },
): Promise<[MarketingStrategyVersion[], number]> {
  return Promise.all([
    prisma.marketingStrategy.findMany({
      where: { projectId },
      orderBy: [...NEWEST_FIRST],
      select: MARKETING_STRATEGY_VERSION_SELECT,
      take: page.take,
      ...(page.skip !== undefined ? { skip: page.skip } : {}),
      ...(page.cursor ? { cursor: { id: page.cursor } } : {}),
    }),
    prisma.marketingStrategy.count({ where: { projectId } }),
  ]);
}

/** A member's own version: unapproved until an owner or admin approves it. */
export function createMarketingStrategy(input: {
  projectId: string;
  userId: string;
  plan: MarketingStrategyPlan;
}): Promise<MarketingStrategy> {
  return prisma.marketingStrategy.create({
    data: {
      projectId: input.projectId,
      authorUserId: input.userId,
      plan: jsonInput(input.plan),
    },
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
 * admins, or a personal Workspace's owner. A CMO test copy commits nothing
 * (it never publishes or spends), so whoever made it approves its strategy
 * too (ADR 0073); pass `testCopyProjectId` where that applies.
 */
export async function mayApproveMarketingStrategy(
  userId: string,
  workspace: {
    id: string;
    userId: string | null;
    organizationId: string | null;
  },
  db: Prisma.TransactionClient = prisma,
  testCopyProjectId?: string,
): Promise<boolean> {
  if (!workspace.organizationId) return workspace.userId === userId;
  const role = await organizationRoleInWorkspace(userId, workspace.id, db);
  if (role !== null && isOrganizationOwnerOrAdmin(role)) return true;
  return (
    testCopyProjectId !== undefined &&
    (await madeTestCopy(userId, testCopyProjectId, db))
  );
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
  return (await settledTurnStatus(writing)) === "running";
}

interface VersionChange {
  projectId: string;
  workspaceId: string;
  userId: string;
  strategyId: string;
}

async function requireApprover(input: VersionChange): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: {
      workspace: { select: { id: true, userId: true, organizationId: true } },
    },
  });
  if (!project) throw notFound("Project not found");
  if (
    !(await mayApproveMarketingStrategy(
      input.userId,
      project.workspace,
      prisma,
      input.projectId,
    ))
  ) {
    throw forbidden(
      "Only the Workspace's owners and admins approve a Marketing strategy",
    );
  }
}

/**
 * Deletes a version nobody approved, as approving decides what runs: the
 * Workspace's owners and admins only. An approved version is never deleted.
 */
export async function discardMarketingStrategy(
  input: VersionChange,
): Promise<void> {
  await requireApprover(input);
  const { count } = await prisma.marketingStrategy.deleteMany({
    where: {
      id: input.strategyId,
      projectId: input.projectId,
      approvedAt: null,
    },
  });
  if (count === 0) {
    throw conflict("That version is approved or gone; nothing was discarded");
  }
}

/**
 * Approves one version and withdraws the approval of any other, so the
 * Project carries out exactly this one. Approving an older version reverts.
 */
export async function approveMarketingStrategy(
  input: VersionChange,
): Promise<MarketingStrategy> {
  await requireApprover(input);
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
    const replaced = await tx.marketingStrategy.findFirst({
      where: { projectId: input.projectId, approvedAt: { not: null } },
      select: { id: true, plan: true },
    });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const entries = (parseMarketingPlan(version.plan)?.calendar ?? []).filter(
      (entry) =>
        entry.date >= today &&
        entry.status !== "published" &&
        entry.status !== "skipped",
    );
    if (replaced) {
      await carryOverMadePieces(tx, {
        from: replaced,
        toId: version.id,
        entries,
      });
    }
    await tx.marketingStrategy.updateMany({
      where: { projectId: input.projectId, approvedAt: { not: null } },
      data: { approvedAt: null, approvedByUserId: null },
    });
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
      data: canceledPost(now),
    });
    await planMarketingStrategyPosts(tx, {
      version,
      workspaceId: input.workspaceId,
      entries,
      creator: version.authorSokoBotId
        ? { sokoBotId: version.authorSokoBotId }
        : { userId: input.userId },
    });
    return approved;
  });
}

/**
 * Hands what the replaced version already made to the version being approved,
 * entry by entry: its Social posts not gone out yet and its written files. A
 * changed strategy keeps the month's words, pictures and files; a piece it
 * adds, drops or gives another title is made or canceled.
 */
export async function carryOverMadePieces(
  tx: Prisma.TransactionClient,
  input: {
    from: Pick<MarketingStrategy, "id" | "plan">;
    toId: string;
    entries: Pick<CmoCalendarEntry, "id" | "title">[];
  },
): Promise<void> {
  if (input.from.id === input.toId || input.entries.length === 0) return;
  const titles = new Map(input.entries.map((entry) => [entry.id, entry.title]));
  const same = (entryId: string, title: string | undefined) => {
    const kept = titles.get(entryId);
    return kept !== undefined && title !== undefined && sameTitle(kept, title);
  };
  const posts = await tx.socialPost.findMany({
    where: {
      marketingStrategyId: input.from.id,
      status: { in: [...UNPUBLISHED_POST_STATUSES] },
    },
    select: { id: true, planning: true },
  });
  const moved = posts
    .filter((post) => {
      const planning = parseSocialPostPlanning(post.planning);
      // A talking video's post on another network moves with its entry.
      return same(
        planning?.videoOf ?? planning?.id ?? post.id,
        planning?.title,
      );
    })
    .map((post) => post.id);
  if (moved.length > 0) {
    await tx.socialPost.updateMany({
      where: { id: { in: moved } },
      data: { marketingStrategyId: input.toId, revision: { increment: 1 } },
    });
  }
  const before = new Map(
    (parseMarketingPlan(input.from.plan)?.calendar ?? []).map((entry) => [
      entry.id,
      entry.title,
    ]),
  );
  const files = (
    await tx.marketingStrategyFile.findMany({
      where: {
        marketingStrategyId: input.from.id,
        entryId: { in: [...titles.keys()] },
      },
      select: { entryId: true, fileResourceId: true, mediaFileIds: true },
    })
  ).filter((file) => same(file.entryId, before.get(file.entryId)));
  if (files.length > 0) {
    await tx.marketingStrategyFile.createMany({
      data: files.map((file) => ({ ...file, marketingStrategyId: input.toId })),
      skipDuplicates: true,
    });
  }
}

/** Two titles name the same piece when only case, spaces or marks differ. */
export function sameTitle(left: string, right: string): boolean {
  const squash = (text: string) => text.toLowerCase().replace(/\W+/g, "");
  return squash(left) === squash(right);
}

/** A version's posts a newer approval cancels: planned, not gone out yet. */
const UNPUBLISHED_POST_STATUSES = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
] as const satisfies readonly SocialPostStatus[];

/** What canceling a planned Social post writes. */
function canceledPost(now: Date) {
  return {
    status: "CANCELED",
    canceledAt: now,
    revision: { increment: 1 },
  } satisfies Prisma.SocialPostUpdateManyMutationInput;
}

/** Only live social networks become Social posts; other channels stay in the plan. */
export function socialPostProvider(channel: string): SocialPostProvider | null {
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
): SocialPostPlanning | null {
  const parsed = socialPostPlanningSchema.safeParse(value);
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

/** `planTimeZone` for many Projects at once; a Project without bot rhythms is left out (UTC). */
export async function planTimeZones(
  projectIds: string[],
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, string>> {
  const schedules = await db.sokoBotSchedule.findMany({
    where: {
      sokoBot: { projectId: { in: projectIds } },
      systemKey: { not: null },
    },
    select: { timezone: true, sokoBot: { select: { projectId: true } } },
  });
  const zones = new Map<string, string>();
  for (const { timezone, sokoBot } of schedules) {
    if (sokoBot.projectId && !zones.has(sokoBot.projectId)) {
      zones.set(sokoBot.projectId, timezone);
    }
  }
  return zones;
}

/** The zone calendar times are in: the Project's bot rhythms', else UTC. */
async function planTimeZone(
  projectId: string,
  db: Prisma.TransactionClient,
): Promise<string> {
  return (await planTimeZones([projectId], db)).get(projectId) ?? "UTC";
}

export function plannedAt(
  entry: CmoCalendarEntry,
  timeZone: string,
): Date | null {
  return zonedDateTimeLocalToUtc(
    `${entry.date}T${entry.time ?? "09:00"}`,
    timeZone,
  );
}

/**
 * The other networks a video also goes out on: for a talking video, live
 * social networks with a talking video format; for a short video (a TikTok,
 * a Reel, a YouTube Short), the other short-video networks (owner,
 * 2026-11-22: one file on TikTok, Reels and Shorts). Each once, never the
 * entry's own.
 */
export function cmoVideoNetworks(
  entry: Pick<CmoCalendarEntry, "channel" | "format" | "alsoOn">,
): SocialPostProvider[] {
  const talking = isCmoTalkingFormat(entry.channel, entry.format);
  if (!talking && !isCmoShortVideoFormat(entry.channel, entry.format))
    return [];
  const networks = (entry.alsoOn ?? []).flatMap((network) => {
    const provider = socialPostProvider(network);
    return provider &&
      provider !== entry.channel &&
      (talking
        ? isCmoTalkingFormat(provider, entry.format)
        : cmoShortVideoFormat(provider) !== null)
      ? [provider]
      : [];
  });
  return [...new Set(networks)];
}

/** The format a video's post on another network takes there. */
function copyFormat(
  entry: { channel: string; format: string },
  network: string,
) {
  return isCmoShortVideoFormat(entry.channel, entry.format)
    ? (cmoShortVideoFormat(network) ?? entry.format)
    : entry.format;
}

/** Why an entry's `alsoOn` cannot be carried out, or null. */
export function cmoAlsoOnProblem(
  entry: Pick<CmoCalendarEntry, "id" | "channel" | "format" | "alsoOn">,
): string | null {
  if (!entry.alsoOn?.length) return null;
  const talking = isCmoTalkingFormat(entry.channel, entry.format);
  if (!talking && !isCmoShortVideoFormat(entry.channel, entry.format))
    return `${entry.id} lists alsoOn, which only a video takes: a talking_video, or a short video (a TikTok, a Reel, a YouTube Short) shown on the other short-video networks. Remove alsoOn or make it one.`;
  const allowed = cmoVideoNetworks(entry) as string[];
  const refused = entry.alsoOn.filter((network) => !allowed.includes(network));
  const offered = talking
    ? Object.keys(CMO_CHANNELS).filter(
        (key) =>
          key !== entry.channel &&
          socialPostProvider(key) &&
          isCmoTalkingFormat(key, entry.format),
      )
    : Object.keys(CMO_SHORT_VIDEO_FORMATS).filter(
        (key) => key !== entry.channel,
      );
  return refused.length > 0
    ? `${entry.id} cannot also go out on ${refused.join(", ")}: alsoOn takes ${offered.join(", ")}, never its own channel.`
    : null;
}

/** The planning id of a talking video's post on another network. */
function videoCopyId(entryId: string, network: string): string {
  return `${entryId.slice(0, 63 - network.length)}@${network}`;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

/**
 * Writes calendar entries on live social networks as the version's Social
 * posts: a new entry (or one whose post was canceled) becomes a draft with
 * its planning record, the connection set when the Project has one for that
 * network; an entry with a post updates its plan, and its words and time
 * while it is a draft; a skipped one cancels it. Entries on other channels
 * are not produced. A talking video with `alsoOn` gets one more post per
 * network listed, planned as its entry with `videoOf`; a network taken off
 * the list cancels its post.
 */
export async function planMarketingStrategyPosts(
  db: Prisma.TransactionClient,
  input: {
    version: Pick<MarketingStrategy, "id" | "projectId">;
    workspaceId: string;
    entries: CmoCalendarEntry[];
    creator: { sokoBotId: string } | { userId: string };
  },
): Promise<void> {
  const { version } = input;
  if (!input.entries.some((entry) => socialPostProvider(entry.channel))) {
    return;
  }
  const posts = await db.socialPost.findMany({
    where: { marketingStrategyId: version.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      provider: true,
      planning: true,
      media: true,
    },
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
  const unpublished = (status: SocialPostStatus) =>
    (UNPUBLISHED_POST_STATUSES as readonly SocialPostStatus[]).includes(status);
  const entries = [...input.entries];
  // The posts Core plans here for a talking video's other networks.
  const copies = new Set<CmoCalendarEntry>();
  for (const entry of entries) {
    const provider = socialPostProvider(entry.channel);
    if (!provider) continue;
    const post = byEntry.get(entry.id);
    const stored = parseSocialPostPlanning(post?.planning);
    const planning = {
      ...withoutUndefined({
        ...stored,
        ...withoutUndefined(socialPostPlanningSchema.parse(entry)),
        // What a copy speaks is its entry's: a save of the copy changes its
        // own caption and plan only.
        ...(stored?.videoOf && !copies.has(entry)
          ? {
              // A short video's copy is the same file: its picture plan too.
              visual: stored.visual,
              visualFileIds: stored.visualFileIds,
              script: stored.script,
              presenter: stored.presenter,
              voice: stored.voice,
              shortFormat: stored.shortFormat,
              hookLine: stored.hookLine,
              languageCode: stored.languageCode,
              alsoOn: undefined,
              videoOf: stored.videoOf,
            }
          : {}),
      }),
      id: stored?.id ?? entry.id,
    };
    if (!planning.videoOf) {
      const networks = cmoVideoNetworks({
        channel: provider,
        format: planning.format ?? entry.format,
        alsoOn: planning.alsoOn,
      });
      for (const network of networks) {
        const copy = {
          ...entry,
          ...planning,
          id: videoCopyId(planning.id, network),
          channel: network,
          format: copyFormat(
            { channel: provider, format: planning.format ?? entry.format },
            network,
          ),
          alsoOn: undefined,
          videoOf: planning.id,
          draft: undefined,
          socialPostId: undefined,
        };
        copies.add(copy);
        entries.push(copy);
      }
      for (const copy of posts) {
        if (
          parseSocialPostPlanning(copy.planning)?.videoOf === planning.id &&
          !(networks as string[]).includes(copy.provider) &&
          unpublished(copy.status)
        )
          await db.socialPost.update({
            where: { id: copy.id },
            data: canceledPost(now),
          });
      }
    }
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
    if (!unpublished(post.status)) continue;
    // A talking video made for other words is taken off, so Core makes the
    // new one: a carried-over post kept a video of an older script.
    const remake =
      spokenChanged(stored, planning) &&
      parseSocialPostMedia(post.media, post.id).length > 0;
    // A scheduled post's words and time change through Social, which checks them.
    const draft = post.status !== "SCHEDULED" || remake;
    await db.socialPost.update({
      where: { id: post.id },
      data:
        entry.status === "skipped"
          ? canceledPost(now)
          : {
              planning,
              ...(remake
                ? {
                    media: [],
                    status: "DRAFT" as const,
                    scheduledByUserId: null,
                    scheduledByCoworkerId: null,
                  }
                : {}),
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
}

/** Whether a talking video's post now speaks other words, or with another presenter or voice. */
export function spokenChanged(
  before: SocialPostPlanning | null | undefined,
  after: Pick<SocialPostPlanning, "script" | "presenter" | "voice">,
): boolean {
  if (!before?.script?.trim()) return false;
  return (
    before.script.trim() !== after.script?.trim() ||
    (before.presenter ?? "").toLowerCase() !==
      (after.presenter ?? "").toLowerCase() ||
    (before.voice ?? "").toLowerCase() !== (after.voice ?? "").toLowerCase()
  );
}

/** A version's Social post, as a calendar entry and the media it carries. */
export interface MarketingStrategyPost {
  entry: CmoCalendarEntry;
  /** The plan's entry it was made from, if any. */
  entryId: string | null;
  media: SocialPostMediaRef[];
  /** The post's revision, which an edit of its words names. */
  revision: number;
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

const RECONNECT_ERROR = /reconnect|revoked|authoriz/i;
/**
 * A network pausing our app's posting: our words from Core's publisher, or the
 * network's own cap error on posts from before. Never the owner's to fix.
 */
const PAUSED_ERROR =
  /paused our posting|spend.?cap|usage.?cap|UsageCapExceeded/i;

/**
 * Why a post did not go out, as the owner reads it on the Calendar and
 * Today; null for a post that has not failed or missed its time. A post the
 * network's pause moved on stays scheduled and says it waits.
 */
export function socialPostNotSent(post: {
  status: SocialPostStatus;
  provider: string;
  lastError: string | null;
}): string | null {
  const provider = post.provider.toLowerCase() as SocialPostProvider;
  const network = socialPostProviderLabel(provider) ?? post.provider;
  const error = post.lastError ?? "";
  if (post.status === "SCHEDULED" && PAUSED_ERROR.test(error)) {
    return `${network} paused our posting for now; Cuso will try again.`;
  }
  if (post.status === "MISSED") return "It missed its time.";
  if (post.status !== "FAILED") return null;
  if (PAUSED_ERROR.test(error)) {
    return `${network} paused our posting for a day. Ask Cuso to post it again.`;
  }
  if (RECONNECT_ERROR.test(error)) {
    return `${network} needs reconnecting in Channels.`;
  }
  // Networks answer with JSON; its "detail" is the one human sentence.
  const detail = /"detail"\s*:\s*"([^"]{1,200})"/.exec(error)?.[1]?.trim();
  return detail
    ? `${network} refused it: ${detail.replace(/\.?$/, ".")}`
    : `${network} refused it.`;
}

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
      lastError: true,
      revision: true,
      scheduledAt: true,
      createdAt: true,
      planning: true,
    },
  });
  if (posts.length === 0) return [];
  const timeZone = await planTimeZone(version.projectId, db);
  // Entries read under their post's id, so a talking video's copies name
  // its post too: by its plan id they never found it and were never made.
  const postIds = new Map(
    posts.flatMap((post) => {
      const id = parseSocialPostPlanning(post.planning)?.id;
      return id ? [[id, post.id] as const] : [];
    }),
  );
  return posts.map((post) => {
    const planning = parseSocialPostPlanning(post.planning);
    const videoOf = planning?.videoOf
      ? (postIds.get(planning.videoOf) ?? planning.videoOf)
      : undefined;
    const at = post.scheduledAt ?? post.createdAt;
    const { hour, minute } = getLocalTimeParts(at, timeZone);
    const title = planning?.title ?? post.text.slice(0, 80);
    const written =
      post.text.trim() !== "" &&
      post.text !== placeholderText({ ...planning, title }, post.provider);
    const status = CALENDAR_STATUS[post.status];
    const notSent = socialPostNotSent(post);
    return {
      entry: {
        ...planning,
        id: post.id,
        socialPostId: post.id,
        ...(videoOf ? { videoOf } : {}),
        channel: post.provider,
        title,
        format: planning?.format ?? "post",
        date: toLocalDateKey(at, timeZone),
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        status: status === "draft" && !written ? "idea" : status,
        ...(written ? { draft: post.text } : {}),
        ...(notSent ? { notSent } : {}),
      },
      entryId: planning?.id ?? null,
      media: parseSocialPostMedia(post.media, post.id),
      revision: post.revision,
    };
  });
}

/**
 * The calendar as carried out: each entry that became a Social post reads
 * from it (under the post's id), and posts added since join the plan's
 * other entries.
 */
export function withSocialPostCalendar(
  plan: MarketingStrategyPlan,
  posts: MarketingStrategyPost[],
): MarketingStrategyPlan {
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

/** Whether a calendar entry is written as a Project file. */
export function isMarketingFilePiece(
  entry: Pick<CmoCalendarEntry, "channel">,
): boolean {
  return socialPostProvider(entry.channel) === null;
}

/** The pictures an entry names, the cover first, each once. */
export function entryMedia(
  entry: Pick<CmoCalendarEntry, "imageFileId" | "slideFileIds">,
): string[] {
  return [
    ...new Set([
      ...(entry.imageFileId ? [entry.imageFileId] : []),
      ...(entry.slideFileIds ?? []),
    ]),
  ];
}

/** A written piece that is not a Social post: its file and its pictures. */
export interface MarketingStrategyFilePiece {
  fileId: string;
  /** Picture file ids, the cover first. */
  media: string[];
  /** A Google search ad's parts, when the piece is one. */
  searchAd: CmoSearchAd | null;
  /** The Google Ads campaign the owner launched from it. */
  adCampaign: { accountId: string; campaignId: string } | null;
}

/** The version's written pieces that are Project files, by calendar entry id. */
export async function listMarketingStrategyFiles(
  version: Pick<MarketingStrategy, "id">,
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, MarketingStrategyFilePiece>> {
  const links = await db.marketingStrategyFile.findMany({
    where: {
      marketingStrategyId: version.id,
      fileResource: { lifecycle: "ACTIVE" },
    },
    select: {
      entryId: true,
      fileResourceId: true,
      mediaFileIds: true,
      searchAd: true,
      adAccountId: true,
      adCampaignId: true,
    },
  });
  return new Map(
    links.map((link) => {
      const searchAd = cmoSearchAdSchema.safeParse(link.searchAd);
      return [
        link.entryId,
        {
          fileId: link.fileResourceId,
          media: link.mediaFileIds,
          searchAd: searchAd.success ? searchAd.data : null,
          adCampaign:
            link.adAccountId && link.adCampaignId
              ? { accountId: link.adAccountId, campaignId: link.adCampaignId }
              : null,
        },
      ];
    }),
  );
}

/** The plan with each written piece's file and pictures: drafts that live in Files. */
export function withMarketingFiles(
  plan: MarketingStrategyPlan,
  files: ReadonlyMap<string, MarketingStrategyFilePiece>,
): MarketingStrategyPlan {
  if (files.size === 0) return plan;
  return {
    ...plan,
    calendar: plan.calendar.map((entry) => {
      const piece = files.get(entry.id);
      if (!piece || !isMarketingFilePiece(entry)) return entry;
      const [cover] = piece.media;
      return {
        ...entry,
        fileId: piece.fileId,
        ...(cover ? { imageFileId: cover } : {}),
        ...(piece.media.length > 1 ? { slideFileIds: piece.media } : {}),
        ...(piece.searchAd ? { searchAd: piece.searchAd } : {}),
        ...(piece.adCampaign ? { adCampaign: piece.adCampaign } : {}),
        status: entry.status === "idea" ? "draft" : entry.status,
      };
    }),
  };
}

/**
 * A version's plan as its readers see it: once approved, its social
 * entries are the Project's Social posts and its other written pieces the
 * Project's Files.
 */
export async function readMarketingPlan(
  version: MarketingStrategy | null,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategyPlan | null> {
  const plan = parseMarketingPlan(version?.plan);
  if (!plan || !version?.approvedAt) return plan;
  return withMarketingFiles(
    withSocialPostCalendar(plan, await listMarketingStrategyPosts(version, db)),
    await listMarketingStrategyFiles(version, db),
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
    if (!version) throw notFound("Marketing strategy version not found");
    const plan = parseMarketingPlan(version.plan);
    if (!plan) {
      throw internalServerError("Marketing strategy version has no valid plan");
    }
    const previous = plan.questions.find(
      (question) => question.id === input.questionId,
    );
    if (!previous) {
      throw notFound("That question is not in the strategy");
    }
    const note = answerNote(input.answer, input.note);
    return tx.marketingStrategy.update({
      where: { id: version.id },
      data: {
        plan: jsonInput({
          ...plan,
          changes: changesAfterPlanAnswer({
            changes: plan.changes,
            previous,
            answer: input.answer,
            note,
          }),
          questions: plan.questions.map((question) => {
            if (question.id !== input.questionId) return question;
            const { note: _previousNote, ...fields } = question;
            return {
              ...fields,
              answer: input.answer,
              ...(note !== undefined ? { note } : {}),
            };
          }),
        }),
      },
    });
  });
}
