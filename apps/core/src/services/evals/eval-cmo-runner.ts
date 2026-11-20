import {
  CMO_PRODUCTION_TURN_PREFIX,
  cmoWritesMonthAtOnce,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  type ScenarioCheck,
} from "@sokosumi/soko-bot";
import { cmoMonthAtLevel } from "@sokosumi/utils";
import { isProjectSocialProvider } from "@/config/social-providers";
import { cmoReportMessageWhere } from "@/helpers/cmo-report-card";
import { jsonInput } from "@/helpers/prisma-json";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { EVAL_CONNECTED_ACCOUNT_PREFIX } from "@/lib/evals/eval-guard";
import {
  cmoPlanLevel,
  grantCmoTesterCredits,
} from "@/services/cmo-billing.service";
import {
  CMO_BRAND_MEDIA_FOLDER,
  captureCmoHomepage,
} from "@/services/cmo-brand-media.service";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { startCmoResearch } from "@/services/cmo-hiring.service";
import { parseCmoMonthReview } from "@/services/cmo-month-review.service";
import {
  cmoPromiseGaps,
  cmoStrategyRules,
  type PlanReviewOptions,
} from "@/services/cmo-plan-review.service";
import { advanceCmoProduction } from "@/services/cmo-production.service";
import { cmoSeoMarket } from "@/services/cmo-seo-market";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import { ADS_CASE_BUDGET } from "@/services/evals/eval-cmo-funnel";
import {
  claimChecks,
  linkedInOpeningChecks,
  pictureVarietyChecks,
} from "@/services/evals/eval-cmo-variety";
import {
  approveMarketingStrategy,
  isMarketingFilePiece,
  newestMarketingStrategy,
  parseMarketingPlan,
  parseSocialPostPlanning,
  STRATEGY_TURN_PREFIX,
} from "@/services/marketing-strategy.service";
import { readMarketingPieceText } from "@/services/marketing-strategy-files.service";
import { referenceLibraryAvailable } from "@/services/reference-library.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { SETTLED_TURN_STATUSES } from "@/services/soko-bot-lab-scenario.service";
import { brandBrainChecks, strategyChecks } from "./cmo-brand-checks";
import type {
  CaseContext,
  CaseOutcome,
  CasePoll,
  CaseStart,
} from "./eval-case-runner";
import {
  CMO_CHAT_BRAND,
  CMO_EVAL_BRANDS,
  CMO_EVAL_COMMENTS,
  type CmoChatSetup,
  type CmoEvalCase,
} from "./eval-cmo-cases";
import { prepareCompetitorAdsCase } from "./eval-cmo-competitor-ads";
import {
  isCompetitorSetup,
  prepareCompetitorCase,
} from "./eval-cmo-competitors";
import {
  evalInfrastructureFailure,
  infrastructureCaseOutcome,
} from "./eval-infrastructure";
import type { EvalLaneRecord } from "./eval-lanes.service";
import brandBrains from "./fixtures/cmo-brand-brains.json";
import monthPlans from "./fixtures/cmo-month-plans.json";

/** Research reads a whole site; a plan is one long turn. */
const CMO_TURN_TIMEOUT_MS = 45 * 60_000;
const PLANNED_MONTH_POST_STATUSES = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
] as const;
/** A month is a production run, Core's pictures, Jev's review and a rewrite. */
const MONTH_TIMEOUT_MS = 3 * 60 * 60_000;
/** Above this share of pieces Jev flags after the rewrite, the month fails. */
const MAX_FLAGGED_SHARE = 0.25;
const DAY_MS = 86_400_000;

/**
 * The frozen plan with its pieces moved to start tomorrow, one a day, and
 * nothing a past production left on them.
 */
export function monthPlanFromTomorrow(
  plan: MarketingStrategyPlan,
  now: Date,
): MarketingStrategyPlan {
  const pieces = plan.calendar.filter((entry) => entry.status !== "skipped");
  return {
    ...plan,
    calendar: pieces.map((entry, index) => ({
      id: entry.id,
      date: new Date(now.getTime() + (index + 1) * DAY_MS)
        .toISOString()
        .slice(0, 10),
      ...(entry.time ? { time: entry.time } : {}),
      channel: entry.channel,
      title: entry.title,
      format: entry.format,
      status: entry.status === "published" ? "idea" : entry.status,
      ...(entry.hook ? { hook: entry.hook } : {}),
      ...(entry.brief ? { brief: entry.brief } : {}),
      ...(entry.why ? { why: entry.why } : {}),
      ...(entry.story ? { story: entry.story } : {}),
      ...(entry.pillar ? { pillar: entry.pillar } : {}),
      ...(entry.approach ? { approach: entry.approach } : {}),
      ...(entry.campaignId ? { campaignId: entry.campaignId } : {}),
    })),
  };
}

/** Stand-in accounts for the plan's networks, so Core makes its posts. */
async function connectPlanChannels(
  lane: EvalLaneRecord,
  plan: MarketingStrategyPlan,
) {
  const channels = [
    ...new Set(plan.calendar.map((entry) => entry.channel)),
  ].filter(isProjectSocialProvider);
  for (const provider of channels) {
    const key = `eval-${lane.lane}-cuso-${provider}`;
    const existing = await prisma.projectSocialConnection.findFirst({
      where: { projectId: lane.cusoProjectId, provider },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.projectSocialConnection.create({
      data: {
        projectId: lane.cusoProjectId,
        provider,
        externalAccountId: key,
        externalHandle: "evalbrand",
        displayName: "Eval brand",
        composioConnectedAccountId: `${EVAL_CONNECTED_ACCOUNT_PREFIX}${key}`,
        status: "active",
        activeExternalAccountKey: key,
        connectorUserId: lane.userId,
        connectedAt: new Date(),
      },
    });
  }
}

/**
 * A turn past its deadline is dead, and a preview has no cron to end it; left
 * alone it would hold the lane for the rest of the run.
 */
async function cusoIsBusy(lane: EvalLaneRecord) {
  const active = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: lane.cusoBotId,
      status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
    },
    select: { id: true, deadlineAt: true },
  });
  const now = await databaseNow();
  const dead = active.filter((turn) => turn.deadlineAt <= now);
  await Promise.all(dead.map((turn) => endTurn(turn.id)));
  return active.length > dead.length;
}

function endTurn(turnId: string) {
  return sokoBotControlPlane.expireTurn(turnId).catch(() => undefined);
}

function brand(name: string) {
  const found = CMO_EVAL_BRANDS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No CMO eval brand ${name}`);
  return found;
}

/** The lane's Cuso Project pointed at the brand, with nothing an earlier case left. */
async function pointCusoAt(
  lane: EvalLaneRecord,
  brand: { url: string },
  brandBrain: unknown,
) {
  const projectId = lane.cusoProjectId;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      websiteUrl: brand.url,
      designMdUrl: null,
      designMdExtractionId: null,
    },
  });
  await prisma.marketingStrategy.deleteMany({ where: { projectId } });
  await prisma.brandBrain.deleteMany({ where: { projectId } });
  // The brand before this one left its page screenshots as brand pictures.
  await prisma.fileProjectLink.deleteMany({
    where: {
      projectId,
      resource: { sourceId: { contains: `/${CMO_BRAND_MEDIA_FOLDER}/` } },
    },
  });
  // Cuso reads his last reports: an earlier case's "done" is not this one's.
  await prisma.chatRoomMessage.deleteMany({
    where: cmoReportMessageWhere(lane.cusoBotId),
  });
  // What an earlier case kept (a table, a contact list, a reminder), a
  // later one finds and rightly does not make again.
  await prisma.dataTable.deleteMany({ where: { projectId } });
  await prisma.contactList.deleteMany({
    where: { createdBySokoBotId: lane.cusoBotId },
  });
  await prisma.sokoBotSchedule.deleteMany({
    where: { sokoBotId: lane.cusoBotId, systemKey: null },
  });
  if (brandBrain)
    await prisma.brandBrain.create({
      data: { projectId, body: jsonInput(brandBrain), updatedAt: new Date() },
    });
  const cuso = await findCusoForBot(lane.cusoBotId);
  if (!cuso) throw new Error(`Eval lane ${lane.lane} has no Cuso`);
  return cuso;
}

/** `count` slots, each item in its share of them, spread evenly. */
function spread<T extends { share: number }>(items: T[], count: number): T[] {
  const slots = items.flatMap((item) => {
    const times = (item.share / 100) * count;
    return Array.from({ length: Math.round(times) }, (_, n) => ({
      item,
      at: (n + 0.5) / times,
    }));
  });
  return slots.sort((a, b) => a.at - b.at).map((slot) => slot.item);
}

/** One title per piece, none repeating a message. */
const CHANGE_REQUEST_TITLES = [
  "One booking link for the whole team",
  "Cal.com vs Calendly for team booking",
  "Round-robin without spreadsheets",
  "Embed a booking widget in five lines",
  "Why reps stop chasing meeting times",
  "This week's team scheduling tip",
  "A tour of the team booking page",
  "How routing forms pick the right rep",
  "Booking pages that sales teams share",
  "Collective events for panel interviews",
  "Webhooks after every new booking",
  "A Teams trial checklist for week one",
  "Monthly recap of booking flows",
  "What each plan on the pricing page includes",
  "Buffer times that protect focus hours",
  "Routing inbound demos by company size",
  "Group availability across time zones",
  "Booking API rate limits explained",
  "Managed event types for large teams",
  "Five settings admins change first",
  "Routing forms in one picture",
  "Reminders that cut no-shows",
  "Open source scheduling for regulated teams",
  "Handing a lead to the next rep",
  "Self-hosting Cal.com on your own server",
  "Insights that show booking volume",
  "What changed in team booking this month",
  "Enterprise scheduling in one minute",
];

/** A week of the change request's month: LinkedIn three times, four other formats. */
const CHANGE_REQUEST_WEEK = [
  { channel: "linkedin", format: "post" },
  { channel: "facebook", format: "post" },
  { channel: "linkedin", format: "image" },
  { channel: "x", format: "post" },
  { channel: "linkedin", format: "post" },
  { channel: "newsletter", format: "issue" },
  { channel: "facebook", format: "image" },
] as const;

const CHANGE_REQUEST_CHANNELS = [
  {
    channel: "linkedin",
    cadence: "3 posts a week",
    why: "Reach operators with concrete team scheduling examples.",
  },
  {
    channel: "facebook",
    cadence: "2 posts a week",
    why: "Reach small business owners who book on Facebook.",
  },
  {
    channel: "x",
    cadence: "1 post a week",
    why: "Show developers the booking API in short examples.",
  },
  {
    channel: "newsletter",
    cadence: "1 issue a week",
    why: "Keep trial teams moving towards a working team flow.",
  },
];

/**
 * cal.com's month with LinkedIn three times a week from tomorrow, so the
 * change request always has pieces to cut, whatever an earlier case left.
 * Cutting LinkedIn to one a week still leaves the 16 pieces a save needs.
 */
export function changeRequestPlan(now: Date): MarketingStrategyPlan {
  const frozen = (monthPlans as Record<string, unknown>)[
    CMO_CHAT_BRAND
  ] as MarketingStrategyPlan;
  const [template] = frozen.calendar;
  if (!template) throw new Error("cal.com's plan lost its pieces");
  const slots = [0, 1, 2, 3].flatMap((week) =>
    CHANGE_REQUEST_WEEK.map((piece, day) => ({ week, day: day + 1, piece })),
  );
  const approaches = spread(frozen.mix, slots.length);
  const pillars = spread(frozen.pillars, slots.length);
  const named = new Set(CHANGE_REQUEST_CHANNELS.map((c) => c.channel));
  return {
    ...frozen,
    channels: CHANGE_REQUEST_CHANNELS,
    funnel: frozen.funnel.map((stage, index) => ({
      ...stage,
      plays: [
        ...stage.plays.filter((play) => named.has(play.channel)),
        ...(index === 0
          ? [
              {
                channel: "x",
                what: "Short booking API examples",
                cadence: "1 post a week",
              },
              {
                channel: "newsletter",
                what: "A weekly team scheduling tip",
                cadence: "1 issue a week",
              },
            ]
          : []),
      ],
    })),
    campaigns: frozen.campaigns?.map((campaign) => ({
      ...campaign,
      channels: campaign.channels?.filter((channel) => named.has(channel)),
    })),
    beforeAfter: frozen.beforeAfter
      ?.filter((row) => named.has(row.channel))
      .map((row) =>
        row.channel === "linkedin" ? { ...row, after: "3 posts weekly" } : row,
      ),
    // Week one in full, weeks two to four as titles, like a first plan.
    calendar: tellStories(
      slots.map(({ week, day, piece }, index) => ({
        time: template.time,
        status: "idea" as const,
        campaignId: template.campaignId,
        ...(week === 0 ? { brief: template.brief, why: template.why } : {}),
        ...piece,
        id: `${piece.channel}-w${week + 1}-${day}`,
        date: new Date(now.getTime() + (week * 7 + day) * DAY_MS)
          .toISOString()
          .slice(0, 10),
        title: CHANGE_REQUEST_TITLES[index] ?? template.title,
        approach: approaches[index]?.approach ?? template.approach,
        pillar: pillars[index]?.name ?? template.pillar,
      })),
    ),
  };
}

/**
 * cal.com's stories from its Brand Brain, one per pair of LinkedIn and
 * social-proof pieces: the plan review names a story told in three.
 */
const CHANGE_REQUEST_STORIES = [
  "Deel saves more than 6,000 hours a week on scheduling with Cal.com.",
  "Mintlify halved the time it takes to find a meeting slot across the company.",
  "Pennie raised its lead connect rate by 15% with Cal.com routing.",
  "Dr. B saved three months of product work by building on Cal.com routing.",
  "A G2 reviewer integrated Cal.com into their website and called the setup simple.",
  "Peer Richelsen and Bailey Pumfleet started Cal.com as Calendso in 2021.",
  "Cal.com shipped v6.9.5 on October 15, 2026, adding workflow delays and out-of-office integrations.",
  "Cal.com moved its commercial product to closed source in April 2026 and released Cal.diy for the community.",
];

function tellStories(
  calendar: MarketingStrategyPlan["calendar"],
): MarketingStrategyPlan["calendar"] {
  let told = 0;
  return calendar.map((entry) => {
    if (entry.channel !== "linkedin" && entry.approach !== "social-proof")
      return entry;
    const story = CHANGE_REQUEST_STORIES[Math.floor(told++ / 2)];
    return story ? { ...entry, story } : entry;
  });
}

/** The lane's Cuso on cal.com with the change request's month, waiting for approval. */
export async function prepareCmoPlan(
  lane: EvalLaneRecord,
  adsOn = false,
): Promise<void> {
  const brain = (brandBrains as Record<string, unknown>)[CMO_CHAT_BRAND];
  await pointCusoAt(lane, brand(CMO_CHAT_BRAND), brain ?? null);
  const plan = changeRequestPlan(new Date());
  await prisma.marketingStrategy.create({
    data: {
      projectId: lane.cusoProjectId,
      // As Core leaves the strategy when the owner says yes to ads and sets
      // the amount: the budget is theirs, the ads are still to be planned.
      plan: jsonInput(
        adsOn
          ? {
              ...plan,
              ads: {
                monthly: ADS_CASE_BUDGET,
                currency: "USD",
                expect: "Cuso is updating what this brings.",
                without: "The strategy runs on posts, search and email alone.",
                setByOwner: true,
              },
            }
          : plan,
      ),
      authorSokoBotId: lane.cusoBotId,
    },
  });
}

/**
 * The lane's Cuso Project as the chat brand, with its Brand Brain and its
 * month as a draft; or, for a new client, a site that does not load and
 * nothing learned.
 */
async function prepareCmoChat(lane: EvalLaneRecord, known: boolean) {
  if (!known) {
    await pointCusoAt(lane, { url: "https://acme-unknown.example" }, null);
    return;
  }
  const brand = CMO_EVAL_BRANDS.find((b) => b.name === CMO_CHAT_BRAND);
  if (!brand) throw new Error(`No CMO eval brand ${CMO_CHAT_BRAND}`);
  const brain = (brandBrains as Record<string, unknown>)[CMO_CHAT_BRAND];
  await pointCusoAt(lane, brand, brain ?? null);
  const frozen = parseMarketingPlan(
    (monthPlans as Record<string, unknown>)[CMO_CHAT_BRAND],
  ) as MarketingStrategyPlan | null;
  if (!frozen) return;
  await prisma.marketingStrategy.create({
    data: {
      projectId: lane.cusoProjectId,
      plan: jsonInput(monthPlanFromTomorrow(frozen, new Date())),
      authorSokoBotId: lane.cusoBotId,
    },
  });
}

/**
 * Sets the lane up for a Cuso chat case. For the replies case: a published
 * Instagram post with the eval comments under it. The post has no external
 * id, so collecting comments reads these and asks no network. Returns each
 * comment's id by its key.
 */
export async function prepareCmoChatCase(
  lane: EvalLaneRecord,
  setup: CmoChatSetup,
): Promise<{ comments?: Record<string, string>; signalIds?: string[] }> {
  if (setup === "cmo-plan" || setup === "cmo-plan-ads") {
    await prepareCmoPlan(lane, setup === "cmo-plan-ads");
    return {};
  }
  if (isCompetitorSetup(setup)) {
    await prepareCmoChat(lane, true);
    return prepareCompetitorCase(lane, setup);
  }
  await prepareCmoChat(lane, setup !== "cmo-new-client");
  if (
    setup === "cmo-competitor-ads" ||
    setup === "cmo-competitor-landing-page"
  ) {
    // The landing page cites what the week's check stored of the competitors.
    await prepareCompetitorCase(
      lane,
      setup === "cmo-competitor-ads"
        ? "cmo-competitors-quiet"
        : "cmo-competitors",
    );
    await prepareCompetitorAdsCase(lane);
    return {};
  }
  if (setup === "cmo-seo-skipped") {
    const skipped = {
      status: "dismissed",
      title: "The best Calendly alternatives for teams",
    };
    await prisma.projectSeoSuggestion.upsert({
      where: {
        projectId_key: {
          projectId: lane.cusoProjectId,
          key: "article:calendly alternative",
        },
      },
      create: {
        projectId: lane.cusoProjectId,
        kind: "article",
        key: "article:calendly alternative",
        source: "cuso",
        keyword: "calendly alternative",
        why: "Buyers comparing schedulers search this.",
        body: "## Why teams switch\n## How Cal.com compares",
        evidence: [],
        ...skipped,
      },
      update: skipped,
    });
    // The numbers for that search and its neighbours, as keyword research
    // stored them: the case then needs no paid research to reach the refusal.
    const cuso = await findCusoForBot(lane.cusoBotId);
    if (cuso) {
      const market = await cmoSeoMarket(cuso);
      const key = `calendly alternative|${market.countryCode}|${market.languageCode}`;
      const research = {
        payload: {
          topic: "calendly alternative",
          countryCode: market.countryCode,
          languageCode: market.languageCode,
          ideas: [
            ["calendly alternative", 9900, 45],
            ["free calendly alternative", 2400, 38],
            ["open source scheduling software", 880, 22],
            ["scheduling software for teams", 1300, 41],
          ].map(([keyword, searchVolume, difficulty]) => ({
            keyword,
            searchVolume,
            difficulty,
            intent: "commercial",
            cpc: null,
          })),
        },
        observedAt: new Date(),
      };
      await prisma.projectSeoResearch.upsert({
        where: {
          projectId_kind_key: {
            projectId: lane.cusoProjectId,
            kind: "keyword_ideas",
            key,
          },
        },
        create: {
          projectId: lane.cusoProjectId,
          kind: "keyword_ideas",
          key,
          ...research,
        },
        update: research,
      });
    }
    return {};
  }
  if (setup !== "cmo-comments") return {};
  await prisma.socialComment.deleteMany({
    where: { projectId: lane.cusoProjectId },
  });
  const now = Date.now();
  const post = await prisma.socialPost.create({
    data: {
      projectId: lane.cusoProjectId,
      workspaceId: lane.workspaceId,
      creatorSokoBotId: lane.cusoBotId,
      provider: "instagram",
      text: "Scheduling should take one link, not ten emails. Share your Cal link and let people pick a time that works.",
      status: "PUBLISHED",
      publishedAt: new Date(now - 6 * 60 * 60_000),
    },
    select: { id: true },
  });
  const ids: Record<string, string> = {};
  for (const [index, comment] of CMO_EVAL_COMMENTS.entries()) {
    const created = await prisma.socialComment.create({
      data: {
        projectId: lane.cusoProjectId,
        socialPostId: post.id,
        provider: "instagram",
        externalCommentId: `eval-${lane.lane}-${post.id}-${comment.key}`,
        authorName: comment.author,
        text: comment.text,
        commentedAt: new Date(now - (60 - index * 10) * 60_000),
      },
      select: { id: true },
    });
    ids[comment.key] = created.id;
  }
  return { comments: ids };
}

/**
 * The picture of the chat post case: started as a job with a reference
 * library image. No check where the library is not set up.
 */
export async function styledPictureChecks(
  lane: EvalLaneRecord,
  since: Date,
): Promise<ScenarioCheck[]> {
  if (!referenceLibraryAvailable()) return [];
  const styled = await prisma.projectImageJob.count({
    where: {
      projectId: lane.cusoProjectId,
      createdAt: { gte: since },
      referenceLibraryIds: { isEmpty: false },
    },
  });
  return [
    {
      label: "Starts the picture in a reference library style",
      pass: styled > 0,
      actual: `${styled} styled job${styled === 1 ? "" : "s"}`,
    },
  ];
}

/**
 * How each comment was handled, from the turn's handle_social_comment
 * calls: every comment once, and the action each one calls for.
 */
export function commentChecks(
  calls: readonly { capability: string; input: unknown }[],
  ids: Record<string, string>,
): ScenarioCheck[] {
  const actions = new Map<string, string>();
  for (const call of calls) {
    if (call.capability !== "handle_social_comment") continue;
    const input = call.input as { commentId?: unknown; action?: unknown };
    if (
      typeof input?.commentId === "string" &&
      typeof input.action === "string"
    )
      actions.set(input.commentId, input.action);
  }
  return [
    {
      label: "Handles every comment",
      pass: Object.values(ids).every((id) => actions.has(id)),
      actual: `${actions.size} of ${Object.keys(ids).length} handled`,
    },
    ...CMO_EVAL_COMMENTS.map((comment) => {
      const action = actions.get(ids[comment.key] ?? "") ?? "none";
      return {
        label: `${comment.key}: ${comment.expect.join(" or ")}`,
        pass: (comment.expect as readonly string[]).includes(action),
        actual: action,
      };
    }),
  ];
}

export async function startCmoCase(
  evalCase: CmoEvalCase,
  lane: EvalLaneRecord,
  _context: CaseContext,
): Promise<CaseStart> {
  if (await cusoIsBusy(lane)) return { kind: "busy" };
  if (evalCase.kind === "cmo-month") {
    const frozen = parseMarketingPlan(evalCase.plan) as MarketingStrategyPlan;
    if (!frozen) throw new Error("The frozen plan does not parse");
    const cuso = await pointCusoAt(lane, evalCase.brand, evalCase.brandBrain);
    if (evalCase.pictures) await captureCmoHomepage(cuso);
    // Core starts at most four production runs a day per Cuso; a lane makes
    // several months a day, so earlier months' runs count as yesterday's.
    // createdAt and the cap's window are PostgreSQL time.
    const now = (await databaseNow()).getTime();
    await prisma.sokoBotTurn.updateMany({
      where: {
        sokoBotId: lane.cusoBotId,
        clientTurnId: { startsWith: CMO_PRODUCTION_TURN_PREFIX },
        createdAt: { gt: new Date(now - DAY_MS) },
      },
      data: { createdAt: new Date(now - DAY_MS - 60 * 60_000) },
    });
    const plan = evalCase.timed
      ? changeRequestPlan(new Date())
      : monthPlanFromTomorrow(frozen, new Date());
    await connectPlanChannels(lane, plan);
    const strategy = await prisma.marketingStrategy.create({
      data: {
        projectId: lane.cusoProjectId,
        plan: jsonInput(plan),
        authorSokoBotId: lane.cusoBotId,
      },
      select: { id: true },
    });
    await approveMarketingStrategy({
      projectId: lane.cusoProjectId,
      workspaceId: lane.workspaceId,
      userId: lane.userId,
      strategyId: strategy.id,
    });
    await advanceCmoProduction(cuso);
    return {
      kind: "started",
      turnId: null,
      state: { strategyId: strategy.id },
    };
  }
  if (evalCase.kind === "cmo-research") {
    const cuso = await pointCusoAt(lane, evalCase.brand, null);
    const { turnId } = await startCmoResearch(cuso, lane.userId);
    return { kind: "started", turnId, state: {} };
  }
  await pointCusoAt(lane, evalCase.brand, evalCase.brandBrain);
  if (evalCase.brand.testerCredits)
    await grantCmoTesterCredits({
      projectId: lane.cusoProjectId,
      organizationId: lane.organizationId,
    });
  const { turnId } = await requestCmoStrategy({
    userId: lane.userId,
    projectId: lane.cusoProjectId,
    siteLanguage: evalCase.brand.siteLanguage,
  });
  return { kind: "started", turnId, state: {} };
}

/** How long after the plan turn settles a finish turn may take to start. */
const FINISH_START_GRACE_MS = 60_000;

/** The lane's newest draft is short of its weeks, pace or cadences: a finish turn follows. */
async function monthStillShort(
  lane: EvalLaneRecord,
  rules: PlanReviewOptions,
): Promise<boolean> {
  const saved = await newestMarketingStrategy(lane.cusoProjectId);
  const plan = parseMarketingPlan(saved?.plan);
  return plan !== null && cmoPromiseGaps(plan, rules).length > 0;
}

async function settledTurn(turnId: string) {
  return prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: {
      updatedAt: true,
      status: true,
      errorKind: true,
      errorDetail: true,
      finalAnswer: true,
      versionId: true,
    },
  });
}

async function cancelMonthPosts(strategyId: string) {
  // Nothing of an eval month may stay scheduled.
  await prisma.socialPost.updateMany({
    where: {
      marketingStrategyId: strategyId,
      status: { in: [...PLANNED_MONTH_POST_STATUSES] },
    },
    data: {
      status: "CANCELED",
      canceledAt: new Date(),
      revision: { increment: 1 },
    },
  });
}

// Scoped by the approval's id prefix and the parent chain, not by time: the
// turns' createdAt is PostgreSQL time and the case start is the host's.
async function monthProductionTurns(botId: string, prefix: string) {
  const select = {
    id: true,
    clientTurnId: true,
    status: true,
    errorKind: true,
    errorDetail: true,
  } as const;
  let frontier = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: botId,
      source: "EVENT",
      clientTurnId: { startsWith: prefix },
    },
    select,
  });
  const turns = new Map(frontier.map((turn) => [turn.id, turn]));
  while (frontier.length) {
    const children = await prisma.sokoBotTurn.findMany({
      where: {
        sokoBotId: botId,
        parentTurnId: { in: frontier.map((turn) => turn.id) },
      },
      select,
    });
    frontier = children.filter((turn) => !turns.has(turn.id));
    for (const turn of frontier) turns.set(turn.id, turn);
  }
  return [...turns.values()];
}

/**
 * How the month's pictures were made, from Core's own jobs: each in a
 * reference library style, no reference on two pieces and, for the pictures
 * month, the homepage's screenshot sent with a style and every slide with
 * its own words. No check where the library is not set up.
 */
async function monthPictureChecks(
  lane: EvalLaneRecord,
  strategyId: string,
  pictures: boolean,
): Promise<ScenarioCheck[]> {
  if (!referenceLibraryAvailable()) return [];
  const rows = await prisma.projectImageJob.findMany({
    where: {
      projectId: lane.cusoProjectId,
      idempotencyKey: { startsWith: `cmo-media:${strategyId}:` },
    },
    select: {
      idempotencyKey: true,
      referenceLibraryIds: true,
      referenceFileIds: true,
    },
  });
  // A video's still is animated, not posted: it takes no style.
  const jobs = rows.filter(
    (job) => job.idempotencyKey.split(":")[4] === "image",
  );
  if (jobs.length === 0 && !pictures) return [];
  const plain = jobs.filter((job) => job.referenceLibraryIds.length === 0);
  const pieceOf = new Map<string, Set<string>>();
  for (const job of jobs) {
    const [reference] = job.referenceLibraryIds;
    const piece = job.idempotencyKey.split(":")[2];
    if (!reference || !piece) continue;
    pieceOf.set(reference, (pieceOf.get(reference) ?? new Set()).add(piece));
  }
  const shared = [...pieceOf.values()].filter((pieces) => pieces.size > 1);
  const checks: ScenarioCheck[] = [
    {
      label: "Every picture is in a reference library style",
      pass: jobs.length > 0 && plain.length === 0,
      actual: `${jobs.length - plain.length} of ${jobs.length} picture jobs styled`,
    },
    {
      label: "No reference on two pieces",
      pass: shared.length === 0,
      actual: `${pieceOf.size} references, ${shared.length} shared`,
    },
  ];
  if (!pictures) return checks;
  const posts = await prisma.socialPost.findMany({
    where: { marketingStrategyId: strategyId },
    select: { planning: true, media: true },
  });
  // Core places the page itself on a styled picture; the model never gets it.
  const showsPage = posts.filter((post) => {
    const planning = parseSocialPostPlanning(post.planning);
    return Boolean(
      planning?.styleReferenceId && planning.visualFileIds?.length,
    );
  });
  const placed = showsPage.filter(
    (post) => Array.isArray(post.media) && post.media.length > 0,
  );
  const sentPage = jobs.filter(
    (job) =>
      job.referenceLibraryIds.length > 0 && job.referenceFileIds.length > 0,
  );
  const carousels = posts.flatMap((post) => {
    const planning = parseSocialPostPlanning(post.planning);
    return planning?.slides?.length ? [planning] : [];
  });
  return [
    ...checks,
    {
      label: "The homepage's screenshot sits inside a styled picture",
      pass: placed.length > 0 && sentPage.length === 0,
      actual: `${placed.length} styled piece${placed.length === 1 ? "" : "s"} with the page placed, ${sentPage.length} job${sentPage.length === 1 ? "" : "s"} sent it to the model`,
    },
    {
      // Every piece given the screenshot would show it in each picture.
      label: "Only a piece that shows the page gets the screenshot",
      pass: showsPage.length <= 1,
      actual: `${showsPage.length} pieces with a brand picture`,
    },
    {
      label: "Each carousel slide has its own words",
      pass:
        carousels.length > 0 &&
        carousels.every(
          (planning) =>
            (planning.slideHeadlines?.length ?? 0) >=
            (planning.slides?.length ?? 0),
        ),
      actual: carousels
        .map(
          (planning) =>
            `${planning.id}: ${planning.slideHeadlines?.length ?? 0} of ${planning.slides?.length ?? 0}`,
        )
        .join(", "),
    },
  ];
}

/**
 * Most input tokens production may read per piece in the timed month. A
 * regression guard, not a target: on 28 pieces Cuso's own steps and the
 * rewrite run dominate (cmo-v5 147,000, cmo-v6 156,000 to 181,000); on
 * NMKR's 171-post month cmo-v5 read 380,000 a piece and cmo-v6 32,000 to
 * 64,000.
 */
const TIMED_TOKENS_PER_PIECE = 200_000;
/** How soon after approval every word of the timed month is written. */
const TIMED_WORDS_MS = 15 * 60_000;

/**
 * What making the month took, from Core's own records: when the last words
 * were saved and the media settled, and what production's turns read, wrote
 * and cost. Core's month writer counts as the turn that called it.
 */
export async function monthProductionMetrics(input: {
  turnIds: readonly string[];
  /** The first pass's runs: words are timed on them, not on the rewrite. */
  madeBy: readonly string[];
  projectId: string;
  strategyId: string;
  startedAt: Date;
}) {
  const turnIds = [...input.turnIds];
  const [turns, writes, jobs, coreWrote] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: { id: { in: turnIds } },
      select: { usage: true, costUsdMicros: true, overheadCostUsdMicros: true },
    }),
    prisma.sokoBotToolCall.aggregate({
      where: {
        turnId: { in: [...input.madeBy] },
        capability: "update_social_post",
        status: "COMPLETED",
      },
      _max: { committedAt: true },
    }),
    prisma.projectImageJob.aggregate({
      where: {
        projectId: input.projectId,
        idempotencyKey: { startsWith: `cmo-media:${input.strategyId}:` },
      },
      _min: { createdAt: true },
      _max: { settledAt: true },
    }),
    prisma.sokoBotToolCall.count({
      where: {
        turnId: { in: turnIds },
        capability: "write_month_pieces",
        status: "COMPLETED",
      },
    }),
  ]);
  const tokens = (
    turn: (typeof turns)[number],
    key: "inputTokens" | "outputTokens",
  ) => Number((turn.usage as Record<string, unknown> | null)?.[key] ?? 0) || 0;
  const minutes = (from?: Date | null, to?: Date | null) =>
    from && to
      ? Math.round((to.getTime() - from.getTime()) / 6_000) / 10
      : null;
  return {
    wordsMinutes: minutes(input.startedAt, writes._max.committedAt),
    mediaMinutes: minutes(jobs._min.createdAt, jobs._max.settledAt),
    inputTokens: turns.reduce(
      (sum, turn) => sum + tokens(turn, "inputTokens"),
      0,
    ),
    outputTokens: turns.reduce(
      (sum, turn) => sum + tokens(turn, "outputTokens"),
      0,
    ),
    costUsd:
      turns.reduce(
        (sum, turn) =>
          sum +
          Number(turn.costUsdMicros) +
          Number(turn.overheadCostUsdMicros ?? 0),
        0,
      ) / 1e6,
    coreWrote,
  };
}

/** The month's pieces once Core says they are made and Jev is done reading. */
async function pollMonth(
  evalCase: Extract<CmoEvalCase, { kind: "cmo-month" }>,
  lane: EvalLaneRecord,
  state: unknown,
  context: CaseContext,
): Promise<CasePoll> {
  const strategyId = (state as { strategyId?: string } | null)?.strategyId;
  if (!strategyId)
    return {
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: {},
        error: "The month case lost its strategy",
        turnIds: [],
      },
    };
  const cuso = await findCusoForBot(lane.cusoBotId);
  if (!cuso) throw new Error(`Eval lane ${lane.lane} has no Cuso`);
  const approval = await prisma.marketingStrategy.findUniqueOrThrow({
    where: {
      id: strategyId,
      projectId: lane.cusoProjectId,
      authorSokoBotId: lane.cusoBotId,
    },
    select: { approvedAt: true },
  });
  const timedOut =
    (await databaseNow()).getTime() - context.startedAt.getTime() >=
    MONTH_TIMEOUT_MS;
  if (approval.approvedAt) {
    // Production IDs bind retries to the current approval, including rewrites.
    const prefix = `${CMO_PRODUCTION_TURN_PREFIX}${lane.cusoBotId}:${approval.approvedAt.getTime()}:`;
    const productionTurns = await monthProductionTurns(lane.cusoBotId, prefix);
    const exhausted = productionTurns.find(
      (turn) => evalInfrastructureFailure(turn)?.stopsRun,
    );
    if (exhausted) {
      const active = productionTurns.filter(
        (turn) => !SETTLED_TURN_STATUSES.includes(turn.status),
      );
      if (active.length && !timedOut) return { kind: "waiting" };
      const outcome = infrastructureCaseOutcome(exhausted.id, exhausted, {
        strategyId,
      });
      if (outcome) {
        try {
          // The month deadline also bounds existing background/watch work.
          await Promise.all(
            active.map((turn) => sokoBotControlPlane.expireTurn(turn.id)),
          );
          await cancelMonthPosts(strategyId);
        } catch {
          // The runner turns thrown poll errors into terminal results. Keep the
          // lane here until its writers and unsent posts are safely stopped.
          return { kind: "waiting" };
        }
        return {
          kind: "done",
          outcome: {
            ...outcome,
            turnIds: productionTurns.map((turn) => turn.id),
          },
        };
      }
    }
  }
  // The cron moves a month on every ten minutes; the eval does not wait.
  const production = await advanceCmoProduction(cuso);
  const version = await prisma.marketingStrategy.findUniqueOrThrow({
    where: { id: strategyId },
    select: { monthReview: true, plan: true },
  });
  const review = parseCmoMonthReview(version.monthReview);
  const reviewed = review && (review.round === 2 || !review.rewriteRunId);
  // Stuck: today's runs ended with pieces missing; the cron would try tomorrow.
  if (!reviewed && !timedOut && production.state !== "stuck")
    return { kind: "waiting" };

  const turns = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: lane.cusoBotId,
      createdAt: { gte: context.startedAt },
    },
    select: { id: true },
  });
  const posts = await prisma.socialPost.findMany({
    where: { marketingStrategyId: strategyId, status: { not: "CANCELED" } },
    select: {
      id: true,
      provider: true,
      text: true,
      planning: true,
      media: true,
    },
  });
  const plan = parseMarketingPlan(version.plan) as MarketingStrategyPlan | null;
  const pieces = plan?.calendar.length ?? 0;
  const files = await Promise.all(
    (plan?.calendar ?? []).filter(isMarketingFilePiece).map(async (entry) => {
      const text = await readMarketingPieceText(
        { id: strategyId },
        entry.id,
      ).catch(() => null);
      return text
        ? `${entry.id} (${entry.channel}/${entry.format}): ${text}`
        : null;
    }),
  );
  const written = posts.filter((post) => {
    const planning = post.planning as { brief?: unknown; title?: unknown };
    return post.text !== planning?.brief && post.text !== planning?.title;
  });
  const productionTurns = approval.approvedAt
    ? await monthProductionTurns(
        lane.cusoBotId,
        `${CMO_PRODUCTION_TURN_PREFIX}${lane.cusoBotId}:${approval.approvedAt.getTime()}:`,
      )
    : [];
  const metrics = await monthProductionMetrics({
    turnIds: productionTurns.map((turn) => turn.id),
    madeBy: productionTurns
      .filter((turn) => !turn.clientTurnId?.includes(":review:"))
      .map((turn) => turn.id),
    projectId: lane.cusoProjectId,
    strategyId,
    // Set by Core like the receipts it is compared with; the case's own
    // start is PostgreSQL time, an hour off on a local database.
    startedAt: approval.approvedAt ?? context.startedAt,
  });
  const bot = await prisma.sokoBot.findUnique({
    where: { id: lane.cusoBotId },
    select: { versionId: true },
  });
  const coreWrites = cmoWritesMonthAtOnce(
    getSokoBotVersion(bot?.versionId).skills,
  );
  const reads = Object.entries(review?.writing ?? {});
  const flagged = reads.filter(
    ([, read]) =>
      !read.followsSkill || !read.soundsLikeBrand || read.problems.length > 0,
  );
  const checks = [
    {
      label: "Month made",
      pass: production.state === "ready",
      actual: timedOut
        ? `${production.state} after 3 hours`
        : `${production.ready} of ${production.total} pieces ready`,
    },
    {
      label: "Every Social post written",
      pass: posts.length > 0 && written.length === posts.length,
      actual: `${written.length} of ${posts.length} written (${pieces} pieces planned)`,
    },
    {
      label: "Jev read the month",
      pass: reads.length > 0,
      actual: review
        ? `round ${review.round}, ${reads.length} read`
        : "no review",
    },
    // The pictures, variety and openings months are scored on what they
    // test: their few posts are too few for a share of flagged ones to mean
    // anything, and the other month cases measure the writing.
    ...(evalCase.pictures || evalCase.variety || evalCase.openings
      ? []
      : [
          {
            label: `Jev flags at most ${Math.round(MAX_FLAGGED_SHARE * 100)}% of pieces`,
            pass:
              reads.length > 0 &&
              flagged.length / reads.length <= MAX_FLAGGED_SHARE,
            actual: flagged.length
              ? flagged
                  .map(
                    ([id, read]) =>
                      `${id}: ${[
                        ...read.missed,
                        ...read.problems,
                        ...(read.soundsLikeBrand ? [] : ["brand voice"]),
                      ].join(", ")}`,
                  )
                  .join(" · ")
                  .slice(0, 600)
              : "none flagged",
          },
        ]),
    ...(await monthPictureChecks(lane, strategyId, evalCase.pictures ?? false)),
    ...(evalCase.variety
      ? await pictureVarietyChecks(strategyId, lane.cusoProjectId)
      : []),
    ...(evalCase.openings
      ? linkedInOpeningChecks(posts, review?.writing ?? {})
      : []),
    ...(evalCase.newsletter ? [newsletterIssueCheck(plan, files)] : []),
    ...(coreWrites
      ? [
          {
            label: "Core wrote the month (write_month_pieces)",
            pass: metrics.coreWrote > 0,
            actual: `${metrics.coreWrote} write_month_pieces call${metrics.coreWrote === 1 ? "" : "s"}`,
          },
        ]
      : []),
    ...(evalCase.timed
      ? [
          {
            label: `Every word written within ${TIMED_WORDS_MS / 60_000} minutes of approval`,
            pass:
              metrics.wordsMinutes !== null &&
              metrics.wordsMinutes * 60_000 <= TIMED_WORDS_MS,
            actual: `${metrics.wordsMinutes ?? "?"} minutes`,
          },
          {
            label: `At most ${TIMED_TOKENS_PER_PIECE.toLocaleString("en-US")} input tokens a piece`,
            pass:
              pieces > 0 &&
              metrics.inputTokens / pieces <= TIMED_TOKENS_PER_PIECE,
            actual: `${Math.round(metrics.inputTokens / Math.max(1, pieces)).toLocaleString("en-US")} a piece (${metrics.inputTokens.toLocaleString("en-US")} in, ${metrics.outputTokens.toLocaleString("en-US")} out, $${metrics.costUsd.toFixed(2)}, media ${metrics.mediaMinutes ?? "?"} minutes)`,
          },
        ]
      : []),
  ];
  await cancelMonthPosts(strategyId);
  return {
    kind: "done",
    outcome: {
      status: checks.every((check) => check.pass) ? "PASSED" : "FAILED",
      checks,
      output: {
        posts: posts.map(
          (post) =>
            `${post.provider}${Array.isArray(post.media) && post.media.length ? " (with media)" : ""}: ${post.text}`,
        ),
        files: files.filter((file) => file !== null),
        production: { pieces, ...metrics },
      },
      turnIds: turns.map((turn) => turn.id),
    },
  };
}

export async function pollCmoCase(
  evalCase: CmoEvalCase,
  lane: EvalLaneRecord,
  result: { turnId: string | null; state: unknown },
  context: CaseContext,
): Promise<CasePoll> {
  if (evalCase.kind === "cmo-month")
    return pollMonth(evalCase, lane, result.state, context);
  if (!result.turnId)
    return {
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: {},
        error: "The case has no turn",
        turnIds: [],
      },
    };
  const turn = await settledTurn(result.turnId);
  if (!SETTLED_TURN_STATUSES.includes(turn.status)) {
    if (
      (await databaseNow()).getTime() - context.startedAt.getTime() <
      CMO_TURN_TIMEOUT_MS
    )
      return { kind: "waiting" };
    await endTurn(result.turnId);
    return {
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: {},
        error: "Cuso's turn did not settle in 45 minutes",
        turnIds: [result.turnId],
      },
    };
  }
  // A month left short of four weeks gets finish turns after the plan turn
  // (afterCmoTurn); the case is the whole month, so it waits for them.
  const finishes =
    evalCase.kind === "cmo-strategy"
      ? await prisma.sokoBotTurn.findMany({
          where: {
            sokoBotId: lane.cusoBotId,
            clientTurnId: {
              startsWith: `${STRATEGY_TURN_PREFIX}${lane.cusoBotId}:finish:`,
            },
            createdAt: { gte: context.startedAt },
          },
          select: { id: true, status: true },
        })
      : [];
  if (
    finishes.some((finish) => !SETTLED_TURN_STATUSES.includes(finish.status)) &&
    (await databaseNow()).getTime() - context.startedAt.getTime() <
      CMO_TURN_TIMEOUT_MS
  )
    return { kind: "waiting" };
  if (
    evalCase.kind === "cmo-strategy" &&
    finishes.length === 0 &&
    (await monthStillShort(
      lane,
      turn.versionId
        ? cmoStrategyRules(getSokoBotVersion(turn.versionId).skills)
        : {},
    )) &&
    (await databaseNow()).getTime() - (turn.updatedAt?.getTime() ?? 0) <
      FINISH_START_GRACE_MS
  )
    return { kind: "waiting" };
  const infrastructure = infrastructureCaseOutcome(result.turnId, turn, {
    answer: turn.finalAnswer,
    turnStatus: turn.status,
    errorKind: turn.errorKind,
  });
  if (infrastructure) return { kind: "done", outcome: infrastructure };
  const completed = {
    label: "Turn completed",
    pass: turn.status === "COMPLETED",
    actual: turn.errorKind ? `${turn.status} (${turn.errorKind})` : turn.status,
  };
  const projectId = lane.cusoProjectId;
  let outcome: Omit<CaseOutcome, "status" | "turnIds">;
  if (evalCase.kind === "cmo-research") {
    const saved = await prisma.brandBrain.findUnique({ where: { projectId } });
    const { brain, checks } = brandBrainChecks(evalCase.brand, saved?.body);
    outcome = {
      checks: [completed, ...checks],
      output: {
        answer: turn.finalAnswer,
        summary: brain?.summary ?? null,
        offers:
          brain?.offers.map((offer) => `${offer.name} (${offer.price})`) ??
          null,
      },
    };
  } else {
    const saved = await newestMarketingStrategy(projectId);
    const { strategy, checks } = strategyChecks(
      evalCase.brand,
      saved?.plan,
      turn.versionId
        ? cmoStrategyRules(getSokoBotVersion(turn.versionId).skills)
        : {},
    );
    if (evalCase.brand.focus === "claims" && strategy)
      checks.push(...(await claimChecks(strategy)));
    if (evalCase.brand.testerCredits && strategy) {
      const level = await cmoPlanLevel(projectId, await databaseNow());
      const made = cmoMonthAtLevel(strategy.calendar, strategy.channels, level);
      const live = strategy.calendar.filter(
        (entry) => entry.status !== "skipped",
      );
      checks.push({
        label: "Core makes the whole month on Tester credits",
        // A piece past the month's video cap is the review's to name.
        pass: level === "all_in",
        actual: `${level}: ${made.made.size} of ${live.length} pieces`,
      });
    }
    outcome = {
      checks: [completed, ...checks],
      output: {
        answer: turn.finalAnswer,
        summary: strategy?.summary ?? null,
        offer: strategy?.offer?.what ?? null,
        coreOffer: strategy?.ladder?.core.what ?? null,
        contentLanguage: strategy?.contentLanguage ?? null,
        pillars: strategy?.pillars.map((pillar) => pillar.name) ?? null,
        calendar:
          strategy?.calendar
            .filter((entry) => entry.status !== "skipped")
            .map((entry) => `${entry.date} ${entry.channel}: ${entry.title}`) ??
          null,
      },
    };
  }
  return {
    kind: "done",
    outcome: {
      ...outcome,
      status: outcome.checks.every((check) => check.pass) ? "PASSED" : "FAILED",
      turnIds: [result.turnId, ...finishes.map((finish) => finish.id)],
    },
  };
}

/** An issue longer than this does not read in a minute. */
const NEWSLETTER_MAX_WORDS = 450;

/** The month's newsletter issue: filed, with a subject line, and short. */
export function newsletterIssueCheck(
  plan: Pick<MarketingStrategyPlan, "calendar"> | null,
  files: readonly (string | null)[],
): { label: string; pass: boolean; actual: string } {
  const ids = (plan?.calendar ?? [])
    .filter((entry) => entry.channel === "newsletter")
    .map((entry) => entry.id);
  const issue = files.find(
    (file) => file !== null && ids.some((id) => file.startsWith(`${id} (`)),
  );
  const words = issue?.split(/\s+/).filter(Boolean).length ?? 0;
  const subject = /subject/i.test(issue ?? "");
  return {
    label: "The newsletter issue is written, with its subject line",
    pass: Boolean(issue) && subject && words <= NEWSLETTER_MAX_WORDS,
    actual: issue
      ? `${words} words${subject ? "" : ", no subject line"}`
      : "no issue filed",
  };
}
