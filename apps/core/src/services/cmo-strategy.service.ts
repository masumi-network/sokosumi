import { type MarketingStrategy, Prisma } from "@sokosumi/database";
import {
  type BrandBrain,
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoBrandAnswer,
  type CmoBrandQuestion,
  type CmoBrandSectionKey,
  type CmoCalendarEntry,
  type CmoPlanQuestion,
  type CmoStrategySave,
  type CmoStrategySavePart,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  marketingStrategyPlanSchema,
  networkAudiences,
} from "@sokosumi/soko-bot";
import { isCmoChannelFormat, isCmoTalkingFormat } from "@sokosumi/utils";
import { unprocessableEntity } from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import { keepAnswers, sameQuestion } from "@/helpers/question-answers";
import prisma from "@/lib/db/prisma";
import { isEvalCusoProject } from "@/lib/evals/eval-guard";
import {
  posesAsCustomerTestimonial,
  TALKING_VIDEO_TESTIMONIAL_MESSAGE,
} from "@/lib/image-studio/talking-video";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import {
  answerBrandBrainQuestion,
  brandBrainCorrections,
  brandBrainOpenFixes,
  parseBrandBrain,
  requestBrandBrainFix,
  withdrawBrandBrainFix,
} from "@/services/brand-brain.service";
import {
  CmoConflictError,
  CmoNotFoundError,
  type Cuso,
  type CusoTarget,
  cmoRunnerUserId,
  findCusoForBot,
  ONBOARDING_TURN_PREFIX,
  requireCuso,
  startCmoProduction,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
import {
  cmoPictureStyleProblem,
  cmoPieceTakesStyle,
  cmoSceneVisualProblem,
} from "@/services/cmo-media-maker.service";
import {
  CMO_MAX_VIDEOS_PER_MONTH,
  cmoCalendarWeeks,
  cmoFollowCadenceChange,
  cmoMonthShortfall,
  cmoPlanRulesBrokenSince,
  cmoPromiseGaps,
  cmoStrategyRules,
  cmoWithOwnerPace,
} from "@/services/cmo-plan-review.service";
import {
  approvedMarketingStrategy,
  cmoAlsoOnProblem,
  cmoChangeKind,
  isMarketingFilePiece,
  newestMarketingStrategy,
  parseMarketingPlan,
  parseSocialPostPlanning,
  planMarketingStrategyPosts,
  STRATEGY_TURN_PREFIX,
  sameTitle,
} from "@/services/marketing-strategy.service";
import { readMarketingPieceText } from "@/services/marketing-strategy-files.service";
import { referenceLibraryAvailable } from "@/services/reference-library.service";
import {
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "@/services/soko-bot-turn-progress.service";

/**
 * No sandbox on the strategy turn: it plans from the Brand Brain it already
 * has. It writes no drafts or Social posts; once the owner approves and pays,
 * production makes the whole month (cmo-production.service).
 */
const CMO_STRATEGY_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO strategy: plan the next four weeks.",
};

/**
 * Cuso's rhythms and the month's production carry out the approved version;
 * every other turn (a chat, a requested rewrite) works on the newest one.
 */
export function cmoTurnExecutesPlan(turn: {
  source: string;
  clientTurnId: string | null;
}): boolean {
  return (
    turn.source === "SCHEDULE" ||
    (turn.clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX) ?? false)
  );
}

/**
 * The version a turn reads and builds on: while it executes, the approved
 * one (executing rhythms and production never run without one, so only the
 * approval reminder falls back to the waiting draft); otherwise the newest.
 */
export async function cmoWorkingStrategy(
  projectId: string,
  executing: boolean,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy | null> {
  return (
    (executing ? await approvedMarketingStrategy(projectId, db) : null) ??
    (await newestMarketingStrategy(projectId, db))
  );
}

const DAY_MS = 86_400_000;

/** The four weeks a new plan covers: tomorrow through 27 days later. */
export function planWindow(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const day = (offset: number) =>
    new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
  return { start: day(1), end: day(28) };
}

/**
 * The owner's monthly ad budget: stored on the plan as theirs, then Cuso
 * plans the ads (and what they should bring) around exactly that amount.
 * Zero turns paid ads off.
 */
export async function setCmoAdBudget(
  input: CusoTarget & {
    monthly: number;
    currency: string;
  },
  known?: Cuso,
): Promise<{ turnId: string | null; queued: boolean }> {
  const cuso = known ?? (await requireCuso(input));
  const strategy = parseMarketingPlan(
    (await newestMarketingStrategy(cuso.projectId))?.plan,
  );
  if (!strategy) {
    throw new CmoConflictError("Cuso has not written the strategy yet");
  }
  const currency = input.currency.toUpperCase();
  // Busy writing or changing the strategy: the budget waits on the Project,
  // and Cuso plans it as soon as that turn ends (afterCmoTurn).
  const budget = { monthly: input.monthly, currency, userId: input.userId };
  if (await strategyTurnRunning(cuso.sokoBotId)) {
    await prisma.project.update({
      where: { id: cuso.projectId },
      data: { cmoPendingAdBudget: budget },
    });
    return { turnId: null, queued: true };
  }
  if (cuso.pendingAdBudget) {
    await prisma.project.update({
      where: { id: cuso.projectId },
      data: { cmoPendingAdBudget: Prisma.DbNull },
    });
  }
  const started = await requestStrategyForCuso(cuso, {
    userId: input.userId,
    patch: true,
    note:
      input.monthly > 0
        ? `My ad budget is ${currency} ${input.monthly} a month. Plan the ads around exactly that amount and say what it should bring.`
        : "I don't want to spend on ads this month. Leave paid ads out and make the strategy work without them.",
  });
  // The owner's budget is the version Cuso's patch completes: his turn's
  // saves update it, so a budget writes one version.
  // shortcut: a turn that saves before this create adds a second version;
  // its first save takes a model call, so upgrade only if that ever shows.
  await prisma.marketingStrategy.create({
    data: {
      projectId: cuso.projectId,
      authorUserId: input.userId,
      authorTurnId: started.turnId,
      plan: jsonInput(
        withoutUnpaidAds({
          ...strategy,
          // This version is the budget's patch: nothing struck through yet.
          changes: [],
          patched: [],
          ads: {
            expect: "Cuso is updating what this brings.",
            without: "The strategy runs on posts, search and email alone.",
            ...strategy.ads,
            monthly: input.monthly,
            currency,
            setByOwner: true,
          },
        }),
      ),
    },
  });
  return { turnId: started.turnId, queued: false };
}

/** Plans the ad budget the owner set while Cuso was busy, now that he is free. */
async function startQueuedAdBudget(
  cuso: Cuso,
): Promise<{ turnId: string } | null> {
  const budget = cuso.pendingAdBudget;
  if (!budget) return null;
  const started = await setCmoAdBudget(
    { projectId: cuso.projectId, ...budget },
    cuso,
  );
  return started.turnId ? { turnId: started.turnId } : null;
}

/**
 * A plan with no ad budget has no ad pieces: a $0 budget can never start
 * one. A patch can only replace entries, so Cuso's "leave the ads out" once
 * kept one; Core skips them itself.
 */
function withoutUnpaidAds<T extends MarketingStrategyPlan>(plan: T): T {
  if (!plan.ads || plan.ads.monthly > 0) return plan;
  return {
    ...plan,
    calendar: plan.calendar.map((entry) =>
      (entry.channel === "google_ads" || entry.channel === "meta_ads") &&
      entry.status !== "skipped"
        ? { ...entry, status: "skipped" as const }
        : entry,
    ),
  };
}

const AD_CHANNELS = new Set(["google_ads", "meta_ads"]);

/** Whether the Cuso's strategy skill makes ads the owner's Yes or No (cmo-v5). */
async function asksBeforeAds(
  sokoBotId: string,
  db: Prisma.TransactionClient,
): Promise<boolean> {
  const bot = await db.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { versionId: true },
  });
  return (
    bot?.versionId != null &&
    cmoStrategyRules(getSokoBotVersion(bot.versionId).skills).everyNetwork ===
      true
  );
}

/**
 * A strategy without the owner's Yes to ads holds none: no ads channel, no
 * ad piece, nothing about ads in the funnel. An amount Cuso set himself
 * becomes his suggestion. The review asks Cuso for this, but a long month
 * once ended with ads planned after its review rounds ran out.
 */
export function withoutUnaskedAds<T extends MarketingStrategyPlan>(plan: T): T {
  const ads = plan.ads;
  if (ads?.setByOwner && ads.monthly > 0) return plan;
  const isAd = (channel: string) => AD_CHANNELS.has(channel.toLowerCase());
  const firstAd = plan.channels.find((channel) => isAd(channel.channel));
  const suggest =
    ads?.suggest ??
    (ads && ads.monthly > 0 && firstAd
      ? { channel: firstAd.channel.toLowerCase(), monthly: ads.monthly }
      : undefined);
  return {
    ...plan,
    ...(ads
      ? {
          ads: {
            ...ads,
            monthly: 0,
            ...(suggest !== undefined ? { suggest } : {}),
          },
        }
      : {}),
    channels: plan.channels.filter((channel) => !isAd(channel.channel)),
    calendar: plan.calendar.map((entry) =>
      isAd(entry.channel) && entry.status !== "skipped"
        ? { ...entry, status: "skipped" as const }
        : entry,
    ),
    funnel: plan.funnel.map((stage) => ({
      ...stage,
      channels: stage.channels.filter((channel) => !isAd(channel)),
      plays: stage.plays.filter((play) => !isAd(play.channel)),
    })),
  };
}

/** Cuso's newest strategy turn, whatever its state. */
function newestStrategyTurn(sokoBotId: string) {
  return prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId,
      clientTurnId: { startsWith: STRATEGY_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
}

/** The strategy turn still running, if any. */
async function strategyTurnRunning(sokoBotId: string) {
  const turn = await newestStrategyTurn(sokoBotId);
  return turn && (await settledTurnStatus(turn)) === "running" ? turn : null;
}

/**
 * Asks Cuso for a new one-month strategy: he writes a new version, which an
 * owner or admin approves; the approved one keeps running until then. With
 * `patch`, the note changes only the entries it touches (a no, the pace, an
 * ad budget) in a short turn. While a plan is being written, asking again
 * returns that turn ("Looks like us" starts nothing), and a change or patch
 * is refused (the screen holds it until the plan lands).
 */
export async function requestCmoStrategy(
  input: CusoTarget & {
    note?: string;
    siteLanguage?: string;
    patch?: boolean;
  },
): Promise<{ turnId: string }> {
  return requestStrategyForCuso(await requireCuso(input), input);
}

/**
 * The guard every plan request goes through, the ad budget's and the plan
 * answers' too: a change waits until the plan being written lands.
 */
async function requestStrategyForCuso(
  cuso: Cuso,
  input: {
    userId: string;
    note?: string;
    siteLanguage?: string;
    patch?: boolean;
  },
): Promise<{ turnId: string }> {
  const writing = await strategyTurnRunning(cuso.sokoBotId);
  if (writing) {
    // A fix or patch is a short turn: a change waits for it to land. A plain
    // ask gets it back, since the first plan starts once it ends.
    if (cmoChangeKind(writing.clientTurnId) !== null && input.note) {
      throw new CmoConflictError("Cuso is finishing a change");
    }
    if (input.note) {
      throw new CmoConflictError("Cuso is still writing the strategy");
    }
    return { turnId: writing.id };
  }
  return startCmoStrategy(
    cuso,
    input.userId,
    input.note ? { note: input.note, patch: input.patch ?? false } : null,
    input.siteLanguage,
  );
}

/**
 * The first plan starts once the research turn ends with the essentials
 * saved, not when the founder confirms the brand: the founder reads the
 * Brand Brain while Cuso writes. Core runs one turn per bot at a time, so it
 * cannot start while the research turn that saved them still runs. Starts
 * nothing once a plan was started or written; null when nothing started.
 */
export async function startCmoPlanAfterResearch(
  input: {
    sokoBotId: string;
    /** Who asked for the research; Cuso's runner when they are gone. */
    userId: string | null;
  },
  known?: Cuso,
): Promise<{ turnId: string } | null> {
  const cuso = known ?? (await findCusoForBot(input.sokoBotId));
  if (!cuso || !parseBrandBrain(cuso.brandBrain)) return null;
  // An eval lane's research case ends here; its strategy cases ask for
  // their own plan, so one started now would only cost and race them.
  if (await isEvalCusoProject(cuso.projectId)) return null;
  const [turn, version] = await Promise.all([
    newestStrategyTurn(cuso.sokoBotId),
    newestMarketingStrategy(cuso.projectId),
  ]);
  // A fix that ran first is no plan; a plan already started is.
  if (version || (turn && cmoChangeKind(turn.clientTurnId) === null))
    return null;
  const userId = input.userId ?? (await cmoRunnerUserId(cuso));
  if (!userId) return null;
  return startCmoStrategy(cuso, userId, null);
}

/**
 * The owner's words a turn carries: their chat message, or the request a
 * strategy change was started with. Null for Cuso's own runs.
 */
export async function cmoOwnerRequest(turnId: string): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { userMessage: true, source: true },
  });
  const message = turn?.userMessage ?? "";
  const asked = message.match(/The owner asked: (.+)/)?.[1];
  if (asked) return asked;
  return turn?.source === "CHAT" && message ? message : null;
}

/**
 * After any foreground turn of Cuso ends: the first plan when the research
 * (or a brand fix that ran before it) is in, otherwise the next brand fix
 * the owner asked for meanwhile. An everyday chat turn costs one read. After
 * a production run, the month's next step.
 */
export async function afterCmoTurn(input: {
  sokoBotId: string;
  userId: string | null;
  clientTurnId: string | null;
}): Promise<{ turnId: string } | null> {
  // A production run that ended moves the month on now, not at the next
  // ten-minute sync: NMKR's second run waited eight minutes for it.
  if (input.clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX)) {
    await startCmoProduction(input.sokoBotId);
    return null;
  }
  const cuso = await findCusoForBot(input.sokoBotId);
  if (!cuso) return null;
  const mayPlan =
    input.clientTurnId?.startsWith(ONBOARDING_TURN_PREFIX) ||
    cmoChangeKind(input.clientTurnId) === "fix";
  return (
    (mayPlan ? await startCmoPlanAfterResearch(input, cuso) : null) ??
    (await startCmoMonthFinish(input, cuso)) ??
    (await startNextCmoChange(input, cuso)) ??
    (await startQueuedAdBudget(cuso))
  );
}

const FINISH_KIND = "finish";

/** Finish turns in a row after a plan turn, so a month that cannot be finished still ends. */
export const CMO_MONTH_FINISH_TURNS = 2;

/** How many finish turns came before this one in a row; -1 for a turn that is no plan. */
function finishRound(clientTurnId: string | null): number {
  if (!clientTurnId?.startsWith(STRATEGY_TURN_PREFIX)) return -1;
  if (cmoChangeKind(clientTurnId) !== null) return -1;
  const parts = clientTurnId.split(":");
  return parts[3] === FINISH_KIND ? Number(parts[5] ?? 1) : 0;
}

/**
 * A weekly Cuso saves his month a week a call, and once ended his turn with
 * week one saved although the review asked for the rest: NMKR's month came
 * back with 20 posts. Another ended with four weeks at 16 pieces a week
 * against the pace's 43. A draft still short of its weeks, pace or cadences
 * (or the video its funnel promises) when a plan turn ends gets a short
 * turn that adds what is missing.
 */
async function startCmoMonthFinish(
  input: { userId: string | null; clientTurnId: string | null },
  cuso: Cuso,
): Promise<{ turnId: string } | null> {
  const round = finishRound(input.clientTurnId);
  if (round < 0 || round >= CMO_MONTH_FINISH_TURNS) return null;
  const [bot, version] = await Promise.all([
    prisma.sokoBot.findUnique({
      where: { id: cuso.sokoBotId },
      select: { versionId: true },
    }),
    newestMarketingStrategy(cuso.projectId),
  ]);
  if (!bot?.versionId) return null;
  const rules = cmoStrategyRules(getSokoBotVersion(bot.versionId).skills);
  if (!rules.weekly) return null;
  const plan = version?.approvedAt ? null : parseMarketingPlan(version?.plan);
  if (!plan) return null;
  const gaps = cmoPromiseGaps(plan, rules);
  if (gaps.length === 0) return null;
  const userId = input.userId ?? (await cmoRunnerUserId(cuso));
  if (!userId) return null;
  const weeks = cmoCalendarWeeks(plan.calendar);
  const last = plan.calendar
    .filter((entry) => entry.status !== "skipped")
    .map((entry) => entry.date)
    .sort()
    .at(-1);
  return startCmoTurn(cuso, userId, {
    clientTurnId: `${STRATEGY_TURN_PREFIX}${cuso.sokoBotId}:${FINISH_KIND}:${Date.now()}:${round + 1}`,
    message: (weeks < 4
      ? [
          `Finish ${cuso.businessName}'s marketing strategy: its calendar covers ${weeks} of four weeks${last ? `, up to ${last}` : ""}.`,
          weeks === 0
            ? "Save week one with save_strategy part calendar, then each later week with part patch (only that week's entries, new ids)."
            : "Save each missing week with save_strategy part patch, one week a call (only that week's entries, new ids), until the calendar covers four weeks from its first day.",
          "Every week holds the pace's perWeek pieces at each channel's cadence and role, in the mix and pillar shares. Change nothing already saved.",
        ]
      : [
          `Finish ${cuso.businessName}'s marketing strategy: its calendar does not hold what the strategy promises.`,
          ...gaps.map((gap) => `- ${gap}`),
          `Add the missing pieces with save_strategy part patch, one week a call (only that week's new entries, new ids), until every week holds the pace's perWeek pieces and each channel its cadence, in the mix and pillar shares, and each video the funnel promises goes out where it says. Never lower the pace or a posting network's cadence to match: the plan the owner buys decides how much of the month is made. ${
            rules.channelFit
              ? "A video network or a play that promises video gets short videos of its own on that network (a TikTok, a Reel, a YouTube Short) at its cadence; the month keeps at most four talking videos."
              : `The month keeps at most ${CMO_MAX_VIDEOS_PER_MONTH} videos: for a video network or a play that promises video, first add the network to the alsoOn of talking videos already planned (part patch, same id); YouTube or TikTok may take a cadence that matches those videos, and a play may drop the video in its words (part plan).`
          } Change nothing else already saved.`,
        ]
    )
      .concat([
        "When a save is refused or names problems, fix them and save again.",
        "Then tell the owner in one sentence that the month is complete. The strategy card is your report: do not call report_update.",
      ])
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
}

/**
 * The owner says one Brand Brain section is wrong. The fix is stored on the
 * section at once, so it is never lost, and a short turn rewrites that
 * section (and patches the plan it touches). While Cuso is busy the fix
 * waits, and starts when his turn ends.
 */
export async function fixCmoBrandSection(
  input: CusoTarget & { section: CmoBrandSectionKey; note: string },
): Promise<{ turnId: string } | { queued: true }> {
  const cuso = await requireCuso(input);
  const brandBrain = await requestBrandBrainFix(cuso.projectId, {
    section: input.section,
    note: input.note,
  });
  return startQueuedFix(cuso, input.userId, brandBrain);
}

/** Starts the fix just stored, unless Cuso is busy: then it waits for his turn to end. */
async function startQueuedFix(
  cuso: Cuso,
  userId: string,
  brandBrain: BrandBrain,
): Promise<{ turnId: string } | { queued: true }> {
  try {
    const started = await startNextCmoChange(
      { sokoBotId: cuso.sokoBotId, userId },
      { ...cuso, brandBrain },
    );
    return started ?? { queued: true };
  } catch (error) {
    // Out of credits is the owner's to see; a busy bot only means later.
    if (error instanceof CmoConflictError) throw error;
    return { queued: true };
  }
}

/** The fix a no asks for, in the owner's words when they gave some. */
function noFix(question: CmoBrandQuestion): string {
  return `Not true: ${question.statement}${question.note ? ` True instead: ${question.note}` : ""}`;
}

/**
 * The owner answers one of Cuso's Brand Brain questions. The plan starts
 * when the research ends, so a no usually lands while it is written or
 * after: it becomes a fix on its section, which Cuso makes (and patches the
 * plan for) once his current turn ends.
 */
export async function answerCmoBrandQuestion(
  input: CusoTarget & {
    questionId: string;
    answer: CmoBrandAnswer;
    note?: string;
  },
): Promise<void> {
  const cuso = await requireCuso(input);
  // The answer and its fix are one write: an answered no always waits on
  // its section, so the next change picks it up.
  const fixed = await prisma.$transaction(async (tx) => {
    const { asked, answered } = await answerBrandBrainQuestion(
      cuso.projectId,
      input,
      tx,
    );
    // An earlier no's fix goes, so a changed answer never rewrites the section.
    if (asked.answer === "no") {
      await withdrawBrandBrainFix(
        cuso.projectId,
        { section: asked.section, note: noFix(asked) },
        tx,
      );
    }
    if (answered.answer !== "no") return null;
    return requestBrandBrainFix(
      cuso.projectId,
      { section: answered.section, note: noFix(answered) },
      tx,
    );
  });
  if (!fixed) return;
  // A fix that cannot start now (no credits) runs when Cuso's next turn ends.
  await startQueuedFix(cuso, input.userId, fixed).catch((error: unknown) => {
    if (!(error instanceof CmoConflictError)) throw error;
  });
}

/**
 * Starts the fix turn for the Brand Brain sections the owner fixed, unless
 * Cuso is still writing. A fix turn that ended had its go at every fix asked
 * before it started, so it never loops on one it could not make.
 */
export async function startNextCmoChange(
  input: { sokoBotId: string; userId: string | null },
  known?: Cuso,
): Promise<{ turnId: string } | null> {
  const cuso = known ?? (await findCusoForBot(input.sokoBotId));
  const brain = parseBrandBrain(cuso?.brandBrain);
  if (!cuso || !brain) return null;
  const open = brandBrainOpenFixes(brain);
  if (open.length === 0) return null;
  const last = await newestStrategyTurn(cuso.sokoBotId);
  if (last && (await settledTurnStatus(last)) === "running") return null;
  // The last fix turn was sent every fix asked up to the time in its id.
  const sent =
    last && cmoChangeKind(last.clientTurnId) === "fix"
      ? Number(last.clientTurnId?.split(":").at(-1))
      : Number.NaN;
  if (open.every((fix) => Date.parse(fix.at) <= sent)) return null;
  const userId = input.userId ?? (await cmoRunnerUserId(cuso));
  if (!userId) return null;
  const newest = Math.max(...open.map((fix) => Date.parse(fix.at)));
  return startStrategyTurn(cuso, { userId, kind: "fix", sent: newest });
}

async function startCmoStrategy(
  cuso: Cuso,
  userId: string,
  change: { note: string; patch: boolean } | null,
  /** The site's language when the caller knows it; detected otherwise. */
  siteLanguage?: string,
): Promise<{ turnId: string }> {
  try {
    return await startStrategyTurn(
      cuso,
      change
        ? change.patch
          ? { userId, kind: "patch", note: change.note }
          : { userId, kind: "plan", note: change.note }
        : { userId, kind: "plan", siteLanguage },
    );
  } catch (error) {
    // One turn per bot: a plan another request started first is this one;
    // a fix or patch is not.
    const writing = change ? null : await strategyTurnRunning(cuso.sokoBotId);
    if (writing && cmoChangeKind(writing.clientTurnId) === null)
      return { turnId: writing.id };
    throw error;
  }
}

/**
 * The patch a short turn saves: only the entries and plan fields it changes,
 * with the rules still kept.
 */
const PATCH_LINES = [
  "Change only the calendar entries and strategy fields this touches, and nothing else. Save them with save_strategy part patch: each entry you change goes whole under its id (a new id adds one, status skipped drops one); a strategy field you change goes whole; leave out every entry and field you keep, and they stay exactly as they are. The calendar must still hold at least 16 pieces whose approach and pillar shares are within 7 points of the mix and the pillars. List each difference in changes, in plain words.",
  "Do not write a new strategy, research again or touch the Brand Brain.",
];

/**
 * cmo-v8's patch: a correction reaches every field that rests on it. A no to
 * ballcaps once changed the goal and left caps in the funnel's plays and a
 * question.
 */
const CORRECTION_PATCH_LINES = [
  "What the owner says is true everywhere. Before you save, read every place the strategy states what it changes: the idea, summary, goals, focus, offer, each pillar and its why, each funnel stage's goal and plays, each question, ads.suggest, the campaigns, and each calendar entry's title, brief, why, story and claim. Change each one that rests on it, and leave alone what does not. Never name what the owner rejected, not even to say it is out. Save them with save_strategy part patch, in small parts so each call stays short: first the strategy fields you change, then the calendar entries you change, at most 8 entries a call. Each entry you change goes whole under its id (a new id adds one, status skipped drops one); a strategy field you change goes whole; leave out every entry and field you keep, and they stay exactly as they are. The calendar must still hold at least 16 pieces whose approach and pillar shares are within 7 points of the mix and the pillars. List each difference in changes, in plain words.",
  "Do not write a new strategy, research again or touch the Brand Brain.",
];

/**
 * cmo-v13: a long month does not fit in Cuso's context, so "send the whole
 * calendar" once had him ask the owner for "the full strategy calendar".
 */
const PART_CHANGE_SAVE =
  "Save with save_strategy part patch: only the calendar entries you change, each whole under its id (a new id adds one, status skipped drops one), and only the strategy fields you change, each whole; at most 8 entries a call. Leave out every entry and field you keep, and they stay exactly as they are. Never send the whole calendar, and never ask the owner for it.";

/** cmo-v8's fix also rewrites the essentials that say what the fixed section says. */
const ESSENTIALS_SAVE =
  "In the same call, send brandBrain with the essentials that say the same thing rewritten to match (the customers or buyers in audience, the offer in products and offers, the positioning in summary; everything else as your packet holds it) and reveal with buyers and positioning rewritten the same way.";

type StrategyTurn =
  | { userId: string; kind: "plan"; note?: string; siteLanguage?: string }
  | { userId: string; kind: "patch"; note: string }
  /** sent: the newest fix the turn is sent, so it never retries them. */
  | { userId: string; kind: "fix"; sent: number };

/** A short turn's message: a patch for the owner's note, or a brand fix. */
function changeMessage(
  cuso: Cuso,
  brain: BrandBrain,
  input: Exclude<StrategyTurn, { kind: "plan" }>,
  planned: boolean,
  /** cmo-v8: a correction reaches every field and the Brand Brain's essentials. */
  everywhere: boolean,
): string {
  const patch = everywhere ? CORRECTION_PATCH_LINES : PATCH_LINES;
  const lines =
    input.kind === "patch"
      ? [
          `Patch ${cuso.businessName}'s marketing strategy. The owner asked: ${input.note}`,
          ...patch,
          "Then tell the owner in one sentence what changed.",
        ]
      : [
          ...fixLines(cuso.businessName, brain),
          ...(everywhere ? [ESSENTIALS_SAVE] : []),
          ...(planned
            ? [
                "",
                "Then patch the strategy for this correction, as a change note, not a new strategy.",
                ...patch,
              ]
            : ["Do not write a strategy."]),
          "Then tell the owner in one sentence what you fixed.",
        ];
  return lines.join("\n");
}

const PLAN_SAVE_TWO_CALLS =
  "This is the strategy, not the posts. Save it in two calls of save_strategy, so the owner reads the strategy while you write the calendar: first part plan (idea, alternatives, ladder, summary, why, goals, objective, barrier, mix, pillars with their shares, focus, offer, channels, pace, ads, funnel with plays and measure, beforeAfter, improvements, proposals, campaigns, weeks, measurement, questions); then part calendar, the day-by-day calendar whose approach shares match the mix and whose pillar shares match the pillars. Week one in full (date, time, channel, format, approach, pillar, title, brief, why, campaignId, and story for each LinkedIn piece); weeks two to four as titles (date, time, channel, format, approach, pillar, title, campaignId, and story for each LinkedIn piece; no brief or why). The calendar holds every piece the pace and each channel's cadence call for, in all four weeks. Each part leaves the other as saved. save_strategy refuses a save that breaks a hard rule and says which: a summary of at most 20 words, at least 16 pieces, and approach and pillar shares within 7 points. Write no drafts, hooks or previews: after the owner approves and pays, you make the whole month at once.";

const PLAN_SAVE_WEEKLY =
  "This is the strategy, not the posts. Save it in short calls of save_strategy, so the owner reads the strategy while you write the calendar: first part plan (idea, alternatives, ladder, summary, why, goals, objective, barrier, mix, pillars with their shares, focus, offer, channels, pace, ads, funnel with plays and measure, beforeAfter, improvements, proposals, campaigns, weeks, measurement, questions); then the day-by-day calendar, one week a call: part calendar with week one in full (date, time, channel, format, approach, pillar, title, brief, why, campaignId, and story for each LinkedIn piece), then part patch with week two, then week three, then week four, each as titles (date, time, channel, format, approach, pillar, title, campaignId, and story for each LinkedIn piece; no brief or why) under new ids. Every week holds about the pace's perWeek pieces in the mix and pillar shares. Each part leaves the rest as saved. save_strategy refuses a save that breaks a hard rule and says which: a summary of at most 20 words, at least 16 pieces, and approach and pillar shares within 7 points. Write no drafts, hooks or previews: after the owner approves and pays, you make the whole month at once.";

async function startStrategyTurn(
  cuso: Cuso,
  input: StrategyTurn,
): Promise<{ turnId: string }> {
  const brain = parseBrandBrain(cuso.brandBrain);
  if (!brain) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  const id = `${STRATEGY_TURN_PREFIX}${cuso.sokoBotId}:`;
  const bot = await prisma.sokoBot.findUnique({
    where: { id: cuso.sokoBotId },
    select: { versionId: true },
  });
  const rules =
    bot?.versionId != null
      ? cmoStrategyRules(getSokoBotVersion(bot.versionId).skills)
      : {};
  if (input.kind !== "plan") {
    const planned = (await newestMarketingStrategy(cuso.projectId)) !== null;
    if (input.kind === "patch" && !planned) {
      throw new CmoConflictError("Cuso has not written the strategy yet");
    }
    return startCmoTurn(cuso, input.userId, {
      clientTurnId:
        input.kind === "fix"
          ? `${id}fix:${Date.now()}:${input.sent}`
          : `${id}patch:${Date.now()}`,
      message: changeMessage(
        cuso,
        brain,
        input,
        planned,
        rules.claims === true,
      ),
      route: CMO_STRATEGY_ROUTE,
    });
  }
  // A month at cmo-v3's pace is too long for one call: its Cuso saves it week
  // by week, and is told so here, where the two-call message once capped it.
  const savesWeekly = rules.weekly === true;
  // Named up front: a goal such as "More leads" once pulled whole plans onto
  // a side product or feature with the same word in it.
  const main = brain.offers?.[0];
  const sells = `${brain.reveal?.positioning ?? brain.summary}${main ? ` Main offer: ${main.name} (${main.price}).` : ""}`;
  // A plan for a Zurich restaurant's German site once posted in English.
  const { detectSiteLanguage } = await import("@/lib/site-platform");
  const siteLanguage = input.note
    ? null
    : (input.siteLanguage ?? (await detectSiteLanguage(cuso.websiteUrl)));
  const span = planWindow();
  return startCmoTurn(cuso, input.userId, {
    clientTurnId: `${id}${Date.now()}`,
    message: brandCorrections(brain, rules.claims === true)
      .concat(
        input.note
          ? [
              `Change ${cuso.businessName}'s marketing strategy. The owner asked: ${input.note}`,
              "",
              "Start from the strategy in your packet and change only what the request needs. Every entry you do not change stays exactly as it is: same id, date, time and title. To move a piece, change the date on the same id; never add a copy. List each difference in changes, in plain words.",
              rules.partPatch
                ? PART_CHANGE_SAVE
                : "Save with save_strategy: part plan for changes to the strategy (send the whole strategy with your changes), part calendar for changes to the calendar (send the whole calendar). Each part leaves the other as saved.",
            ]
          : [
              `Write ${cuso.businessName}'s marketing strategy for the four weeks from ${span.start} to ${span.end}. No calendar entry after ${span.end}.`,
              ...seasonLines(span),
              `What ${cuso.businessName} sells, from the Brand Brain: ${sells} The strategy sells this main offer to its main buyers. A single product or feature may carry one campaign, never the whole strategy.`,
              "Set the one result the business most needs from selling the main offer, from the Brand Brain, and lead the strategy's goals with it.",
              ...(siteLanguage
                ? [
                    `The website is written in ${siteLanguage}: set contentLanguage to ${siteLanguage}, the language its customers read, unless the owner asked for another. Every piece is in it, from its calendar title, brief and story to its words (hooks, drafts, the offer's action), and so are the pillar names. What explains the strategy to the owner (the idea, summary, goals, each why, the funnel, the questions) stays in the owner's language.`,
                  ]
                : []),
              ...ownerAnswers(brain),
              "Before you save, read your summary, focus, offer and pillars against the main offer above: if they drift to a narrower product or feature the owner did not name, or away from the one the owner did name, rewrite them.",
              "",
              "Follow your strategy skill exactly. Use the Brand Brain and the channels in your packet.",
              // A restaurant's LinkedIn once got two diner posts a day: who
              // is on each network decides its role before its cadence.
              ...(savesWeekly
                ? [
                    "",
                    "Who is on each network, to set each channel's role (main or side) and the buyer a side channel serves:",
                    networkAudiences(),
                    "",
                  ]
                : []),
              (savesWeekly ? PLAN_SAVE_WEEKLY : PLAN_SAVE_TWO_CALLS).replaceAll(
                "campaignId, and story for each LinkedIn piece",
                rules.claims
                  ? "campaignId, claim, and story for each social-proof piece"
                  : "campaignId, and story for each LinkedIn piece",
              ),
            ],
      )
      .concat([
        "Do not create Social posts or images yet; that starts after the owner approves.",
        "Then tell the owner in one or two sentences what the strategy does first. The strategy card is your report: do not call report_update, and never mention tools, Social posts or what you did not do.",
      ])
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
}

/**
 * Plans once ignored the season (no Christmas for a restaurant, no Black
 * Friday for a shop in November) and repeated one fact a dozen times.
 */
function seasonLines(span: { start: string; end: string }): string[] {
  return [
    `Before the calendar, list the dates between ${span.start} and ${span.end} that matter to this business's buyers where they live (the Brand Brain's headquarters and markets) and in its trade: public holidays, shopping days (Black Friday, Cyber Monday), seasons and gift moments (Advent, Christmas, Valentine's Day, back to school), and its industry's events. Build pieces and campaigns around the ones its buyers act on, starting a week or two before, and name the date in each such entry's why. Never invent a discount for one: a sale only when the Brand Brain shows one, otherwise suggest it under improvements. On a holiday the business is closed or its buyers are away, post only about that day, or not at all.`,
    "Vary the calendar: every entry carries its own message, and one fact, number or story (a founding year, a price, a product name) appears in at most two entries of the month.",
  ];
}

/**
 * Each Brand Brain section the owner said is wrong: a fix they wrote on the
 * section, and every no to one of Cuso's questions, named by the question
 * itself. A bare "True instead: Not true: …" once read as the opposite.
 */
function correctionLines(brain: BrandBrain): string[] {
  return [
    ...brandBrainOpenFixes(brain).map(
      (fix) =>
        `- ${fix.section}: you wrote "${brain.profile[fix.section]?.answer ?? ""}". The owner's correction: ${fix.note}`,
    ),
    ...brandBrainCorrections(brain).map(
      (question) =>
        `- ${question.section}: you asked "${question.question}" and the owner said no${question.note ? `. True instead: ${question.note}` : `, so this is false: "${question.statement}". Say the opposite plainly, never "unconfirmed" or "unclear".`}`,
    ),
  ];
}

const SECTION_SAVE =
  "Call save_brand_brain once, with sections holding only these sections. Rewrite each one's answer (and its headline, if it says the same) so it states what is true and never repeats what the owner rejected; keep everything else the answer says that still holds, and send findings empty to keep them.";

/**
 * First the Brand Brain: each section the owner said no to is rewritten
 * before the plan is built on it. None when every no is already in.
 */
function brandCorrections(brain: BrandBrain, everywhere: boolean): string[] {
  const lines = correctionLines(brain);
  if (lines.length === 0) return [];
  return [
    "First correct the Brand Brain. The owner said no to what you wrote:",
    ...lines,
    `${SECTION_SAVE}${everywhere ? ` ${ESSENTIALS_SAVE}` : ""} Then plan from the corrected Brand Brain.`,
    "",
  ];
}

/** A short turn that rewrites only the sections the owner fixed. */
function fixLines(businessName: string, brain: BrandBrain): string[] {
  return [
    `Fix ${businessName}'s Brand Brain. The owner corrected what you wrote:`,
    ...correctionLines(brain),
    `${SECTION_SAVE} The owner's words are the source: do not research again.`,
  ];
}

/** The owner's answers, for the strategy request; none when nothing was answered. */
function ownerAnswers(brain: BrandBrain): string[] {
  const answered = brain.questions.filter(
    (question) => question.answer && question.answer !== "unsure",
  );
  if (answered.length === 0) return [];
  return [
    "The owner answered your Brand Brain questions. A yes confirms the statement; a no overrides your reading, and its note says what is true instead:",
    ...answered.map(
      (question) =>
        `- ${question.question} ${question.answer}${question.note ? `: ${question.note}` : ""}`,
    ),
  ];
}

/** Matches the calendar slice in the turn packet. A full plan with drafts does not fit. */
export const CMO_VISIBLE_CALENDAR_DAYS = 31;
/**
 * cmo-v14's top volume on every live network is about 300 pieces a month
 * (four X posts a day, two TikToks, a picture and a Reel on Instagram, and
 * one a day on LinkedIn, Facebook and YouTube).
 */
const CMO_CALENDAR_LIMIT = 320;

export function calendarBounds(
  now: Date,
  days: number,
): { from: string; to: string } {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

/**
 * A bot turn only sees the next 31 days. Put back entries outside that window
 * so save_strategy cannot delete them. An incoming entry with the same id, or
 * the same day and channel, still wins. Owner saves pass no turn id and replace
 * the calendar outright.
 */
function withHiddenCalendar(
  previous: MarketingStrategyPlan["calendar"],
  incoming: MarketingStrategyPlan["calendar"],
  now: Date,
): MarketingStrategyPlan["calendar"] {
  const { from, to } = calendarBounds(now, CMO_VISIBLE_CALENDAR_DAYS);
  const seen = new Set(incoming.map((entry) => entry.id));
  const covered = new Set(
    incoming.map((entry) => `${entry.date}\0${entry.channel}`),
  );
  const hidden = previous.filter(
    (entry) =>
      !seen.has(entry.id) &&
      (entry.date < from || entry.date > to) &&
      !covered.has(`${entry.date}\0${entry.channel}`),
  );
  const room = CMO_CALENDAR_LIMIT - incoming.length;
  if (room <= 0 || hidden.length === 0) return incoming;
  const kept = hidden
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-room);
  return [...incoming, ...kept].sort((left, right) =>
    left.date === right.date
      ? left.id.localeCompare(right.id)
      : left.date.localeCompare(right.date),
  );
}

/**
 * Guards a bot's save against the two ways a revision loses work: an entry
 * kept under the same id and title keeps every field the save leaves out,
 * and an entry left in its old slot while a copy moved to a new day is
 * dropped, so a moved piece shows once.
 */
export function keepCalendarWork(
  previous: MarketingStrategyPlan["calendar"],
  incoming: MarketingStrategyPlan["calendar"],
): MarketingStrategyPlan["calendar"] {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  // Entries past the first week reach Cuso without their words (the
  // packet's detailsStored); sent back under the same title, they keep them.
  const withDrafts = incoming.map((entry) => {
    const old = before.get(entry.id);
    if (!old || !sameTitle(old.title, entry.title)) return entry;
    const draft = entry.draft ?? old.draft;
    const brief = entry.brief ?? old.brief;
    const why = entry.why ?? old.why;
    const hook = entry.hook ?? old.hook;
    const words = {
      ...(draft !== undefined ? { draft } : {}),
      ...(brief !== undefined ? { brief } : {}),
      ...(why !== undefined ? { why } : {}),
      ...(hook !== undefined ? { hook } : {}),
    };
    // Moved to another channel or format, its post, files and ad belong to
    // the old piece: only the words come along.
    if (old.channel !== entry.channel || old.format !== entry.format)
      return { ...entry, ...words };
    return {
      ...old,
      ...Object.fromEntries(
        Object.entries(entry).filter(([, value]) => value !== undefined),
      ),
      ...words,
    } as typeof entry;
  });
  return withDrafts.filter((entry) => {
    const old = before.get(entry.id);
    const untouched = old?.date === entry.date;
    if (!untouched) return true;
    const moved = withDrafts.some(
      (other) =>
        other !== entry &&
        other.channel === entry.channel &&
        other.date !== entry.date &&
        sameTitle(other.title, entry.title) &&
        // A series ("Tip of the week") repeats the title, not the words.
        ((!!other.hook && other.hook === entry.hook) ||
          (!!other.draft && other.draft === entry.draft)) &&
        before.get(other.id)?.date !== other.date,
    );
    return !moved;
  });
}

const DASH = /\s*[—–]\s*/g;

/**
 * Cuso's copy goes out under the brand's name; em and en dashes read as AI
 * writing. Number ranges ("3–5") keep a plain hyphen.
 */
export function withoutDashes<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
      .replace(DASH, ", ") as T;
  }
  if (Array.isArray(value)) return value.map(withoutDashes) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutDashes(item)]),
    ) as T;
  }
  return value;
}

/**
 * The pieces a save sends that are Project files (an ad, a newsletter
 * issue), kept on the approved plan: a piece Cuso adds in chat joins the
 * calendar, where the owner reads and launches it, the way a new social
 * entry becomes a draft post; a piece already there keeps its visual on its
 * entry, where Core's media maker reads it. The words and a search ad's
 * parts stay with the piece's file.
 */
async function keepFilePieces(
  db: Prisma.TransactionClient,
  approved: MarketingStrategy,
  sent: CmoCalendarEntry[],
): Promise<MarketingStrategy> {
  const plan = parseMarketingPlan(approved.plan);
  const pieces = sent.filter(isMarketingFilePiece);
  if (!plan || pieces.length === 0) return approved;
  const planned = new Set(plan.calendar.map((entry) => entry.id));
  const added = pieces.filter(
    (entry) =>
      !planned.has(entry.id) &&
      entry.status !== "skipped" &&
      Boolean(entry.draft?.trim()),
  );
  const unknown = added.find(
    (entry) => !isCmoChannelFormat(entry.channel, entry.format),
  );
  if (unknown)
    throw new CmoConflictError(
      `"${unknown.title}" was not added: ${unknown.channel} has no format "${unknown.format}". Use a channel and format from the strategy's channel menu.`,
    );
  const visuals = new Map(
    pieces.filter((entry) => entry.visual).map((entry) => [entry.id, entry]),
  );
  if (visuals.size === 0 && added.length === 0) return approved;
  const calendar = [
    ...plan.calendar.map((entry) => {
      const sentEntry = visuals.get(entry.id);
      if (!sentEntry?.visual) return entry;
      return {
        ...entry,
        visual: sentEntry.visual,
        ...(sentEntry.visualFileIds !== undefined
          ? { visualFileIds: sentEntry.visualFileIds }
          : {}),
        ...(sentEntry.styleReferenceId !== undefined
          ? { styleReferenceId: sentEntry.styleReferenceId }
          : {}),
        ...(sentEntry.headline !== undefined
          ? { headline: sentEntry.headline }
          : {}),
        ...(sentEntry.slides !== undefined ? { slides: sentEntry.slides } : {}),
        ...(sentEntry.slideHeadlines !== undefined
          ? { slideHeadlines: sentEntry.slideHeadlines }
          : {}),
      };
    }),
    ...added.map(
      ({ draft: _draft, searchAd: _searchAd, adCampaign: _ad, ...entry }) =>
        entry,
    ),
  ];
  return db.marketingStrategy.update({
    where: { id: approved.id },
    data: { plan: jsonInput({ ...plan, calendar }) },
  });
}

/**
 * Why Cuso's save of pieces breaks the picture rules, or null. Each sent
 * piece is read as it will stand: what it sends over what its post or the
 * plan already holds. A reference the library does not hold is refused too.
 */
async function pictureStyleProblem(
  db: Prisma.TransactionClient,
  approved: MarketingStrategy,
  sent: CmoCalendarEntry[],
  pictureKinds: boolean,
): Promise<string | null> {
  const pictures = sent.filter(
    (entry) => entry.status !== "skipped" && entry.visual?.trim(),
  );
  if (pictures.length === 0) return null;
  const posts = await db.socialPost.findMany({
    where: { marketingStrategyId: approved.id, status: { not: "CANCELED" } },
    select: { id: true, planning: true },
  });
  const calendar = parseMarketingPlan(approved.plan)?.calendar ?? [];
  const stored = new Map<string, Partial<CmoCalendarEntry>>();
  for (const entry of calendar) stored.set(entry.id, entry);
  for (const post of posts) {
    const planning = parseSocialPostPlanning(post.planning);
    if (!planning) continue;
    // The plan's entry says where and when the piece goes out.
    const piece = { ...stored.get(planning.id), ...planning };
    stored.set(planning.id, piece);
    stored.set(post.id, piece);
  }
  const saved = pictures.map((entry) => {
    const before = stored.get(entry.id);
    return {
      ...entry,
      // The post's own id names the same piece as its plan entry's.
      id: before?.id ?? entry.id,
      styleReferenceId: entry.styleReferenceId ?? before?.styleReferenceId,
      slides: entry.slides ?? before?.slides,
      slideHeadlines: entry.slideHeadlines ?? before?.slideHeadlines,
    };
  });
  const savedIds = new Set(saved.map((entry) => entry.id));
  const others = [
    ...new Map(
      [...stored.values()].flatMap((entry) =>
        entry.id && !savedIds.has(entry.id)
          ? [
              [
                entry.id,
                {
                  id: entry.id,
                  styleReferenceId: entry.styleReferenceId,
                  channel: entry.channel,
                  date: entry.date,
                  time: entry.time,
                },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ];
  const ids = [
    ...new Set(
      [...saved, ...(pictureKinds ? others : [])].flatMap(
        (entry) => entry.styleReferenceId ?? [],
      ),
    ),
  ];
  const known = await db.referenceImage.findMany({
    where: { id: { in: ids } },
    select: { id: true, kind: true },
  });
  const problem = cmoPictureStyleProblem(
    saved,
    others,
    pictureKinds
      ? {
          kindOf: new Map(known.map((row) => [row.id, row.kind])),
          planned: calendar.filter(
            (entry) => entry.status !== "skipped" && cmoPieceTakesStyle(entry),
          ).length,
        }
      : undefined,
  );
  if (problem) return problem;
  const missing = saved
    .flatMap((entry) => entry.styleReferenceId ?? [])
    .filter((id) => !known.some((row) => row.id === id));
  return missing.length > 0
    ? `Nothing was saved: ${[...new Set(missing)].join(", ")} is no style reference. Use an id find_style_references returned.`
    : null;
}

/**
 * Saves the strategy as a version of the Project's Marketing strategy. A
 * turn's first save adds a version and its later saves complete it (a plan
 * goes in two calls) until it is approved; no save changes another version.
 * Pieces fill in the approved version's Social posts; the runtime then
 * writes the other pieces (ads, articles, newsletters) as Project files. A
 * patch changes only what it sends and keeps each changed entry as it was.
 */
export async function saveCmoStrategy(
  where: CusoTarget | { sokoBotId: string },
  save: CmoStrategySave,
  options: {
    turnId?: string;
    now?: Date;
    /**
     * pieces: only the entries Cuso changed, merged by id into the approved
     * version; patch: only the entries and fields sent, into the newest.
     */
    part?: CmoStrategySavePart;
    /** A rhythm or production turn: it builds on the approved version. */
    executing?: boolean;
    /** Lists Cuso empties because the owner asked; sent empty, they clear. */
    clear?: readonly string[];
    /** Cuso's own save: one that breaks a hard rule saves nothing. */
    rules?: boolean;
    /** The month's pictures vary their kind of print (cmo-v8). */
    pictureKinds?: boolean;
    /** A styled picture's visual is a scene alone (cmo-v9). */
    sceneVisuals?: boolean;
  } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy> {
  const cuso = await requireCuso(where, db);
  // What the last patch changed is Core's to say.
  const { patched, ...strategy } = save;
  const alsoOn = (strategy.calendar ?? [])
    .map((entry) => cmoAlsoOnProblem(entry))
    .find((problem) => problem !== null);
  if (alsoOn && options.turnId) throw unprocessableEntity(alsoOn);
  if (options.part === "pieces") {
    // Pieces write the approved version's Social posts and never a plan.
    const approved = await approvedMarketingStrategy(cuso.projectId, db);
    if (!approved) {
      throw new CmoConflictError(
        "Pieces fill in the approved strategy; no version is approved yet; until the owner approves, change entries with part patch (only those entries, by id) or the whole month with part calendar",
      );
    }
    if (options.turnId && referenceLibraryAvailable()) {
      const problem = await pictureStyleProblem(
        db,
        approved,
        (strategy.calendar ?? []) as CmoCalendarEntry[],
        options.pictureKinds ?? false,
      );
      if (problem) throw unprocessableEntity(problem);
      const scene = options.sceneVisuals
        ? cmoSceneVisualProblem(
            ((strategy.calendar ?? []) as CmoCalendarEntry[]).filter(
              (entry) => entry.status !== "skipped",
            ),
          )
        : null;
      if (scene) throw unprocessableEntity(scene);
    }
    await planMarketingStrategyPosts(db, {
      version: approved,
      workspaceId: cuso.workspaceId,
      entries: (strategy.calendar ?? []) as CmoCalendarEntry[],
      creator:
        "sokoBotId" in where
          ? { sokoBotId: cuso.sokoBotId }
          : { userId: where.userId },
    });
    return keepFilePieces(
      db,
      approved,
      (strategy.calendar ?? []) as CmoCalendarEntry[],
    );
  }
  const own = options.turnId
    ? await db.marketingStrategy.findFirst({
        where: {
          projectId: cuso.projectId,
          authorTurnId: options.turnId,
          approvedAt: null,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const base =
    own ??
    (await cmoWorkingStrategy(cuso.projectId, options.executing ?? false, db));
  // What a save leaves out stays as stored; the merged plan must be whole.
  // A tool call has to fill every field, so Cuso sends an empty list or text
  // for what it is not changing: that keeps the stored value too. Changing
  // one channel's cadence once emptied the mix, campaigns and improvements.
  const before = parseMarketingPlan(base?.plan);
  const ownerAds =
    options.turnId && before?.ads?.setByOwner ? before.ads : undefined;
  const keepOwnerAds = <T extends MarketingStrategyPlan>(plan: T): T =>
    ownerAds
      ? {
          ...plan,
          ads: {
            ...(plan.ads ?? ownerAds),
            monthly: ownerAds.monthly,
            currency: ownerAds.currency,
            setByOwner: true,
          },
        }
      : plan;
  let stored: MarketingStrategyPlan;
  if (options.part === "patch") {
    if (!before)
      throw new CmoConflictError("There is no strategy to patch yet");
    // Cuso once sent his changes as `patched` with an empty calendar, ten
    // times in a row: each patch saved nothing and the review said so again.
    if (patched?.length && !strategy.calendar?.length)
      throw unprocessableEntity(
        "save_strategy saved nothing: patched is Core's record of what the last patch changed, and a save never sets it. Send each entry you change in calendar (its id and every field), and save again.",
      );
    const sent = options.turnId
      ? withoutDashes({ ...strategy, calendar: strategy.calendar ?? [] })
      : { ...strategy, calendar: strategy.calendar ?? [] };
    stored = keepOwnerAds(
      patchPlan(before, withLineBreaks(sent), own ? before.patched : []),
    );
  } else {
    const left = (value: unknown, key?: string) =>
      value === undefined ||
      (options.turnId !== undefined &&
        (value === "" ||
          (Array.isArray(value) &&
            value.length === 0 &&
            !(key && options.clear?.includes(key)))));
    // A save of the calendar alone replaces it, so an empty one removes every
    // piece. `changes` is empty on purpose when the save is not a revision.
    const calendarOnly = Object.keys(strategy).every(
      (key) => key === "calendar",
    );
    const whole = marketingStrategyPlanSchema.parse({
      ...before,
      ...Object.fromEntries(
        Object.entries(strategy).filter(
          ([key, value]) => key === "changes" || !left(value, key),
        ),
      ),
      calendar:
        strategy.calendar !== undefined &&
        (calendarOnly || !left(strategy.calendar))
          ? strategy.calendar
          : (before?.calendar ?? []),
      patched: [],
    });
    // A channel the plan now runs is no longer a proposal.
    const running = new Set(whole.channels.map((channel) => channel.channel));
    // The ad budget the owner set is theirs: Cuso's saves plan around it.
    const parsed = keepOwnerAds({
      ...whole,
      questions: keepAnswers(
        options.turnId
          ? await withoutBrandBrainRepeats(
              cuso.projectId,
              whole.questions,
              before?.questions ?? [],
              db,
            )
          : whole.questions,
        before?.questions ?? [],
      ),
      proposals: whole.proposals.filter(
        (proposal) => !running.has(proposal.channel),
      ),
    });
    const previous = options.turnId ? before : null;
    const merged = previous
      ? {
          ...parsed,
          calendar: withHiddenCalendar(
            previous.calendar,
            keepCalendarWork(previous.calendar, parsed.calendar),
            options.now ?? new Date(),
          ),
        }
      : parsed;
    stored = options.turnId ? withoutDashes(withLineBreaks(merged)) : merged;
  }
  // Only the owner lowers the pace or a cadence; Core marks what they asked for.
  if (options.turnId)
    stored = cmoWithOwnerPace(
      stored,
      before,
      await cmoOwnerRequest(options.turnId),
    );
  // A changed cadence reaches the funnel and the calendar, not the label alone.
  if (options.turnId && !options.executing)
    stored = cmoFollowCadenceChange(stored, before);
  // A talking video shows a generated presenter: its script speaks for the
  // brand, never as a customer of it.
  const testimonial = options.turnId
    ? (strategy.calendar ?? []).find(
        (entry) =>
          isCmoTalkingFormat(entry.channel, entry.format) &&
          entry.script &&
          posesAsCustomerTestimonial(entry.script),
      )
    : undefined;
  if (testimonial)
    throw unprocessableEntity(
      `The talking video ${testimonial.id} speaks as a customer. ${TALKING_VIDEO_TESTIMONIAL_MESSAGE} Rewrite its script and save again.`,
    );
  // A month is planned without scripts and production writes them; a change
  // in chat makes the piece now, so it needs its words.
  const unscripted =
    options.turnId && options.part === "patch"
      ? (strategy.calendar ?? []).find(
          (entry) =>
            isCmoTalkingFormat(entry.channel, entry.format) && !entry.script,
        )
      : undefined;
  if (unscripted)
    throw unprocessableEntity(
      `The talking video ${unscripted.id} has no script. Give it script (the spoken words: a hook first, one point, one next step, 150 to 400 characters, never as a customer), presenter and voice, then save again.`,
    );
  if (options.rules) {
    // A plan part saved before its calendar is checked with the calendar.
    const sendsCalendar =
      options.part === "patch" || strategy.calendar !== undefined;
    // A change is refused only for a rule it breaks anew, measured against
    // the plan as it was before this turn, never a part this turn saved
    // unchecked.
    const earlier =
      own && options.turnId
        ? parseMarketingPlan(
            (
              await db.marketingStrategy.findFirst({
                where: {
                  projectId: cuso.projectId,
                  OR: [
                    { authorTurnId: null },
                    { authorTurnId: { not: options.turnId } },
                  ],
                },
                orderBy: { createdAt: "desc" },
                select: { plan: true },
              })
            )?.plan,
          )
        : before;
    const broken = cmoPlanRulesBrokenSince(
      sendsCalendar ? stored : { ...stored, calendar: [] },
      earlier ?? null,
    );
    if (broken.length > 0) {
      throw unprocessableEntity(
        [
          "save_strategy saved nothing: the strategy breaks a hard rule. Fix each one and save again.",
          ...broken.map((problem) => `- ${problem}`),
        ].join("\n"),
      );
    }
  }
  stored = withoutUnpaidAds(stored);
  // On cmo-v5 ads wait for the owner's Yes, whatever Cuso saved.
  if (await asksBeforeAds(cuso.sokoBotId, db))
    stored = withoutUnaskedAds(stored);
  const planJson = jsonInput(stored);
  if (own) {
    return db.marketingStrategy.update({
      where: { id: own.id },
      data: { plan: planJson },
    });
  }
  return db.marketingStrategy.create({
    data: {
      projectId: cuso.projectId,
      plan: planJson,
      authorTurnId: options.turnId ?? null,
      ...("sokoBotId" in where
        ? { authorSokoBotId: cuso.sokoBotId }
        : { authorUserId: where.userId }),
    },
  });
}

/**
 * A patch on a plan: each sent entry replaces its own (keeping what it
 * leaves out, such as a draft), a new id is added, and every other entry and
 * plan field stays as it was. Each entry it changed keeps how it was before,
 * the first time across one turn's saves.
 */
export function patchPlan(
  before: MarketingStrategyPlan,
  sent: CmoStrategySave & { calendar: CmoStrategySave["calendar"] & {} },
  earlier: MarketingStrategyPlan["patched"],
): MarketingStrategyPlan {
  const { calendar: entries, changes, ...fields } = sent;
  const old = new Map(before.calendar.map((entry) => [entry.id, entry]));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const calendar = [
    ...before.calendar.map((entry) => {
      const next = byId.get(entry.id);
      if (!next) return entry;
      const merged = { ...entry, ...next };
      // A patch that makes a talking video another format leaves its other
      // networks out: they belong to the talking video alone.
      return merged.alsoOn && !isCmoTalkingFormat(merged.channel, merged.format)
        ? { ...merged, alsoOn: undefined }
        : merged;
    }),
    ...entries.filter((entry) => !old.has(entry.id)),
  ] as CmoCalendarEntry[];
  // The first time across one turn's saves is how the entry was.
  const patched = new Map(earlier.map((item) => [item.id, item]));
  for (const entry of calendar) {
    const was = old.get(entry.id);
    if (
      byId.has(entry.id) &&
      !patched.has(entry.id) &&
      JSON.stringify(was) !== JSON.stringify(entry)
    )
      patched.set(entry.id, { id: entry.id, was: was ?? null });
  }
  return marketingStrategyPlanSchema.parse({
    ...before,
    ...fields,
    calendar,
    changes: changes ?? [],
    patched: [...patched.values()],
  });
}

/**
 * A model sometimes writes line breaks as the two characters "\\n" inside a
 * draft; they would show up literally in a post.
 */
export function withLineBreaks<
  T extends { calendar: MarketingStrategyPlan["calendar"] },
>(strategy: T): T {
  return {
    ...strategy,
    calendar: strategy.calendar.map((entry) =>
      entry.draft?.includes("\\n")
        ? { ...entry, draft: entry.draft.replace(/\\n/g, "\n") }
        : entry,
    ),
  };
}

/**
 * A check of the strategy never asks again what the Brand Brain's questions
 * asked: the owner has seen those, answered or skipped. A check already on
 * the strategy stays, so nothing the owner is answering disappears.
 */
async function withoutBrandBrainRepeats(
  projectId: string,
  questions: CmoPlanQuestion[],
  stored: CmoPlanQuestion[],
  db: Pick<Prisma.TransactionClient, "brandBrain">,
): Promise<CmoPlanQuestion[]> {
  if (questions.length === 0) return questions;
  const brain = parseBrandBrain(
    (
      await db.brandBrain.findUnique({
        where: { projectId },
        select: { body: true },
      })
    )?.body,
  );
  const asked = brain?.questions ?? [];
  return questions.filter(
    (question) =>
      stored.some((kept) => kept.id === question.id) ||
      !asked.some((earlier) => sameQuestion(earlier, question)),
  );
}

/** The newest version CMO shows, or "Cuso has not written it yet". */
async function newestCmoStrategy(
  cuso: Pick<Cuso, "projectId">,
): Promise<MarketingStrategy> {
  const newest = await newestMarketingStrategy(cuso.projectId);
  if (!newest) throw new CmoConflictError("There is no strategy yet");
  return newest;
}

/**
 * What the owner's answers change: each no, with what is true instead. A
 * yes confirms the plan as written and "not sure" leaves Cuso's guess.
 */
export function cmoPlanAnswerNote(questions: CmoPlanQuestion[]): string | null {
  const changes = questions
    .filter((question) => question.answer === "no")
    .map(
      (question) =>
        `- "${question.question}" No.${question.note ? ` What is true: ${question.note}` : ""} (You had assumed: ${question.statement})`,
    );
  return changes.length > 0
    ? [
        "The owner answered your questions about the strategy. Change the strategy where an answer says your assumption was wrong; keep everything else.",
        ...changes,
      ].join("\n")
    : null;
}

/**
 * A no the strategy does not show yet (CMO's `planUnfitted`): Core clears
 * `changes` when a new or changed no lands, and Cuso's fit fills it again.
 */
export function cmoStrategyUnfitted(plan: unknown): boolean {
  const parsed = parseMarketingPlan(plan);
  return (
    parsed !== null &&
    parsed.questions.some((question) => question.answer === "no") &&
    (parsed.changes ?? []).length === 0
  );
}

/**
 * A weekly Cuso's month that does not hold what it promises (`cmoPromiseGaps`),
 * in the owner's numbers; null when it is whole or not a weekly Cuso's.
 */
export function cmoStrategyShortfall(
  versionId: string | null,
  plan: unknown,
): { planned: number; promised: number } | null {
  if (!versionId) return null;
  const rules = cmoStrategyRules(getSokoBotVersion(versionId).skills);
  const parsed = rules.weekly ? parseMarketingPlan(plan) : null;
  return parsed ? cmoMonthShortfall(parsed, rules) : null;
}

/**
 * The owner approves what they read: never a strategy that still shows an
 * answer they said no to, nor a month that does not hold what it promises.
 */
export async function requireCmoStrategyFitted(
  cuso: Pick<Cuso, "projectId" | "sokoBotId">,
  strategyId: string,
): Promise<void> {
  const [version, bot] = await Promise.all([
    prisma.marketingStrategy.findFirst({
      where: { id: strategyId, projectId: cuso.projectId },
      select: { plan: true, approvedAt: true },
    }),
    prisma.sokoBot.findUnique({
      where: { id: cuso.sokoBotId },
      select: { versionId: true },
    }),
  ]);
  if (!version || version.approvedAt) return;
  if (cmoStrategyUnfitted(version.plan)) {
    throw new CmoConflictError(
      "You answered no to one of the checks. Update the strategy first, then approve it.",
    );
  }
  if (cmoStrategyShortfall(bot?.versionId ?? null, version.plan)) {
    throw new CmoConflictError(
      "This strategy promises more than its calendar holds. Ask Cuso to write it again, then approve it.",
    );
  }
}

/** Cuso patches the plan where the owner's answers say it was wrong. */
export async function applyCmoPlanAnswers(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  const newest = await newestCmoStrategy(cuso);
  const note = cmoPlanAnswerNote(
    parseMarketingPlan(newest.plan)?.questions ?? [],
  );
  if (!note) throw new CmoConflictError("Your answers confirm the strategy");
  return requestStrategyForCuso(cuso, {
    userId: target.userId,
    note,
    patch: true,
  });
}

/**
 * The owner pauses one calendar entry from Up next: its Social post (the
 * entry's id) is canceled so it cannot go out; one already going out is
 * refused (409). Any other piece is a Project file the owner uses
 * themselves, so nothing goes out to pause: it is refused too.
 */
export async function pauseCmoCalendarEntry(
  input: CusoTarget & {
    entryId: string;
  },
): Promise<void> {
  const cuso = await requireCuso(input);
  const post = UUID.test(input.entryId)
    ? await prisma.socialPost.findFirst({
        where: { id: input.entryId, projectId: cuso.projectId },
        select: { status: true, revision: true },
      })
    : null;
  if (!post) {
    throw new CmoConflictError("Only a planned Social post can be paused");
  }
  if (post.status === "CANCELED") return;
  const { cancelSocialPost } = await import("@/services/social-posts.service");
  await cancelSocialPost({
    projectId: cuso.projectId,
    workspaceId: cuso.workspaceId,
    userId: input.userId,
    postId: input.entryId,
    revision: post.revision,
  });
}

/**
 * The words of one approved piece that lives in the Project's Files (an
 * article, a page fix, ad copy, a newsletter issue), for its sheet in CMO.
 */
export async function readCmoPieceText(
  input: CusoTarget & {
    entryId: string;
  },
): Promise<string> {
  const cuso = await requireCuso(input);
  const approved = await approvedMarketingStrategy(cuso.projectId);
  const text = approved
    ? await readMarketingPieceText(approved, input.entryId)
    : null;
  if (text === null)
    throw new CmoNotFoundError("This piece is not written yet");
  return text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
