import { randomBytes } from "node:crypto";
import type { CmoWorkspace, Prisma } from "@sokosumi/database";
import {
  CMO_SOKO_BOT_VERSION_ID,
  type CmoBrandBrain,
  type CmoReportUpdateInput,
  type CmoStrategy,
  type CmoSystemSchedule,
  cmoBrandBrainSchema,
  cmoMayExecute,
  cmoReportUpdateInputSchema,
  cmoRoutineSkipReason,
  cmoStrategySchema,
  getSokoBotVersion,
  SOKO_BOT_CMO_SCHEDULES,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import type { PresetRoute } from "@/lib/soko-bot/classifier";

/**
 * CMO.xyz (Cuso) on Soko Bots. Each business gets its own organization
 * workspace, so Cuso is an ordinary Soko Bot there (one bot per person and
 * workspace) and every existing seam — turns, schedules, chat, Social,
 * Content Studio, Tasks — works unchanged. This module adds what CMO needs on
 * top: onboarding, the Brand Brain and strategy records, the subscription
 * gate, and the packets Cuso's rhythms read.
 */

export class CmoNotFoundError extends Error {}
export class CmoConflictError extends Error {}

const CUSO_NAME = "Cuso";

/** Onboarding and strategy turns: owner asked, full work route. */
const CMO_ONBOARDING_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  sandbox: true,
  reason: "CMO onboarding: learn the business and build the Brand Brain.",
};
/**
 * No sandbox on the strategy turn: a turn that has read the open web may not
 * create posts or images, and this one drafts the first week of content from
 * the Brand Brain it already has.
 */
const CMO_STRATEGY_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO strategy: plan the month and draft the first week.",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** "https://www.acme.io/about" → "acme.io"; falls back to the raw input. */
export function cmoBusinessNameFromUrl(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return websiteUrl.trim();
  }
}

export function parseCmoBrandBrain(value: unknown): CmoBrandBrain | null {
  const parsed = cmoBrandBrainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCmoStrategy(value: unknown): CmoStrategy | null {
  const parsed = cmoStrategySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getCmoWorkspaceForUser(
  userId: string,
): Promise<CmoWorkspace | null> {
  return prisma.cmoWorkspace.findUnique({ where: { userId } });
}

export async function getCmoWorkspaceForBot(
  sokoBotId: string,
): Promise<CmoWorkspace | null> {
  return prisma.cmoWorkspace.findUnique({ where: { sokoBotId } });
}

/** The org's active plan that lets Cuso execute, or null. */
export async function activeCmoPlan(
  organizationId: string,
): Promise<string | null> {
  const plans = getEnv().CMO_SUBSCRIPTION_PLANS;
  const subscription = await prisma.subscription.findFirst({
    where: {
      referenceId: organizationId,
      plan: { in: plans },
      status: { in: ["active", "trialing"] },
    },
    select: { plan: true },
  });
  return subscription?.plan ?? null;
}

/** Execution (scheduling, publishing) needs a paid plan on the org. */
export async function hasActiveCmoSubscription(
  organizationId: string,
): Promise<boolean> {
  return (await activeCmoPlan(organizationId)) !== null;
}

async function startCmoTurn(
  workspace: Pick<CmoWorkspace, "userId" | "workspaceId">,
  input: { clientTurnId: string; message: string; route: PresetRoute },
): Promise<{ turnId: string }> {
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: workspace.userId,
    workspaceId: workspace.workspaceId,
    clientTurnId: input.clientTurnId,
    message: input.message,
    // The owner pressed the button, but no chat message carries the turn:
    // EVENT delivers the answer to the owner's chat with Cuso.
    source: "EVENT",
    presetRoute: input.route,
  });
  return { turnId: started.turnId };
}

function onboardingMessage(input: {
  businessName: string;
  websiteUrl: string;
  goals: string;
}): string {
  const month = new Date().toISOString().slice(0, 7);
  return [
    `New CMO client: ${input.businessName} (${input.websiteUrl}).`,
    `Their main marketing goal, in their words: ${input.goals}`,
    "",
    "1) Learn the business: read the website (home, about, products, pricing), search for the company, its competitors and its existing marketing, then save the Brand Brain with save_brand_brain. Write down only what you found.",
    `2) If you confirmed what they sell, to whom, and the offer: plan the next month (start ${month}) with save_strategy (summary, goals, audience, positioning, pillars, each channel with cadence, a calendar for the whole month, and previews: one short post, ad, SEO piece and newsletter in the brand's voice), then tell the owner in two or three lines what you learned and that they approve the plan once in the strategy card.`,
    "3) If you could not confirm all three, do not plan yet: tell the owner in one line what you found, and ask two or three short questions to fill the gaps.",
    "The Brand Brain and strategy cards are your report here: do not call report_update, and never mention tool limits or what you may not do this turn.",
  ].join("\n");
}

const ONBOARDING_TURN_PREFIX = "cmo:onboarding:";
/**
 * Learning that shows no progress for this long is stuck: a healthy turn
 * writes an event every few seconds and ends within the runtime's budget.
 */
const LEARNING_STALL_MS = 5 * 60 * 1_000;

/** Where Cuso's first look at the business stands, for the learning card. */
export type CmoLearningState = "running" | "failed" | "done";

async function lastTurnProgressAt(turn: {
  eveSessionId: string | null;
  createdAt: Date;
}): Promise<Date> {
  if (!turn.eveSessionId) return turn.createdAt;
  const latest = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { sessionId: turn.eveSessionId },
    orderBy: { startIndex: "desc" },
    select: { occurredAt: true },
  });
  return latest?.occurredAt ?? turn.createdAt;
}

/**
 * Reads the newest onboarding turn. A stuck one (its run died, e.g. with
 * the process that ran it) is settled as failed here, as a deadline would,
 * so the founder sees "Try again" instead of a spinner and the bot is free
 * for new turns.
 */
export async function cmoLearningState(
  workspace: Pick<CmoWorkspace, "userId" | "sokoBotId" | "brandBrain">,
  now: Date = new Date(),
): Promise<CmoLearningState> {
  if (workspace.brandBrain) return "done";
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: workspace.sokoBotId,
      clientTurnId: { startsWith: ONBOARDING_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, eveSessionId: true, createdAt: true },
  });
  if (!turn) return "failed";
  // Cuso can finish without a Brand Brain on purpose: it asked questions.
  if (turn.status === "COMPLETED") return "done";
  if (turn.status === "FAILED" || turn.status === "CANCELLED") return "failed";
  const progressAt = await lastTurnProgressAt(turn);
  if (now.getTime() - progressAt.getTime() < LEARNING_STALL_MS) {
    return "running";
  }
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  await sokoBotControlPlane.expireTurn(turn.id).catch(() => undefined);
  return "failed";
}

/** Starts learning again after a failed or stuck first look. */
export async function retryCmoOnboarding(
  userId: string,
): Promise<{ turnId: string }> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace yet");
  const state = await cmoLearningState(workspace);
  if (state !== "failed") {
    throw new CmoConflictError(
      state === "running"
        ? "Cuso is still learning the business"
        : "Cuso already learned the business",
    );
  }
  return startCmoTurn(workspace, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${workspace.id}:${Date.now()}`,
    message: onboardingMessage(workspace),
    route: CMO_ONBOARDING_ROUTE,
  });
}

/**
 * Creates the business's organization, its marketing Project and Cuso, then
 * starts Cuso's first turn. One CMO workspace per person; a second call
 * returns the existing one.
 */
export async function startCmoOnboarding(input: {
  userId: string;
  websiteUrl: string;
  goals: string;
  businessName?: string;
}): Promise<CmoWorkspace> {
  const existing = await getCmoWorkspaceForUser(input.userId);
  if (existing) return existing;

  const businessName =
    input.businessName?.trim() || cmoBusinessNameFromUrl(input.websiteUrl);
  const { auth } = await import("@/lib/auth");
  const organization = await auth.api.createOrganization({
    body: {
      name: businessName,
      slug: `${slugify(businessName) || "cmo"}-${randomBytes(3).toString("hex")}`,
      userId: input.userId,
      keepCurrentActiveOrganization: true,
    },
  });
  if (!organization) throw new CmoConflictError("Organization not created");
  const workspace = await prisma.workspace.findFirst({
    where: { organizationId: organization.id },
    select: { id: true },
  });
  if (!workspace) throw new CmoConflictError("Organization has no workspace");

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: "Marketing",
      websiteUrl: input.websiteUrl,
    },
    select: { id: true },
  });

  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const bot = await sokoBotControlPlane.create({
    userId: input.userId,
    workspaceId: workspace.id,
    name: CUSO_NAME,
    versionId: CMO_SOKO_BOT_VERSION_ID,
  });

  const created = await prisma.cmoWorkspace.create({
    data: {
      userId: input.userId,
      organizationId: organization.id,
      workspaceId: workspace.id,
      sokoBotId: bot.id,
      projectId: project.id,
      businessName,
      websiteUrl: input.websiteUrl,
      goals: input.goals,
    },
  });

  await startCmoTurn(created, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${created.id}`,
    message: onboardingMessage({
      businessName,
      websiteUrl: input.websiteUrl,
      goals: input.goals,
    }),
    route: CMO_ONBOARDING_ROUTE,
  });
  return created;
}

/** Asks Cuso for a new one-month strategy; the owner approves it again. */
export async function requestCmoStrategy(input: {
  userId: string;
  note?: string;
}): Promise<{ turnId: string }> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  if (!parseCmoBrandBrain(workspace.brandBrain)) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { strategyApprovedAt: null },
  });
  const month = new Date().toISOString().slice(0, 7);
  return startCmoTurn(workspace, {
    clientTurnId: `cmo:strategy:${workspace.id}:${Date.now()}`,
    message: [
      `Plan the marketing for the next month (start ${month}) for ${workspace.businessName}.`,
      `Goals: ${workspace.goals}`,
      input.note ? `The owner adds: ${input.note}` : "",
      "",
      "Use the Brand Brain in your packet. Save the strategy with save_strategy: summary, goals, audience, positioning, pillars, each channel with cadence, a calendar for the whole month, and previews (one short post, ad, SEO piece and newsletter in the brand's voice). Draft the first week's posts as Social post drafts in the Marketing project (no scheduledAt). Then tell the owner the plan in two or three lines: they approve it once in the strategy card, and after that you run it.",
    ]
      .filter(Boolean)
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
}

export async function saveCmoBrandBrain(
  where: { userId: string } | { sokoBotId: string },
  brandBrain: CmoBrandBrain,
): Promise<CmoWorkspace> {
  const parsed = cmoBrandBrainSchema.parse(brandBrain);
  const current = await prisma.cmoWorkspace.findUnique({
    where,
    select: { id: true },
  });
  if (!current) throw new CmoNotFoundError("No CMO workspace");
  return prisma.cmoWorkspace.update({
    where: { id: current.id },
    data: {
      brandBrain: parsed as Prisma.InputJsonValue,
      brandBrainUpdatedAt: new Date(),
    },
  });
}

const STRATEGY_HISTORY_LIMIT = 8;

const strategyHistorySchema = z.array(
  z.object({
    savedAt: z.string(),
    turnId: z.string().nullable(),
    strategy: z.unknown(),
  }),
);
type StrategyHistory = z.infer<typeof strategyHistorySchema>;

function parseHistory(value: unknown): StrategyHistory {
  const parsed = strategyHistorySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Saves the strategy. The strategy it replaces goes into a short history so
 * a weekly change can be reverted. The owner's approval carries over: after
 * approving once, the owner expects Cuso to keep the plan current.
 */
export async function saveCmoStrategy(
  where: { userId: string } | { sokoBotId: string },
  strategy: CmoStrategy,
  options: { turnId?: string } = {},
): Promise<CmoWorkspace> {
  const parsed = cmoStrategySchema.parse(strategy);
  const current = await prisma.cmoWorkspace.findUnique({ where });
  if (!current) throw new CmoNotFoundError("No CMO workspace");
  const history = current.strategy
    ? [
        {
          savedAt: (current.strategyUpdatedAt ?? new Date()).toISOString(),
          turnId: options.turnId ?? null,
          strategy: current.strategy,
        },
        ...parseHistory(current.strategyHistory),
      ].slice(0, STRATEGY_HISTORY_LIMIT)
    : parseHistory(current.strategyHistory);
  return prisma.cmoWorkspace.update({
    where: { id: current.id },
    data: {
      strategy: parsed as Prisma.InputJsonValue,
      strategyUpdatedAt: new Date(),
      strategyHistory: history as Prisma.InputJsonValue,
    },
  });
}

/** The owner's one approval: from now on Cuso executes the strategy. */
export async function approveCmoStrategy(
  userId: string,
): Promise<CmoWorkspace> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  if (!parseCmoStrategy(workspace.strategy)) {
    throw new CmoConflictError("There is no strategy to approve yet");
  }
  return prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { strategyApprovedAt: workspace.strategyApprovedAt ?? new Date() },
  });
}

const cmoUpdateRecordSchema = cmoReportUpdateInputSchema.extend({
  id: z.string(),
  at: z.string(),
  /** Weekly and monthly: the strategy before this turn's changes, for revert. */
  previousStrategy: z.unknown().optional(),
  revertedAt: z.string().optional(),
});
export type CmoUpdateRecord = z.infer<typeof cmoUpdateRecordSchema>;

const UPDATES_LIMIT = 60;

export function parseCmoUpdates(value: unknown): CmoUpdateRecord[] {
  const parsed = z.array(cmoUpdateRecordSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Stores Cuso's report as a chat card. A weekly report keeps the strategy as
 * it was before the first save of the same turn, so the owner can revert the
 * whole review in one step.
 */
export async function reportCmoUpdate(input: {
  sokoBotId: string;
  turnId: string;
  update: CmoReportUpdateInput;
}): Promise<CmoUpdateRecord> {
  const workspace = await getCmoWorkspaceForBot(input.sokoBotId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  const update = cmoReportUpdateInputSchema.parse(input.update);
  const savedThisTurn = parseHistory(workspace.strategyHistory).filter(
    (entry) => entry.turnId === input.turnId,
  );
  const record: CmoUpdateRecord = {
    ...update,
    id: randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
    ...((update.kind === "weekly" || update.kind === "monthly") &&
    savedThisTurn.length > 0
      ? { previousStrategy: savedThisTurn[savedThisTurn.length - 1]?.strategy }
      : {}),
  };
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: {
      updates: [record, ...parseCmoUpdates(workspace.updates)].slice(
        0,
        UPDATES_LIMIT,
      ) as Prisma.InputJsonValue,
    },
  });
  return record;
}

/** Puts back the strategy a weekly review or monthly strategy replaced. */
export async function revertCmoUpdate(input: {
  userId: string;
  updateId: string;
}): Promise<CmoWorkspace> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  const updates = parseCmoUpdates(workspace.updates);
  const target = updates.find((update) => update.id === input.updateId);
  const previous = parseCmoStrategy(target?.previousStrategy);
  if (!target || !previous) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (target.revertedAt) return workspace;
  await saveCmoStrategy({ userId: input.userId }, previous);
  return prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: {
      updates: updates.map((update) =>
        update.id === target.id
          ? { ...update, revertedAt: new Date().toISOString() }
          : update,
      ) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Whether a CMO bot may schedule or publish. Null for bots that are not CMO
 * bots (no CMO rules apply) and when allowed: the owner approved the
 * strategy and the CMO subscription is active.
 */
export async function cmoExecutionRefusal(input: {
  sokoBotId: string;
  versionId: string | null;
}): Promise<string | null> {
  if (getSokoBotVersion(input.versionId).profile !== "cmo") return null;
  const workspace = await getCmoWorkspaceForBot(input.sokoBotId);
  if (!workspace) return null;
  const verdict = cmoMayExecute({
    approved: workspace.strategyApprovedAt !== null,
    subscribed: await hasActiveCmoSubscription(workspace.organizationId),
  });
  return verdict.ok ? null : verdict.reason;
}

/** The business's connected social accounts, from Project Social. */
export async function listCmoChannels(projectId: string) {
  return prisma.projectSocialConnection.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      externalHandle: true,
      displayName: true,
      status: true,
    },
  });
}

function calendarWindow(
  strategy: CmoStrategy,
  now: Date,
  days: number,
): CmoStrategy["calendar"] {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return strategy.calendar.filter(
    (entry) => entry.date >= from && entry.date <= to,
  );
}

/**
 * What Cuso sees about the business on every turn: the Brand Brain, the
 * strategy with the next two weeks of the calendar, and whether it may
 * execute. Null for any bot that is not a CMO bot.
 */
export async function loadCmoMarketingContext(
  sokoBotId: string,
  now: Date = new Date(),
): Promise<Record<string, unknown> | null> {
  const workspace = await getCmoWorkspaceForBot(sokoBotId);
  if (!workspace) return null;
  const strategy = parseCmoStrategy(workspace.strategy);
  return {
    business: {
      name: workspace.businessName,
      websiteUrl: workspace.websiteUrl,
      goals: workspace.goals,
      marketingProjectId: workspace.projectId,
    },
    strategyApproved: workspace.strategyApprovedAt !== null,
    subscriptionActive: await hasActiveCmoSubscription(
      workspace.organizationId,
    ),
    connectedChannels: (await listCmoChannels(workspace.projectId)).map(
      (channel) => ({
        provider: channel.provider,
        handle: channel.externalHandle,
        status: channel.status,
        socialConnectionId: channel.id,
      }),
    ),
    brandBrain: parseCmoBrandBrain(workspace.brandBrain),
    strategy: strategy
      ? {
          ...strategy,
          calendar: calendarWindow(strategy, now, 14),
          calendarTotal: strategy.calendar.length,
        }
      : null,
    recentUpdates: parseCmoUpdates(workspace.updates)
      .slice(0, 3)
      .map(({ previousStrategy: _previous, ...update }) => update),
  };
}

/** The packet appended to a CMO rhythm's prompt. */
export async function buildCmoBeatPacket(
  sokoBotId: string,
  now: Date,
  key: CmoSystemSchedule["key"],
): Promise<{ packet: string; skip: boolean }> {
  const workspace = await getCmoWorkspaceForBot(sokoBotId);
  if (!workspace) return { packet: "", skip: true };
  // Nothing runs without a reason: no approved strategy, no Brand Brain,
  // or not the reminder's one slot. A skipped run costs no turn.
  const skipReason = cmoRoutineSkipReason(key, {
    brandBrain: workspace.brandBrain !== null,
    strategySavedAt: workspace.strategy ? workspace.strategyUpdatedAt : null,
    strategyApproved: workspace.strategyApprovedAt !== null,
    now,
  });
  if (skipReason) return { packet: "", skip: true };
  const context = await loadCmoMarketingContext(sokoBotId, now);
  if (!context) return { packet: "", skip: true };
  const posts = workspace
    ? await prisma.socialPost.findMany({
        where: {
          projectId: workspace.projectId,
          updatedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          provider: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
          publishedUrl: true,
          text: true,
        },
      })
    : [];
  const lines = [
    `## Execution: ${
      !context.strategyApproved
        ? "waiting for the owner to approve the strategy (draft only)"
        : context.subscriptionActive
          ? "active"
          : "paused: no CMO subscription (draft only)"
    }`,
    `## Connected channels: ${JSON.stringify(context.connectedChannels)}`,
    "",
    "## Brand Brain",
    JSON.stringify(context.brandBrain ?? "not built yet"),
    "",
    "## Strategy (calendar: next 14 days)",
    JSON.stringify(context.strategy ?? "no strategy yet"),
    "",
    "## Social posts, last 14 days",
    ...(posts.length
      ? posts.map(
          (post) =>
            `- ${post.status} · ${post.provider} · ${post.scheduledAt?.toISOString() ?? post.publishedAt?.toISOString() ?? "unscheduled"} · "${post.text.replace(/\s+/g, " ").slice(0, 80)}" (id ${post.id})${post.publishedUrl ? ` ${post.publishedUrl}` : ""}`,
        )
      : ["- none"]),
  ];
  return { packet: lines.join("\n"), skip: false };
}

export interface CmoUpNextItem {
  id: string;
  date: string;
  channel: string;
  title: string;
  status: string;
}

export interface CmoOverview {
  workspace: CmoWorkspace;
  learning: CmoLearningState;
  /** What Cuso does when, for Settings. */
  routines: {
    key: string;
    name: string;
    when: string;
    description: string;
    nextRunAt: Date | null;
  }[];
  organizationSlug: string;
  roomId: string;
  subscriptionActive: boolean;
  brandBrain: CmoBrandBrain | null;
  strategy: CmoStrategy | null;
  botStatus: string;
  updates: CmoUpdateRecord[];
  channels: Awaited<ReturnType<typeof listCmoChannels>>;
  upNext: CmoUpNextItem[];
  connectChannelUrl: string;
  subscribeUrl: string;
  billing: {
    plan: string | null;
    subscriptionStatus: string | null;
    availableCredits: number;
  };
  /** Real post counts by status from Project Social; no invented metrics. */
  posts: Record<string, number>;
}

/**
 * What the "Up next" panel lists: the calendar's next open entries that Cuso
 * can actually execute, i.e. on a connected, active social account. Website,
 * newsletter and ads entries, and networks not connected yet, stay in the
 * Strategy calendar only.
 */
export function cmoUpNext(
  strategy: CmoStrategy | null,
  now: Date,
  connectedProviders: readonly string[],
  limit = 8,
): CmoUpNextItem[] {
  if (!strategy) return [];
  const today = now.toISOString().slice(0, 10);
  const executable = new Set(
    connectedProviders.map((provider) => provider.toLowerCase()),
  );
  return strategy.calendar
    .filter(
      (entry) =>
        entry.date >= today &&
        entry.status !== "published" &&
        entry.status !== "skipped" &&
        executable.has(entry.channel),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map(({ id, date, channel, title, status }) => ({
      id,
      date,
      channel,
      title,
      status,
    }));
}

/** Everything the CMO app shows, in one read. Opens the owner's chat. */
export async function getCmoOverview(
  userId: string,
  now: Date = new Date(),
): Promise<CmoOverview | null> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) return null;
  const [organization, bot, channels] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: workspace.organizationId },
      select: { slug: true },
    }),
    prisma.sokoBot.findUnique({
      where: { id: workspace.sokoBotId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        status: true,
        workspace: { select: { organizationId: true } },
      },
    }),
    listCmoChannels(workspace.projectId),
  ]);
  const postGroups = await prisma.socialPost.groupBy({
    by: ["status"],
    where: { projectId: workspace.projectId },
    _count: { _all: true },
  });
  if (!organization || !bot) return null;
  const { findOrOpenOwnerDirectRoom } = await import(
    "@/services/soko-bot-chat.service"
  );
  const room = await findOrOpenOwnerDirectRoom(bot);
  const strategy = parseCmoStrategy(workspace.strategy);
  const web = getWebAppBaseUrl().replace(/\/+$/, "");
  const credits = await buildCreditsPayload({
    userId,
    organizationId: workspace.organizationId,
    referenceId: workspace.organizationId,
    tx: prisma,
  });
  const cmoPlan = await activeCmoPlan(workspace.organizationId);
  const learning = await cmoLearningState(workspace, now);
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: workspace.sokoBotId, systemKey: { not: null } },
    select: { systemKey: true, nextRunAt: true, enabled: true },
  });
  const routines = SOKO_BOT_CMO_SCHEDULES.map((routine) => {
    const row = schedules.find((s) => s.systemKey === routine.key);
    return {
      key: routine.key,
      name: routine.name,
      when: routine.when,
      description: routine.description,
      nextRunAt: row?.enabled ? row.nextRunAt : null,
    };
  });
  return {
    workspace,
    learning,
    routines,
    organizationSlug: organization.slug,
    roomId: room.id,
    subscriptionActive: cmoPlan !== null,
    brandBrain: parseCmoBrandBrain(workspace.brandBrain),
    strategy,
    botStatus: bot.status,
    updates: parseCmoUpdates(workspace.updates),
    channels,
    upNext: cmoUpNext(
      strategy,
      now,
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider),
    ),
    // Connecting an account is a human OAuth step in Sokosumi's Social page.
    connectChannelUrl: `${web}/social?projectId=${workspace.projectId}`,
    // TODO(cmo): a CMO plan checkout; Sokosumi's billing page until then.
    subscribeUrl: `${web}/billing`,
    billing: {
      // The plan that gates Cuso first; otherwise whatever the org is on.
      plan: cmoPlan ?? credits.subscription?.plan ?? null,
      subscriptionStatus: credits.subscription?.status ?? null,
      availableCredits: credits.spendable,
    },
    posts: Object.fromEntries(
      postGroups.map((group) => [group.status, group._count._all]),
    ),
  };
}
