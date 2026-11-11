import {
  CMO_PRODUCTION_TURN_PREFIX,
  type MarketingStrategyPlan,
  type ScenarioCheck,
} from "@sokosumi/soko-bot";
import { isProjectSocialProvider } from "@/config/social-providers";
import prisma from "@/lib/db/prisma";
import { EVAL_CONNECTED_ACCOUNT_PREFIX } from "@/lib/evals/eval-guard";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { startCmoResearch } from "@/services/cmo-hiring.service";
import { parseCmoMonthReview } from "@/services/cmo-month-review.service";
import { advanceCmoProduction } from "@/services/cmo-production.service";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import {
  approveMarketingStrategy,
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";
import { SETTLED_TURN_STATUSES } from "@/services/soko-bot-lab-scenario.service";
import { brandBrainChecks, strategyChecks } from "./cmo-brand-checks";
import type {
  CaseContext,
  CaseOutcome,
  CasePoll,
  CaseStart,
} from "./eval-case-runner";
import {
  CMO_COMMENT_BRAND,
  CMO_EVAL_BRANDS,
  CMO_EVAL_COMMENTS,
  type CmoEvalCase,
} from "./eval-cmo-cases";
import type { EvalLaneRecord } from "./eval-lanes.service";
import brandBrains from "./fixtures/cmo-brand-brains.json";
import monthPlans from "./fixtures/cmo-month-plans.json";

/** Research reads a whole site; a plan is one long turn. */
const CMO_TURN_TIMEOUT_MS = 45 * 60_000;
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

async function cusoIsBusy(lane: EvalLaneRecord) {
  return (
    (await prisma.sokoBotTurn.count({
      where: {
        sokoBotId: lane.cusoBotId,
        status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
      },
    })) > 0
  );
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
  if (brandBrain)
    await prisma.brandBrain.create({
      data: { projectId, body: brandBrain as object, updatedAt: new Date() },
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

/** One title per piece, none repeating a message, one SEO comparison page. */
const CHANGE_REQUEST_TITLES = [
  "One booking link for the whole team",
  "Cal.com vs Calendly for team booking",
  "Round-robin without spreadsheets",
  "Embed a booking widget in five lines",
  "Why reps stop chasing meeting times",
  "This week's team scheduling tip",
  "Fix the title of the team booking page",
  "How routing forms pick the right rep",
  "Booking pages that sales teams share",
  "Collective events for panel interviews",
  "Webhooks after every new booking",
  "A Teams trial checklist for week one",
  "Monthly recap of booking flows",
  "Clearer headings on the pricing page",
  "Buffer times that protect focus hours",
  "Routing inbound demos by company size",
  "Group availability across time zones",
  "Booking API rate limits explained",
  "Managed event types for large teams",
  "Five settings admins change first",
  "A meta description for the routing page",
  "Reminders that cut no-shows",
  "Open source scheduling for regulated teams",
  "Handing a lead to the next rep",
  "Self-hosting Cal.com on your own server",
  "Insights that show booking volume",
  "What changed in team booking this month",
  "A shorter intro on the enterprise page",
];

/** A week of the change request's month: LinkedIn three times, four other formats. */
const CHANGE_REQUEST_WEEK = [
  { channel: "linkedin", format: "post" },
  { channel: "seo", format: "article" },
  { channel: "linkedin", format: "image" },
  { channel: "x", format: "post" },
  { channel: "linkedin", format: "post" },
  { channel: "newsletter", format: "issue" },
  { channel: "seo", format: "page_fix" },
] as const;

const CHANGE_REQUEST_CHANNELS = [
  {
    channel: "linkedin",
    cadence: "3 posts a week",
    why: "Reach operators with concrete team scheduling examples.",
  },
  {
    channel: "seo",
    cadence: "2 pieces a week",
    why: "Answer practical scheduling searches over time.",
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
    CMO_COMMENT_BRAND
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
    // Week one in full, weeks two to four as titles, like a first plan; only
    // LinkedIn pieces carry the template's story.
    calendar: slots.map(({ week, day, piece }, index) => ({
      time: template.time,
      status: "idea" as const,
      campaignId: template.campaignId,
      ...(week === 0 ? { brief: template.brief, why: template.why } : {}),
      ...(piece.channel === "linkedin" && template.story
        ? { story: template.story }
        : {}),
      ...piece,
      id: `${piece.channel}-w${week + 1}-${day}`,
      date: new Date(now.getTime() + (week * 7 + day) * DAY_MS)
        .toISOString()
        .slice(0, 10),
      title: CHANGE_REQUEST_TITLES[index] ?? template.title,
      approach: approaches[index]?.approach ?? template.approach,
      pillar: pillars[index]?.name ?? template.pillar,
    })),
  };
}

/** The lane's Cuso on cal.com with the change request's month, waiting for approval. */
export async function prepareCmoPlan(lane: EvalLaneRecord): Promise<void> {
  const brain = (brandBrains as Record<string, unknown>)[CMO_COMMENT_BRAND];
  await pointCusoAt(lane, brand(CMO_COMMENT_BRAND), brain ?? null);
  await prisma.marketingStrategy.create({
    data: {
      projectId: lane.cusoProjectId,
      plan: changeRequestPlan(new Date()) as object,
      authorSokoBotId: lane.cusoBotId,
    },
  });
}

/**
 * A published Instagram post with the eval comments under it, on the lane's
 * Cuso Project pointed at the comment brand. The post has no external id,
 * so collecting comments reads these and asks no network. Returns each
 * comment's id by its key.
 */
export async function prepareCmoComments(
  lane: EvalLaneRecord,
): Promise<Record<string, string>> {
  const brain = (brandBrains as Record<string, unknown>)[CMO_COMMENT_BRAND];
  await pointCusoAt(lane, brand(CMO_COMMENT_BRAND), brain ?? null);
  await prisma.socialComment.deleteMany({
    where: { projectId: lane.cusoProjectId },
  });
  const now = Date.now();
  const post = await prisma.socialPost.create({
    data: {
      projectId: lane.cusoProjectId,
      workspaceId: lane.workspaceId,
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
  return ids;
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
    // Core starts at most four production runs a day per Cuso; a lane makes
    // several months a day, so earlier months' runs count as yesterday's.
    await prisma.sokoBotTurn.updateMany({
      where: {
        sokoBotId: lane.cusoBotId,
        clientTurnId: { startsWith: CMO_PRODUCTION_TURN_PREFIX },
        createdAt: { gt: new Date(Date.now() - DAY_MS) },
      },
      data: { createdAt: new Date(Date.now() - DAY_MS - 60 * 60_000) },
    });
    const plan = monthPlanFromTomorrow(frozen, new Date());
    await connectPlanChannels(lane, plan);
    const strategy = await prisma.marketingStrategy.create({
      data: {
        projectId: lane.cusoProjectId,
        plan: plan as object,
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
  const { turnId } = await requestCmoStrategy({
    userId: lane.userId,
    projectId: lane.cusoProjectId,
  });
  return { kind: "started", turnId, state: {} };
}

async function settledTurn(turnId: string) {
  return prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { status: true, errorKind: true, finalAnswer: true },
  });
}

/** The month's pieces once Core says they are made and Jev is done reading. */
async function pollMonth(
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
        error: "The month case lost its plan",
        turnIds: [],
      },
    };
  const cuso = await findCusoForBot(lane.cusoBotId);
  if (!cuso) throw new Error(`Eval lane ${lane.lane} has no Cuso`);
  // The cron moves a month on every ten minutes; the eval does not wait.
  const production = await advanceCmoProduction(cuso);
  const version = await prisma.marketingStrategy.findUniqueOrThrow({
    where: { id: strategyId },
    select: { monthReview: true, plan: true },
  });
  const review = parseCmoMonthReview(version.monthReview);
  const reviewed = review && (review.round === 2 || !review.rewriteRunId);
  const timedOut = Date.now() - context.startedAt.getTime() >= MONTH_TIMEOUT_MS;
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
    select: { provider: true, text: true, planning: true, media: true },
  });
  const plan = parseMarketingPlan(version.plan) as MarketingStrategyPlan | null;
  const pieces = plan?.calendar.length ?? 0;
  const written = posts.filter((post) => {
    const planning = post.planning as { brief?: unknown; title?: unknown };
    return post.text !== planning?.brief && post.text !== planning?.title;
  });
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
    {
      label: `Jev flags at most ${Math.round(MAX_FLAGGED_SHARE * 100)}% of pieces`,
      pass:
        reads.length > 0 && flagged.length / reads.length <= MAX_FLAGGED_SHARE,
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
  ];
  // Nothing of an eval month may stay scheduled.
  await prisma.socialPost.updateMany({
    where: { marketingStrategyId: strategyId, status: { not: "PUBLISHED" } },
    data: { status: "CANCELED" },
  });
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
    return pollMonth(lane, result.state, context);
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
    if (Date.now() - context.startedAt.getTime() < CMO_TURN_TIMEOUT_MS)
      return { kind: "waiting" };
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
        offers: brain?.offers.map((offer) => `${offer.name} (${offer.price})`),
      },
    };
  } else {
    const saved = await newestMarketingStrategy(projectId);
    const { strategy, checks } = strategyChecks(evalCase.brand, saved?.plan);
    outcome = {
      checks: [completed, ...checks],
      output: {
        answer: turn.finalAnswer,
        summary: strategy?.summary ?? null,
        offer: strategy?.offer?.what ?? null,
        contentLanguage: strategy?.contentLanguage ?? null,
        pillars: strategy?.pillars.map((pillar) => pillar.name),
        calendar: strategy?.calendar
          .filter((entry) => entry.status !== "skipped")
          .map((entry) => `${entry.date} ${entry.channel}: ${entry.title}`),
      },
    };
  }
  return {
    kind: "done",
    outcome: {
      ...outcome,
      status: outcome.checks.every((check) => check.pass) ? "PASSED" : "FAILED",
      turnIds: [result.turnId],
    },
  };
}
