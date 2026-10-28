import {
  type CmoBrandBrain,
  type CmoStrategy,
  SOKO_BOT_CMO_SCHEDULES,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { getWebAppBaseUrl } from "@/config/env";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import {
  activeCmoPlan,
  cmoMockBilling,
  cmoMockPlan,
  mayCommitCmo,
} from "@/services/cmo-billing.service";
import { parseCmoBrandBrain } from "@/services/cmo-brand-brain.service";
import {
  type CmoBrandVisual,
  parseCmoBrandVisual,
} from "@/services/cmo-brand-visual.service";
import {
  type CmoHireView,
  type CmoLearningState,
  cmoPayer,
  getCmoHireForUser,
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
} from "@/services/cmo-media.service";
import {
  type CmoUpdateRecord,
  listCmoReports,
} from "@/services/cmo-reports.service";
import { parseCmoStrategy } from "@/services/cmo-strategy.service";
import { contactListNameKey } from "@/services/contact-lists.service";

/** Cuso's newest report cards CMO shows. */
const CMO_REPORTS_SHOWN = 60;

export interface CmoUpNextItem {
  id: string;
  date: string;
  channel: string;
  title: string;
  status: string;
}

export interface CmoOverview {
  hire: CmoHireView;
  /** The image or video attached to each calendar piece, viewable by URL. */
  media: CmoCalendarMedia[];
  /** Cuso's Workspace's organization, when it is not a personal one. */
  organizationSlug: string | null;
  projectName: string;
  learning: CmoLearningState;
  /** Cuso's latest research or strategy work, step by step. */
  work: CmoWork | null;
  brandVisual: CmoBrandVisual | null;
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
  brandBrain: CmoBrandBrain | null;
  strategy: CmoStrategy | null;
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
  strategy: Pick<CmoStrategy, "calendar"> | null,
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
  const hire = await getCmoHireForUser(userId);
  if (!hire) return null;
  const payer = await cmoPayer(hire);
  const [organization, project, bot, channels] = await Promise.all([
    payer.organizationId
      ? prisma.organization.findUnique({
          where: { id: payer.organizationId },
          select: { slug: true },
        })
      : null,
    prisma.project.findUnique({
      where: { id: hire.projectId },
      select: { name: true, logo: true },
    }),
    prisma.sokoBot.findUnique({
      where: { id: hire.sokoBotId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        sharedRoomId: true,
        workspace: { select: { organizationId: true } },
      },
    }),
    listCmoChannels(hire.projectId),
  ]);
  const [adConnections, mailingListSize, measurement] = await Promise.all([
    prisma.projectAdConnection.findMany({
      where: { projectId: hire.projectId, status: "active" },
      select: { provider: true },
    }),
    cmoMailingListSize(hire),
    listCmoMeasurement(hire.sokoBotId, hire.sitePlatform),
  ]);
  if (hire.sitePlatform === null) waitUntil(learnCmoSitePlatform(hire));
  const postGroups = await prisma.socialPost.groupBy({
    by: ["status"],
    where: { projectId: hire.projectId },
    _count: { _all: true },
  });
  // The chat is Cuso's shared room with every member (ADR 0061).
  if (!bot?.sharedRoomId || !project) return null;
  const strategy = parseCmoStrategy(hire.strategy);
  const web = getWebAppBaseUrl().replace(/\/+$/, "");
  const [credits, viewerCanApprove] = await Promise.all([
    buildCreditsPayload({
      userId,
      organizationId: payer.organizationId,
      referenceId: payer.referenceId,
      tx: prisma,
    }),
    mayCommitCmo(userId, payer.organizationId),
  ]);
  const mockPlan = cmoMockPlan(hire);
  const cmoPlan = mockPlan ?? (await activeCmoPlan(payer.referenceId));
  const media = await cmoCalendarMedia({
    strategy,
    workspaceId: bot.workspaceId,
    organizationId: bot.workspace.organizationId,
    userId,
  });
  const { readCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  const production = await readCmoProduction(hire, {
    connected: new Set(
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider.toLowerCase()),
    ),
    subscribed: cmoPlan !== null,
    now,
  });
  const learning = await cmoLearningState(hire, now);
  const work = await cmoWork(hire, now);
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: hire.sokoBotId, systemKey: { not: null } },
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
    hire,
    media,
    learning,
    work,
    brandVisual: parseCmoBrandVisual(hire.brandVisual),
    projectLogo: project.logo,
    routines,
    organizationSlug: organization?.slug ?? null,
    projectName: project.name,
    roomId: bot.sharedRoomId,
    subscriptionActive: cmoPlan !== null,
    viewerCanApprove,
    mockBilling: cmoMockBilling(),
    mockPlan,
    mockPlanActivatedAt: mockPlan ? hire.mockPlanActivatedAt : null,
    brandBrain: parseCmoBrandBrain(hire.brandBrain),
    strategy,
    botStatus: bot.status,
    updates: await listCmoReports(hire.sokoBotId, CMO_REPORTS_SHOWN),
    channels,
    upNext: cmoUpNext(
      strategy,
      now,
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider),
    ),
    // Connecting an account is a human OAuth step in Sokosumi's Social page.
    connectChannelUrl: `${web}/social?projectId=${hire.projectId}`,
    adProviders: [...new Set(adConnections.map((row) => row.provider))],
    connectAdsUrl: `${web}/ads?projectId=${hire.projectId}`,
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
  hire: Pick<CmoHireView, "workspaceId">,
): Promise<number> {
  return prisma.contactListMember.count({
    where: {
      list: {
        workspaceId: hire.workspaceId,
        nameKey: contactListNameKey(CMO_MAILING_LIST_NAME),
      },
      contact: { mergedIntoId: null },
    },
  });
}
