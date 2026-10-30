import {
  type BrandBrain,
  type MarketingStrategyPlan,
  SOKO_BOT_CMO_SCHEDULES,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { getWebAppBaseUrl } from "@/config/env";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import type { CmoBrandMedia } from "@/schemas/cmo.schema";
import { parseBrandBrain } from "@/services/brand-brain.service";
import {
  activeCmoSubscription,
  cmoMockBilling,
} from "@/services/cmo-billing.service";
import { cmoBrandMedia } from "@/services/cmo-brand-media.service";
import {
  type CmoBrandVisual,
  cmoBrandVisual,
} from "@/services/cmo-brand-visual.service";
import {
  type CmoLearningState,
  type Cuso,
  cmoPayer,
  findCusoForUser,
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
  listMarketingStrategyPosts,
  type MarketingStrategyVersion,
  mayApproveMarketingStrategy,
  newestMarketingStrategy,
  parseMarketingPlan,
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
 * the plan until the organization has an active CMO plan. CMO's own cookie
 * may skip the last two (ADR 0062).
 */
/** Hiring Cuso's steps, in order. */
export const CMO_ONBOARDING_STEPS = [
  "brandBrain",
  "strategy",
  "accounts",
  "plan",
  "done",
] as const;
export type CmoOnboardingStep = (typeof CMO_ONBOARDING_STEPS)[number];

export function cmoOnboardingStep(input: {
  brandBrainConfirmed: boolean;
  strategyApproved: boolean;
  connected: boolean;
  subscribed: boolean;
}): CmoOnboardingStep {
  if (input.strategyApproved && input.subscribed) return "done";
  if (input.strategyApproved) return input.connected ? "plan" : "accounts";
  return input.brandBrainConfirmed ? "strategy" : "brandBrain";
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
  subscriptionActive: boolean;
  /** This member may approve the strategy and start the paid month. */
  viewerCanApprove: boolean;
  /** CMO_MOCK_BILLING: CMO offers its own tiers without checkout. */
  mockBilling: boolean;
  mockPlan: string | null;
  mockPlanActivatedAt: Date | null;
  brandBrain: BrandBrain | null;
  /** The newest Marketing strategy version's plan: what the owner reviews. */
  strategy: MarketingStrategyPlan | null;
  /** Every version, newest first; the first is the one `strategy` shows. */
  strategyVersions: MarketingStrategyVersion[];
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
  /** The month's production after payment: how many pieces are made. */
  production: import("@/services/cmo-production.service").CmoProductionStatus;
  /** People on the newsletter list. */
  mailingListSize: number;
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
  userId: string,
  now: Date = new Date(),
): Promise<CmoOverview | null> {
  const cuso = await findCusoForUser(userId);
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
    prisma.projectAdConnection.findMany({
      where: { projectId: cuso.projectId, status: "active" },
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
  // Once approved, a version's social pieces are the Project's Social posts.
  const posts = approved ? await listMarketingStrategyPosts(approved) : [];
  const planOf = (version: typeof newest) => {
    const plan = parseMarketingPlan(version?.plan);
    return plan && version?.approvedAt
      ? withSocialPostCalendar(plan, posts)
      : plan;
  };
  const strategy = planOf(newest);
  // Up next is what is carried out: the approved version's calendar.
  const running = approved ? planOf(approved) : strategy;
  const web = getWebAppBaseUrl().replace(/\/+$/, "");
  const [credits, viewerCanApprove] = await Promise.all([
    buildCreditsPayload({
      userId,
      organizationId: payer.organizationId,
      referenceId: payer.referenceId,
      tx: prisma,
    }),
    mayApproveMarketingStrategy(userId, {
      id: cuso.workspaceId,
      userId: null,
      organizationId: payer.organizationId,
    }),
  ]);
  const cmoSubscription = await activeCmoSubscription(payer.referenceId);
  const cmoPlan = cmoSubscription?.plan ?? null;
  // A mock plan is the CMO Subscription without Stripe, while mock billing is on.
  const mockPlan =
    cmoMockBilling() && cmoSubscription?.stripeSubscriptionId === null
      ? cmoSubscription
      : null;
  const media = [
    ...(await cmoCalendarMedia({
      strategy,
      workspaceId: bot.workspaceId,
      organizationId: bot.workspace.organizationId,
      userId,
    })),
    ...cmoSocialPostMedia(posts),
  ];
  const { readCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  const production = await readCmoProduction(cuso, {
    connected: new Set(
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider.toLowerCase()),
    ),
    subscribed: cmoPlan !== null,
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
  const routines = SOKO_BOT_CMO_SCHEDULES.map((routine) => {
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
      connected: channels.some((channel) => channel.status === "ACTIVE"),
      subscribed: cmoPlan !== null,
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
    subscriptionActive: cmoPlan !== null,
    viewerCanApprove,
    mockBilling: cmoMockBilling(),
    mockPlan: mockPlan?.plan ?? null,
    mockPlanActivatedAt: mockPlan?.periodStart ?? null,
    brandBrain,
    strategy,
    strategyVersions,
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
