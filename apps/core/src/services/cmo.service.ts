import { randomBytes } from "node:crypto";
import type { CmoWorkspace, Prisma } from "@sokosumi/database";
import {
  CMO_SOKO_BOT_VERSION_ID,
  type CmoAutonomy,
  type CmoBrandBrain,
  type CmoStrategy,
  cmoBrandBrainSchema,
  cmoChannelAutonomy,
  cmoMayExecute,
  cmoStrategySchema,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
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

/** Execution (scheduling, publishing) needs a paid plan on the org. */
export async function hasActiveCmoSubscription(
  organizationId: string,
): Promise<boolean> {
  const plans = getEnv().CMO_SUBSCRIPTION_PLANS;
  const subscription = await prisma.subscription.findFirst({
    where: {
      referenceId: organizationId,
      plan: { in: plans },
      status: { in: ["active", "trialing"] },
    },
    select: { id: true },
  });
  return subscription !== null;
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
  return [
    `New CMO client: ${input.businessName} (${input.websiteUrl}).`,
    `Their marketing goals, in their words: ${input.goals}`,
    "",
    "Learn the business and build the Brand Brain: read the website, search for the company, its competitors and its existing marketing, then save it with save_brand_brain. Finish with a short, warm hello to the owner: what you learned in three lines, and that the next step is a one-month plan they can start from the CMO app.",
  ].join("\n");
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
    clientTurnId: `cmo:onboarding:${created.id}`,
    message: onboardingMessage({
      businessName,
      websiteUrl: input.websiteUrl,
      goals: input.goals,
    }),
    route: CMO_ONBOARDING_ROUTE,
  });
  return created;
}

/** Asks Cuso for (another) one-month strategy. */
export async function requestCmoStrategy(input: {
  userId: string;
  note?: string;
}): Promise<{ turnId: string }> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  if (!parseCmoBrandBrain(workspace.brandBrain)) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  const month = new Date().toISOString().slice(0, 7);
  return startCmoTurn(workspace, {
    clientTurnId: `cmo:strategy:${workspace.id}:${Date.now()}`,
    message: [
      `Plan the marketing for the next month (start ${month}) for ${workspace.businessName}.`,
      `Goals: ${workspace.goals}`,
      input.note ? `The owner adds: ${input.note}` : "",
      "",
      "Use the Brand Brain in your packet. Save the strategy with save_strategy: summary, goals, pillars, each channel with cadence (autonomy ask unless the owner said otherwise), and a calendar for the whole month. Draft the first week's posts as Social post drafts in the Marketing project (no scheduledAt) with cheap images where the format needs one, and link them in the calendar. Then tell the owner the plan in a few lines and that they can change anything by chatting with you.",
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

/**
 * Saves the strategy. Only the owner changes a channel's autonomy: Cuso's
 * save keeps the stored level for every channel that already has one, so a
 * plan rewrite cannot quietly turn a channel to autopilot.
 */
export async function saveCmoStrategy(
  where: { userId: string } | { sokoBotId: string },
  strategy: CmoStrategy,
  options: { byOwner: boolean },
): Promise<CmoWorkspace> {
  const parsed = cmoStrategySchema.parse(strategy);
  const current = await prisma.cmoWorkspace.findUnique({ where });
  if (!current) throw new CmoNotFoundError("No CMO workspace");
  const previous = parseCmoStrategy(current.strategy);
  const channels = options.byOwner
    ? parsed.channels
    : parsed.channels.map((channel) => {
        const kept = previous?.channels.find(
          (entry) => entry.channel === channel.channel,
        );
        return {
          ...channel,
          autonomy: kept?.autonomy ?? ("ask" satisfies CmoAutonomy),
        };
      });
  return prisma.cmoWorkspace.update({
    where: { id: current.id },
    data: {
      strategy: { ...parsed, channels } as Prisma.InputJsonValue,
      strategyUpdatedAt: new Date(),
    },
  });
}

/** The owner's edits from the CMO app: autonomy per channel, review mode. */
export async function updateCmoStrategySettings(input: {
  userId: string;
  channels?: { channel: string; autonomy: CmoAutonomy }[];
  reviewMode?: "suggest" | "auto";
}): Promise<CmoWorkspace> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  const strategy = parseCmoStrategy(workspace.strategy);
  if (!strategy) throw new CmoConflictError("There is no strategy yet");
  const channels = strategy.channels.map((channel) => ({
    ...channel,
    autonomy:
      input.channels?.find(
        (entry) => entry.channel.trim().toLowerCase() === channel.channel,
      )?.autonomy ?? channel.autonomy,
  }));
  return saveCmoStrategy(
    { userId: input.userId },
    {
      ...strategy,
      channels,
      reviewMode: input.reviewMode ?? strategy.reviewMode,
    },
    { byOwner: true },
  );
}

/**
 * Whether a CMO bot may schedule or publish on a provider in this turn.
 * Null for bots that are not CMO bots (no CMO rules apply) and when allowed.
 */
export async function cmoExecutionRefusal(input: {
  sokoBotId: string;
  versionId: string | null;
  provider: string;
  ownerPresent: boolean;
}): Promise<string | null> {
  if (getSokoBotVersion(input.versionId).profile !== "cmo") return null;
  const workspace = await getCmoWorkspaceForBot(input.sokoBotId);
  if (!workspace) return null;
  const verdict = cmoMayExecute({
    subscribed: await hasActiveCmoSubscription(workspace.organizationId),
    autonomy: cmoChannelAutonomy(
      parseCmoStrategy(workspace.strategy),
      input.provider,
    ),
    ownerPresent: input.ownerPresent,
  });
  return verdict.ok ? null : verdict.reason;
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
    subscriptionActive: await hasActiveCmoSubscription(
      workspace.organizationId,
    ),
    brandBrain: parseCmoBrandBrain(workspace.brandBrain),
    strategy: strategy
      ? {
          ...strategy,
          calendar: calendarWindow(strategy, now, 14),
          calendarTotal: strategy.calendar.length,
          weeklyReviews: strategy.weeklyReviews.slice(-2),
        }
      : null,
  };
}

/** The packet appended to a CMO rhythm's prompt. */
export async function buildCmoBeatPacket(
  sokoBotId: string,
  now: Date,
): Promise<string> {
  const context = await loadCmoMarketingContext(sokoBotId, now);
  if (!context) return "No CMO workspace is linked to this bot.";
  const workspace = await getCmoWorkspaceForBot(sokoBotId);
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
    `## Execution: ${context.subscriptionActive ? "active" : "paused (no CMO subscription; draft only)"}`,
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
  return lines.join("\n");
}

export interface CmoOverview {
  workspace: CmoWorkspace;
  organizationSlug: string;
  roomId: string;
  subscriptionActive: boolean;
  brandBrain: CmoBrandBrain | null;
  strategy: CmoStrategy | null;
  botStatus: string;
}

/** Everything the CMO app shows, in one read. Opens the owner's chat. */
export async function getCmoOverview(
  userId: string,
): Promise<CmoOverview | null> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) return null;
  const [organization, bot] = await Promise.all([
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
  ]);
  if (!organization || !bot) return null;
  const { findOrOpenOwnerDirectRoom } = await import(
    "@/services/soko-bot-chat.service"
  );
  const room = await findOrOpenOwnerDirectRoom(bot);
  return {
    workspace,
    organizationSlug: organization.slug,
    roomId: room.id,
    subscriptionActive: await hasActiveCmoSubscription(
      workspace.organizationId,
    ),
    brandBrain: parseCmoBrandBrain(workspace.brandBrain),
    strategy: parseCmoStrategy(workspace.strategy),
    botStatus: bot.status,
  };
}
