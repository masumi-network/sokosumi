import {
  type BrandBrain,
  type MarketingStrategyPlan,
  SOKO_BOT_CMO_RHYTHMS,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { getWebAppBaseUrl } from "@/config/env";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import type { CmoBrandMedia } from "@/schemas/cmo.schema";
import { parseBrandBrain } from "@/services/brand-brain.service";
import {
  type CmoBilling,
  isCmoSubscribed,
  readCmoBilling,
} from "@/services/cmo-billing.service";
import { cmoBrandMedia } from "@/services/cmo-brand-media.service";
import {
  type CmoBrandVisual,
  cmoBrandVisual,
} from "@/services/cmo-brand-visual.service";
import {
  type CmoLearningState,
  type Cuso,
  type CusoTarget,
  cmoPayer,
  findCusoForProject,
  listCmoChannels,
} from "@/services/cmo-cuso.service";
import {
  type CmoWork,
  cmoLearningState,
  cmoWork,
} from "@/services/cmo-hiring.service";
import {
  type CmoMeasurementStatus,
  learnCmoSitePlatform,
  listCmoMeasurement,
} from "@/services/cmo-measurement.service";
import {
  type CmoCalendarMedia,
  cmoCalendarMedia,
  cmoSocialPostMedia,
} from "@/services/cmo-media.service";
import {
  type CmoUpdateRecord,
  listCmoReports,
} from "@/services/cmo-reports.service";
import { contactListNameKey } from "@/services/contact-lists.service";
import {
  approvedMarketingStrategy,
  listMarketingStrategies,
  listMarketingStrategyFiles,
  listMarketingStrategyPosts,
  type MarketingStrategyFilePiece,
  type MarketingStrategyVersion,
  mayApproveMarketingStrategy,
  newestMarketingStrategy,
  parseMarketingPlan,
  withMarketingFiles,
  withSocialPostCalendar,
} from "@/services/marketing-strategy.service";

/** Cuso's newest report cards CMO shows. */
const CMO_REPORTS_SHOWN = 60;

export interface CmoUpNextItem {
  id: string;
  date: string;
  channel: string;
  title: string;
  status: string;
}

/**
 * Where Hiring Cuso stands, read from the data (ADR 0062): the Brand Brain
 * until a member confirms it, the Marketing strategy until a version is
 * approved, the accounts until the Project has an active Social connection,
 * the checkout until his Project has a CMO subscription (ADR 0068).
 * CMO's own cookie may skip the accounts (ADR 0062).
 */
/** Hiring Cuso's steps, in order. */
export const CMO_ONBOARDING_STEPS = [
  "brandBrain",
  "strategy",
  "accounts",
  "checkout",
  "done",
] as const;
export type CmoOnboardingStep = (typeof CMO_ONBOARDING_STEPS)[number];

export function cmoOnboardingStep(input: {
  brandBrainConfirmed: boolean;
  strategyApproved: boolean;
  connected: boolean;
  /** His Project has a CMO subscription that has not ended. */
  subscribed: boolean;
  /** Hired before CMO plans: such a Cuso never owes the checkout. */
  hiredWithStarterCredits: boolean;
}): CmoOnboardingStep {
  if (!input.strategyApproved) {
    return input.brandBrainConfirmed ? "strategy" : "brandBrain";
  }
  if (!input.connected) return "accounts";
  return input.subscribed || input.hiredWithStarterCredits
    ? "done"
    : "checkout";
}

export interface CmoOverview {
  cuso: Cuso;
  onboardingStep: CmoOnboardingStep;
  /** The image or video attached to each calendar piece, viewable by URL. */
  media: CmoCalendarMedia[];
  /** Cuso's Workspace's organization, when it is not a personal one. */
  organizationSlug: string | null;
  projectName: string;
  learning: CmoLearningState;
  /** Cuso's latest research or strategy work, step by step. */
  work: CmoWork | null;
  /** The Project's logo and DESIGN.md, with the research pictures. */
  brandVisual: CmoBrandVisual | null;
  /** Brand research screenshots and pictures, the Project's files. */
  brandMedia: CmoBrandMedia | null;
  /** The Project's logo (the site's best icon), when one was found. */
  projectLogo: string | null;
  /** What Cuso does when, for Settings. */
  routines: {
    key: string;
    name: string;
    when: string;
    description: string;
    nextRunAt: Date | null;
    /** The timezone "when" is in, so the next run reads the same way. */
    timezone: string | null;
  }[];
  roomId: string;
  /** The CMO subscription gate (`isCmoSubscribed`): false is paused. */
  subscriptionActive: boolean;
  /** This member may approve the strategy. */
  viewerCanApprove: boolean;
  brandBrain: BrandBrain | null;
  /** The newest Marketing strategy version's plan: what the owner reviews. */
  strategy: MarketingStrategyPlan | null;
  /**
   * The approved version's plan as Cuso carries it out, with the pieces he
   * made. Differs from `strategy` while a change waits for approval.
   */
  approvedStrategy: MarketingStrategyPlan | null;
  /** Every version, newest first; the first is the one `strategy` shows. */
  strategyVersions: MarketingStrategyVersion[];
  /** When a plan was first approved; a later approval does not move it. */
  hiredAt: Date | null;
  botStatus: string;
  updates: CmoUpdateRecord[];
  channels: Awaited<ReturnType<typeof listCmoChannels>>;
  upNext: CmoUpNextItem[];
  connectChannelUrl: string;
  /** Ad providers with an active connection on Cuso's Project. */
  adProviders: string[];
  /** Sokosumi's Ads page for Cuso's Project, where ad accounts connect. */
  connectAdsUrl: string;
  /** Google Analytics, Search Console and Shopify, as connected to Cuso. */
  measurement: CmoMeasurementStatus[];
  /** The month's production after approval: how many pieces are made. */
  production: import("@/services/cmo-production.service").CmoProductionStatus;
  /** People on the newsletter list. */
  mailingListSize: number;
  /** This person is in Sokosumi's Ads beta, so CMO offers ad connections. */
  /** Cuso's CMO plan (ADR 0068) and what his Project can spend. */
  billing: CmoBilling & {
    availableCredits: number;
    /** This member may change the plan and open the portal. */
    viewerCanManage: boolean;
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
  strategy: Pick<MarketingStrategyPlan, "calendar"> | null,
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

/** Everything the CMO app shows, in one read, for one member of the business. */
export async function getCmoOverview(
  target: CusoTarget,
  now: Date = new Date(),
): Promise<CmoOverview | null> {
  const { userId } = target;
  const cuso = await findCusoForProject(target);
  if (!cuso) return null;
  const payer = await cmoPayer(cuso);
  const [organization, project, bot, channels] = await Promise.all([
    payer.organizationId
      ? prisma.organization.findUnique({
          where: { id: payer.organizationId },
          select: { slug: true },
        })
      : null,
    prisma.project.findUnique({
      where: { id: cuso.projectId },
      select: {
        name: true,
        logo: true,
        designMdUrl: true,
        sitePlatform: true,
      },
    }),
    prisma.sokoBot.findUnique({
      where: { id: cuso.sokoBotId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        sharedRoomId: true,
        workspace: { select: { organizationId: true } },
      },
    }),
    listCmoChannels(cuso.projectId),
  ]);
  const [adConnections, mailingListSize, measurement] = await Promise.all([
    // An ad connection counts once an ad account is attached to it.
    prisma.projectAdAccount.findMany({
      where: { projectId: cuso.projectId, connection: { status: "active" } },
      select: { provider: true },
    }),
    cmoMailingListSize(cuso),
    listCmoMeasurement(cuso.sokoBotId, project?.sitePlatform ?? null),
  ]);
  if (project && project.sitePlatform === null) {
    waitUntil(learnCmoSitePlatform(cuso));
  }
  const postGroups = await prisma.socialPost.groupBy({
    by: ["status"],
    where: { projectId: cuso.projectId },
    _count: { _all: true },
  });
  // The chat is Cuso's shared room with every member (ADR 0061).
  if (!bot?.sharedRoomId || !project) return null;
  const [newest, approved, [strategyVersions]] = await Promise.all([
    newestMarketingStrategy(cuso.projectId),
    approvedMarketingStrategy(cuso.projectId),
    // shortcut: CMO lists the newest 50 versions only; page through the
    // Project route once a business keeps more.
    listMarketingStrategies(cuso.projectId, {
      cursor: undefined,
      take: 50,
      skip: undefined,
    }),
  ]);
  // Once approved, a version's social pieces are the Project's Social posts
  // and its other written pieces the Project's Files.
  const [posts, files] = approved
    ? await Promise.all([
        listMarketingStrategyPosts(approved),
        listMarketingStrategyFiles(approved),
      ])
    : [[], new Map<string, MarketingStrategyFilePiece>()];
  const planOf = (version: typeof newest) => {
    const plan = parseMarketingPlan(version?.plan);
    return plan && version?.approvedAt
      ? withMarketingFiles(withSocialPostCalendar(plan, posts), files)
      : plan;
  };
  const strategy = planOf(newest);
  // Up next is what is carried out: the approved version's calendar.
  const running = approved ? planOf(approved) : strategy;
  const web = getWebAppBaseUrl().replace(/\/+$/, "");
  const [credits, viewerCanApprove, billing] = await Promise.all([
    buildCreditsPayload({
      userId,
      organizationId: payer.organizationId,
      referenceId: payer.referenceId,
      projectId: cuso.projectId,
      tx: prisma,
    }),
    mayApproveMarketingStrategy(userId, {
      id: cuso.workspaceId,
      userId: null,
      organizationId: payer.organizationId,
    }),
    readCmoBilling(cuso.projectId),
  ]);
  const subscribed = await isCmoSubscribed(cuso);
  const mediaOf = (plan: typeof strategy) =>
    cmoCalendarMedia({
      strategy: plan,
      workspaceId: bot.workspaceId,
      organizationId: bot.workspace.organizationId,
      userId,
    });
  const media = [
    ...(await mediaOf(strategy)),
    // The month being made, when a newer version waits for approval.
    ...(approved && approved.id !== newest?.id ? await mediaOf(running) : []),
    ...cmoSocialPostMedia(posts),
  ].filter(
    (item, index, all) =>
      all.findIndex((other) => other.entryId === item.entryId) === index,
  );
  const { cmoHiredAt, readCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  const hiredAt = await cmoHiredAt(
    cuso.sokoBotId,
    approved?.approvedAt ?? null,
  );
  const production = await readCmoProduction(cuso, {
    connected: new Set(
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider.toLowerCase()),
    ),
    subscribed,
    now,
  });
  const learning = await cmoLearningState(cuso, now);
  const work = await cmoWork(cuso, now);
  const brandBrain = parseBrandBrain(cuso.brandBrain);
  // Blob storage not answering leaves the research out, not the page.
  const brandMedia = await cmoBrandMedia({
    projectId: cuso.projectId,
    websiteUrl: cuso.websiteUrl,
    brain: brandBrain,
  }).catch((error) => {
    console.warn("CMO brand media not read", {
      projectId: cuso.projectId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });
  const brandVisual = await cmoBrandVisual(
    project,
    brandMedia?.pictures.map((picture) => picture.url) ?? [],
  );
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: cuso.sokoBotId, systemKey: { not: null } },
    select: {
      systemKey: true,
      nextRunAt: true,
      enabled: true,
      timezone: true,
    },
  });
  const routines = SOKO_BOT_CMO_RHYTHMS.map((routine) => {
    const row = schedules.find((s) => s.systemKey === routine.key);
    return {
      key: routine.key,
      name: routine.name,
      when: routine.when,
      description: routine.description,
      nextRunAt: row?.enabled ? row.nextRunAt : null,
      timezone: row?.timezone ?? null,
    };
  });
  return {
    cuso,
    onboardingStep: cmoOnboardingStep({
      brandBrainConfirmed: cuso.brandBrainConfirmedAt !== null,
      strategyApproved: approved !== null,
      // Once a network was connected hiring is over: a lapsed or removed
      // connection is fixed on Channels, not by hiring again.
      connected: channels.length > 0,
      subscribed: billing.status !== null,
      hiredWithStarterCredits: billing.hiredWithStarterCredits,
    }),
    media,
    learning,
    work,
    brandVisual,
    brandMedia,
    projectLogo: project.logo,
    routines,
    organizationSlug: organization?.slug ?? null,
    projectName: project.name,
    roomId: bot.sharedRoomId,
    subscriptionActive: subscribed,
    viewerCanApprove,
    brandBrain,
    strategy,
    approvedStrategy: approved ? running : null,
    strategyVersions,
    hiredAt,
    botStatus: bot.status,
    updates: await listCmoReports(cuso.sokoBotId, CMO_REPORTS_SHOWN),
    channels,
    upNext: cmoUpNext(
      running,
      now,
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider),
    ),
    // Connecting an account is a human OAuth step in Sokosumi's Social page.
    connectChannelUrl: `${web}/social?projectId=${cuso.projectId}`,
    adProviders: [...new Set(adConnections.map((row) => row.provider))],
    connectAdsUrl: `${web}/ads?projectId=${cuso.projectId}`,
    measurement,
    production: production.status,
    mailingListSize,
    billing: {
      ...billing,
      availableCredits: credits.spendable,
      // Owners and admins, as for approving the strategy (ADR 0061).
      viewerCanManage: viewerCanApprove,
    },
    posts: Object.fromEntries(
      postGroups.map((group) => [group.status, group._count._all]),
    ),
  };
}

/**
 * The contact list Cuso writes the newsletter for, in the CMO workspace. The
 * CMO app fills it through the standard contact-list import.
 */
export const CMO_MAILING_LIST_NAME = "Newsletter";

/** How many people are on the newsletter list. */
async function cmoMailingListSize(
  cuso: Pick<Cuso, "workspaceId">,
): Promise<number> {
  return prisma.contactListMember.count({
    where: {
      list: {
        workspaceId: cuso.workspaceId,
        nameKey: contactListNameKey(CMO_MAILING_LIST_NAME),
      },
      contact: { mergedIntoId: null },
    },
  });
}
