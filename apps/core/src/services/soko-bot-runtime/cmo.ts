import { type Prisma } from "@sokosumi/database";
import {
  type BrandBrain,
  CMO_PRODUCTION_TURN_PREFIX,
  cmoStrategySaveClears,
  cmoStrategySavePart,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  parseCmoStrategySave,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { jsonInput } from "@/helpers/prisma-json";
import { COMPETITOR_CHECK_MODEL } from "@/lib/competitors/model";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { EMBEDDING_MODEL } from "@/lib/embeddings";
import { recordCoreWarning, tryUseLogger } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { SOKO_BOT_JEV_MODEL } from "@/lib/soko-bot/jev";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { RuntimeEventLog, runtimeEvent } from "@/lib/soko-bot/turn-loop";
import {
  brandBrainSectionsSaved,
  getBrandBrain,
  parseBrandBrain,
  saveBrandBrain,
} from "@/services/brand-brain.service";
import { scheduleCmoBrandMedia } from "@/services/cmo-brand-media.service";
import {
  COMPETITOR_SEARCHES_CAMPAIGN,
  unreadCompetitorAdKeywords,
} from "@/services/cmo-competitor-keywords.service";
import { syncTrackedCompetitorsFromBrandBrain } from "@/services/cmo-competitors.service";
import {
  CmoNotFoundError,
  cmoSiteAccountNetworks,
  findCusoForBot,
  requireCuso,
  startCmoProduction,
} from "@/services/cmo-cuso.service";
import { cmoIndustryPillarProblems } from "@/services/cmo-industry.service";
import {
  cmoMakesVariedMonth,
  cmoWritesSceneVisuals,
} from "@/services/cmo-media-maker.service";
import {
  CMO_CALENDAR_REVIEWS_PER_TURN,
  CMO_PLAN_REVIEWS_PER_TURN,
  CMO_WEEKLY_EXTRA_REVIEWS,
  type CmoPlanOfferVerdict,
  type CmoPlanReview,
  cmoCalendarLanguage,
  cmoCalendarRepeats,
  cmoCalendarWeeks,
  cmoDistinctClaims,
  cmoDraftProblems,
  cmoNewNetworkProblems,
  cmoPillarFactProblems,
  cmoPillarFacts,
  cmoPlanDrift,
  cmoPlanProblemsSince,
  cmoRejectedTermProblems,
  cmoRejectedTerms,
  cmoReplySafety,
  cmoSideChannelFit,
  cmoSpreadPoints,
  cmoStrategyRules,
} from "@/services/cmo-plan-review.service";
import {
  cmoPraiseOnly,
  cmoProofPoints,
} from "@/services/cmo-production.service";
import { reportCmoUpdate } from "@/services/cmo-reports.service";
import {
  cmoSiteFacts,
  readCmoSitePages,
} from "@/services/cmo-site-pages.service";
import {
  cmoTurnExecutesPlan,
  saveCmoStrategy,
} from "@/services/cmo-strategy.service";
import {
  approvedMarketingStrategy,
  cmoChangeKind,
  isMarketingFilePiece,
  parseMarketingPlan,
  readMarketingPlan,
  STRATEGY_TURN_PREFIX,
} from "@/services/marketing-strategy.service";
import {
  handleSocialComment,
  SocialCommentRefusedError,
  socialCommentText,
} from "@/services/social-comments.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actsForOwner } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

/**
 * Cuso's daily reply round, one comment at a time. Replies post on his own
 * runs once the owner approved his plan, or when the owner asks in chat;
 * each passes a safety check first, and a held one goes to the owner.
 */
export async function handleCmoComment(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: ExecuteSokoBotToolInput,
) {
  const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS.handle_social_comment.parse(
    input.input,
  );
  // As with the plan: only the owner's own turns act in the brand's name,
  // and a cancelled or paused turn acts on nothing.
  if (!actsForOwner(authorized)) {
    throw new SokoBotRuntimeAuthorizationError(
      "Only the owner's turns answer comments in the brand's name",
    );
  }
  await prisma.$transaction((tx) =>
    runtime.requireMutationAuthority(tx, authorized, false, input.capability),
  );
  const scope = await runtime.socialCommentScopeOf(authorized);
  try {
    if (parsed.action !== "reply") {
      return await handleSocialComment({
        projectId: scope.projectId,
        commentId: parsed.commentId,
        action: parsed.action,
        note: parsed.note,
      });
    }
    if (!(await runtime.mayActForOwner(authorized)))
      throw new SokoBotRuntimeAuthorizationError(
        "Replies post on your approved daily run or when the owner asks in chat.",
      );
    const comment = await socialCommentText(scope.projectId, parsed.commentId);
    if (comment === null)
      throw new SokoBotRuntimeValidationError("No such comment.");
    const check = await cmoReplySafety({
      brain: parseBrandBrain(scope.brandBrain),
      comment,
      reply: parsed.reply ?? "",
    });
    if (check.costUsd > 0) {
      await prisma.sokoBotTurn.update({
        where: { id: authorized.turn.id },
        data: {
          overheadCostUsdMicros: {
            increment: BigInt(Math.round(check.costUsd * 1_000_000)),
          },
        },
      });
    }
    if (!check.safe) {
      await handleSocialComment({
        projectId: scope.projectId,
        commentId: parsed.commentId,
        action: "owner",
        note: `Held for you. Cuso's draft reply: ${parsed.reply ?? ""}`,
      });
      return {
        status: "owner",
        note: "The safety check held this reply; it now waits for the owner. Mention it in your report.",
      };
    }
    return await handleSocialComment({
      projectId: scope.projectId,
      commentId: parsed.commentId,
      action: "reply",
      reply: parsed.reply,
    });
  } catch (error) {
    if (error instanceof SocialCommentRefusedError)
      throw new SokoBotRuntimeValidationError(error.message);
    if (error instanceof ComposioToolError)
      throw new SokoBotRuntimeValidationError(
        "The network refused this reply. Hand the comment to the owner.",
      );
    throw error;
  }
}

/** Cuso's Brand Brain, strategy and reports, written to his Project. */
/** What a check's model call cost, charged to the turn like its steps. */
export async function chargeCheck(
  input: Pick<ExecuteSokoBotToolInput, "turnId" | "sessionId">,
  modelId: string,
  costUsd: number,
): Promise<void> {
  if (costUsd <= 0) return;
  await new RuntimeEventLog(input.turnId, input.sessionId).append(
    runtimeEvent("step.completed", { modelId, usage: { costUsd } }),
  );
}

/**
 * The plan's review while it waits for approval: the strategy skill's hard
 * rules, and whether it sells the main offer. Bounded per turn, so a plan
 * that cannot be fixed still ends. Approved plans are the daily run's to
 * change and are not reviewed.
 */
export async function reviewCmoPlan(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: ExecuteSokoBotToolInput,
  plan: {
    /** The version saved is the approved one (pieces of the running plan). */
    approved: boolean;
    projectId: string;
    /** A rhythm or production turn: it built on the approved version. */
    executing: boolean;
    strategy: MarketingStrategyPlan | null;
    planSent: boolean;
    /** This save is part calendar. */
    calendarSent: boolean;
    /** The version this save landed in. */
    versionId?: string;
  },
): Promise<CmoPlanReview | null> {
  let { strategy } = plan;
  if (!strategy || plan.approved) return null;
  // Only saves that landed count: a refused save saved nothing to review.
  const landedBefore = {
    turnId: authorized.turn.id,
    capability: "save_strategy",
    status: "COMPLETED" as const,
    NOT: { toolCallId: input.toolCallId },
  };
  const saves =
    (await prisma.sokoBotToolCall.count({ where: landedBefore })) + 1;
  // A plan saved in parts lands its calendar last, so calendar saves have
  // their own reviews, however many plan and patch saves came before.
  const reviewed = plan.calendarSent
    ? await prisma.sokoBotToolCall.count({
        // The review, not the input: a calendar's input is too long to keep
        // whole, so its part is not stored.
        where: {
          ...landedBefore,
          result: { path: ["review", "calendar"], equals: true },
        },
      })
    : saves - 1;
  const budget = plan.calendarSent
    ? CMO_CALENDAR_REVIEWS_PER_TURN
    : CMO_PLAN_REVIEWS_PER_TURN;
  // A weekly Cuso saves a long month in four calendar calls first.
  const rules = cmoStrategyRules(
    getSokoBotVersion(authorized.turn.versionId).skills,
  );
  const weekly = rules.weekly === true;
  // Jev reads the first saves only; the rule checks cost nothing and run on
  // a few more, so a late save still hears about a repeated title. Past
  // that the review stops, so a plan that cannot be fixed still ends.
  // A cmo-v8 Cuso also fixes his repeated claims in short patches after the
  // month is in: his last saves were past the cap and never heard the list.
  const ruleChecks =
    2 * budget +
    (weekly && plan.calendarSent ? CMO_WEEKLY_EXTRA_REVIEWS : 0) +
    (rules.claims && plan.calendarSent ? CMO_WEEKLY_EXTRA_REVIEWS : 0);
  // cmo-v8: once the month is in, Core gives each repeated claim's later
  // pieces their own claim on the saved version, on every save: a month of
  // twenty saves once used up the reviews before its fourth week was in.
  if (
    rules.claims &&
    plan.versionId &&
    cmoCalendarWeeks(strategy.calendar) >= 4
  ) {
    // Points the month makes too often, across every network: the later
    // pieces move onto points of their own, from the Brand Brain's facts.
    const owner = await prisma.sokoBot.findUnique({
      where: { id: authorized.turn.sokoBotId },
      select: { projectId: true },
    });
    const brain = owner?.projectId
      ? parseBrandBrain((await getBrandBrain(owner.projectId))?.body)
      : null;
    const praise = await cmoPraiseOnly(cmoProofPoints(brain));
    await chargeCheck(input, SOKO_BOT_JEV_MODEL, praise.costUsd);
    const facts = cmoPointFacts(brain, praise.points);
    const spread = await cmoSpreadPoints(strategy.calendar, facts);
    await chargeCheck(input, COMPETITOR_CHECK_MODEL, spread.costUsd);
    if (spread.pieces.size > 0)
      strategy = await withEntries(plan.versionId, spread.pieces, strategy);
    for (let pass = 0; pass < DISTINCT_CLAIM_PASSES; pass++) {
      const distinct = await cmoDistinctClaims(strategy.calendar);
      await chargeCheck(input, COMPETITOR_CHECK_MODEL, distinct.costUsd);
      if (distinct.claims.size === 0) break;
      strategy = await withEntries(
        plan.versionId,
        new Map([...distinct.claims].map(([id, claim]) => [id, { claim }])),
        strategy,
      );
    }
  }
  if (reviewed >= ruleChecks) return null;
  // The plan this turn built on, as it was before the turn touched it.
  const before =
    (plan.executing ? await approvedMarketingStrategy(plan.projectId) : null) ??
    (await prisma.marketingStrategy.findFirst({
      where: {
        projectId: plan.projectId,
        OR: [
          { authorTurnId: null },
          { authorTurnId: { not: authorized.turn.id } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { plan: true },
    }));
  const earlier = parseMarketingPlan(before?.plan);
  // A new month (a plan or finish turn, not an owner's change) is held to
  // the top volume whatever the month before it had.
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { clientTurnId: true, userMessage: true, source: true },
  });
  const fresh =
    turn?.clientTurnId?.startsWith(STRATEGY_TURN_PREFIX) === true &&
    cmoChangeKind(turn.clientTurnId) === null &&
    !turn.userMessage.includes("The owner asked: ");
  // cmo-v14: a network the business connected is never left out.
  // Its other Cuso's accounts for the same website count too.
  const cuso = rules.channelFit
    ? await findCusoForBot(authorized.turn.sokoBotId)
    : null;
  const connectedNetworks = cuso ? await cmoSiteAccountNetworks(cuso) : [];
  const problems = cmoPlanProblemsSince(strategy, earlier, {
    ...rules,
    fresh,
    connectedNetworks,
  });
  // cmo-v8: what the owner's correction rejected is gone from every field.
  if (
    rules.claims &&
    turn &&
    (cmoChangeKind(turn.clientTurnId) !== null || turn.source === "CHAT")
  ) {
    const rejected = await cmoRejectedTerms(
      authorized.turn.id,
      turn.userMessage,
      earlier,
    );
    await chargeCheck(input, COMPETITOR_CHECK_MODEL, rejected.costUsd);
    problems.push(...cmoRejectedTermProblems(strategy, rejected.terms));
  }
  // Titles, stories and claims that say one thing in other words, by
  // meaning; like the rules above, only those this change brought.
  // Embeddings are cached, so the earlier calendar costs nothing new. A
  // cmo-v8 Cuso saves a month in four calendar calls: each of them hears the
  // repeats among the entries it sent, and once all four weeks are in he
  // hears every one. Named all at once on every weekly save, they kept him
  // fixing old weeks and his months came out short.
  const monthIn = cmoCalendarWeeks(strategy.calendar) >= 4;
  const whole = reviewed < budget || (rules.claims === true && monthIn);
  if (whole || rules.claims) {
    const [repeats, had] = await Promise.all([
      cmoCalendarRepeats(strategy.calendar),
      earlier && earlier.calendar.length > 0
        ? cmoCalendarRepeats(earlier.calendar)
        : { problems: [], costUsd: 0 },
    ]);
    await chargeCheck(input, EMBEDDING_MODEL, repeats.costUsd + had.costUsd);
    const known = new Set(had.problems);
    const sent = sentEntryIds(input.input);
    problems.push(
      ...repeats.problems.filter(
        (problem) =>
          !known.has(problem) && (whole || namesAnyEntry(problem, sent)),
      ),
    );
  }
  if (reviewed >= budget) {
    return {
      save: saves,
      calendar: plan.calendarSent,
      mainOffer: "skipped",
      problems,
    };
  }
  if (plan.calendarSent) {
    const language = await cmoCalendarLanguage(strategy, earlier);
    problems.push(...language.problems);
    await chargeCheck(input, SOKO_BOT_JEV_MODEL, language.costUsd);
  }
  // A cmo-v3 side channel serves one buyer: Jev reads its titles against them.
  if (weekly && plan.calendarSent) {
    const fit = await cmoSideChannelFit(strategy);
    problems.push(...fit.problems);
    await chargeCheck(input, SOKO_BOT_JEV_MODEL, fit.costUsd);
  }
  // Every save, a patch or the calendar too: the rules read the plan as
  // saved, so a patch cannot drop a fix the last review asked for.
  const bot = await prisma.sokoBot.findUnique({
    where: { id: authorized.turn.sokoBotId },
    select: { projectId: true },
  });
  const brain = bot?.projectId
    ? parseBrandBrain((await getBrandBrain(bot.projectId))?.body)
    : null;
  if (rules.everyNetwork && brain)
    problems.push(...cmoNewNetworkProblems(strategy, brain, connectedNetworks));
  // cmo-v21: every pillar is an industry topic resting on the research.
  const topics =
    rules.industryTopics && plan.planSent && bot?.projectId
      ? await cmoIndustryPillarProblems(bot.projectId, strategy).catch(
          () => null,
        )
      : null;
  if (topics) {
    await chargeCheck(input, COMPETITOR_CHECK_MODEL, topics.costUsd);
    problems.push(...topics.problems);
  }
  // cmo-v20: every pillar rests on at least three Brand Brain facts.
  if (
    !topics &&
    rules.pillarFacts &&
    plan.planSent &&
    brain &&
    bot?.projectId
  ) {
    const pillars = await cmoPillarFacts(
      strategy,
      brain,
      undefined,
      cmoSiteFacts(
        (await readCmoSitePages(bot.projectId).catch(() => null))?.pages ?? [],
      ),
    ).catch(() => null);
    if (pillars) {
      await chargeCheck(input, COMPETITOR_CHECK_MODEL, pillars.costUsd);
      problems.push(...cmoPillarFactProblems(pillars.pillars));
    }
  }
  let mainOffer: CmoPlanOfferVerdict = "skipped";
  if (plan.planSent && brain) {
    const drift = await cmoPlanDrift({ strategy, brain });
    mainOffer = drift.verdict;
    if (drift.problem) problems.push(drift.problem);
    await chargeCheck(input, SOKO_BOT_JEV_MODEL, drift.costUsd);
  }
  const review = {
    save: saves,
    calendar: plan.calendarSent,
    mainOffer,
    problems,
  };
  tryUseLogger()?.set({
    cmoPlanReview: {
      sokoBotId: authorized.turn.sokoBotId,
      turnId: authorized.turn.id,
      save: saves,
      mainOffer,
      problems: problems.length,
    },
  });
  return review;
}

/** New claims, checked again: a rewrite can land close to another claim. */
const DISTINCT_CLAIM_PASSES = 3;

/** What a point needs from the Brand Brain: its proof, products and offers. */
function cmoPointFacts(
  brain: BrandBrain | null,
  proof: readonly string[],
): string[] {
  if (!brain) return [];
  return [
    ...proof,
    ...brain.products,
    ...(brain.offers ?? []).map(
      (offer) => `${offer.name}: ${offer.what} (${offer.price})`,
    ),
  ].slice(0, 60);
}

/** The saved version with these entries' fields replaced; `fallback` when it is gone. */
async function withEntries(
  versionId: string,
  changes: ReadonlyMap<
    string,
    Partial<MarketingStrategyPlan["calendar"][number]>
  >,
  fallback: MarketingStrategyPlan,
): Promise<MarketingStrategyPlan> {
  const version = await prisma.marketingStrategy.findUnique({
    where: { id: versionId },
    select: { plan: true, approvedAt: true },
  });
  const stored = parseMarketingPlan(version?.plan);
  if (!stored || version?.approvedAt) return fallback;
  const plan = {
    ...stored,
    calendar: stored.calendar.map((entry) => {
      const change = changes.get(entry.id);
      return change ? { ...entry, ...change } : entry;
    }),
  };
  await prisma.marketingStrategy.update({
    where: { id: versionId },
    data: { plan: jsonInput(plan) },
  });
  return plan;
}

/** The calendar entries one save_strategy call sends, by id. */
function sentEntryIds(input: unknown): Set<string> {
  const calendar = (input as { strategy?: { calendar?: unknown } } | null)
    ?.strategy?.calendar;
  return new Set(
    Array.isArray(calendar)
      ? calendar.flatMap((entry) => {
          const id = (entry as { id?: unknown } | null)?.id;
          return typeof id === "string" ? [id] : [];
        })
      : [],
  );
}

/** Whether a review problem's list of entries names one of `ids`. */
export function namesAnyEntry(
  problem: string,
  ids: ReadonlySet<string>,
): boolean {
  const named = problem.split(/ (?:say|argue|tell) one /)[0] ?? "";
  return named.split(", ").some((id) => ids.has(id.trim()));
}

export async function saveCmoRecord(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: ExecuteSokoBotToolInput,
) {
  if (getSokoBotVersion(authorized.turn.versionId).profile !== "cmo") {
    throw new SokoBotRuntimeAuthorizationError(
      "Only a CMO assistant keeps a Brand Brain, strategy and reports",
    );
  }
  // A teammate's turn never sees the plan (no marketing packet), so it may
  // not rewrite it either.
  if (!actsForOwner(authorized)) {
    throw new SokoBotRuntimeAuthorizationError(
      "Only the owner's turns change the Brand Brain, strategy and reports",
    );
  }
  const where = { sokoBotId: authorized.turn.sokoBotId };
  // The write and the cancellation/pause check share one lock, so a
  // cancelled or paused turn's save never lands.
  const write = <T>(save: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await runtime.requireMutationAuthority(
        tx,
        authorized,
        false,
        input.capability,
      );
      return save(tx);
    });
  const run = async (): Promise<{
    targetId: string;
    result: Record<string, unknown>;
  }> => {
    switch (input.capability) {
      case "save_brand_brain": {
        const save = SOKO_BOT_TOOL_INPUT_SCHEMAS.save_brand_brain.parse(
          input.input,
        );
        // The Brand Brain is the Project's (ADR 0062): Cuso's own Project.
        const saved = await write(async (tx) => {
          const bot = await tx.sokoBot.findUnique({
            where: { id: authorized.turn.sokoBotId },
            select: { projectId: true },
          });
          if (!bot?.projectId)
            throw new SokoBotRuntimeValidationError(
              "A Brand Brain belongs to a Project, and this bot has none.",
            );
          // A fix turn's brief holds the corrections asked before it.
          const turn = await tx.sokoBotTurn.findUnique({
            where: { id: authorized.turn.id },
            select: { createdAt: true },
          });
          return saveBrandBrain(bot.projectId, save, tx, {
            briefedAt: turn?.createdAt,
            by: "cuso",
          });
        });
        if (save.brandBrain) scheduleCmoBrandMedia(authorized.turn.sokoBotId);
        if (save.brandBrain || save.reveal)
          await syncTrackedCompetitorsFromBrandBrain(saved.projectId).catch(
            (error) =>
              recordCoreWarning(
                {
                  operation: "cmo_competitor_sync",
                  project: { id: saved.projectId },
                },
                {
                  message: "Could not fill the tracked competitors",
                  why: "Reading them from the saved Brand Brain threw",
                  fix: "The Brand Brain is saved. The weekly competitor check fills the list again before it runs.",
                },
                { failure: messageSafeErrorFields(error) },
              ),
          );
        const stored = parseBrandBrain(saved.body);
        // The owner opens on the reveal and answers the questions next, so
        // essentials without them leave two empty screens.
        const missing = stored
          ? [
              ...(stored.reveal ? [] : ["reveal"]),
              ...(stored.questions.length > 0 ? [] : ["questions"]),
            ]
          : [];
        // A first read in parts ends on this save: no closing step.
        const endTurn = save.brandBrain
          ? (
              await import("@/services/cmo-hiring.service")
            ).cmoResearchEndAnswer(
              {
                clientTurnId:
                  (
                    await prisma.sokoBotTurn.findUnique({
                      where: { id: authorized.turn.id },
                      select: { clientTurnId: true },
                    })
                  )?.clientTurnId ?? null,
                versionId: authorized.turn.versionId,
              },
              stored,
            )
          : undefined;
        return {
          targetId: saved.id,
          result: {
            saved: "brandBrain",
            sections: brandBrainSectionsSaved(saved.body),
            essentials: stored !== null,
            updatedAt: saved.updatedAt?.toISOString(),
            ...(missing.length > 0
              ? {
                  missing,
                  next: `Send ${missing.join(" and ")} with save_brand_brain, on their own (no brandBrain): they add to the essentials you saved.`,
                }
              : {}),
            ...(endTurn ? { endTurn } : {}),
          },
        };
      }
      case "save_strategy": {
        const sent = parseCmoStrategySave(input.input);
        const part = cmoStrategySavePart(input.input);
        const pieces = part === "pieces";
        // A rhythm or production run builds on the approved version.
        const turn = await prisma.sokoBotTurn.findUnique({
          where: { id: authorized.turn.id },
          select: { source: true, clientTurnId: true },
        });
        const executing = turn ? cmoTurnExecutesPlan(turn) : false;
        if (pieces) {
          const unread = await unreadCompetitorAdKeywords(
            (await requireCuso(where)).projectId,
            sent.calendar ?? [],
          );
          if (unread.length > 0)
            throw new SokoBotRuntimeValidationError(
              `save_strategy saved nothing: an ad on competitor searches takes only keywords research_competitor_keywords returned (the search and its alsoSearchedAs, spelled the same). Not among them: ${unread.join(", ")}. Take them out, or give a general ad its own entry without campaignId "${COMPETITOR_SEARCHES_CAMPAIGN}".`,
            );
        }
        const saved = await write((tx) =>
          saveCmoStrategy(
            where,
            sent,
            {
              turnId: authorized.turn.id,
              part,
              executing,
              clear: cmoStrategySaveClears(input.input),
              pictureKinds: cmoMakesVariedMonth(authorized.turn.versionId),
              sceneVisuals: cmoWritesSceneVisuals(authorized.turn.versionId),
              // A plan, change or patch that breaks a hard rule is refused
              // at save time. A rhythm's save sees only 31 days of the
              // calendar, so the review only advises it.
              rules: !pieces && !executing,
            },
            tx,
          ),
        );
        const approved = saved.approvedAt !== null;
        // Fields sent empty were filler: say they stayed, so nobody reads
        // the call as having cleared them.
        const leftAsSaved = pieces
          ? []
          : Object.entries(sent)
              .filter(
                ([key, value]) =>
                  key !== "changes" &&
                  key !== "calendar" &&
                  !cmoStrategySaveClears(input.input).includes(key) &&
                  (value === "" ||
                    (Array.isArray(value) && value.length === 0)),
              )
              .map(([key]) => key);
        // Pieces that are not Social posts become the Project's Files.
        const filed =
          pieces && approved
            ? await runtime.writeCmoPieceFiles(authorized, saved, sent)
            : 0;
        // Visuals saved in a run: Core starts their pictures now.
        if (pieces && approved && executing)
          await startCmoProduction(authorized.turn.sokoBotId);
        // A running plan's social pieces are its Social posts.
        const stored = await readMarketingPlan(saved);
        const calendar = stored?.calendar ?? [];
        const review = await runtime.reviewCmoPlan(authorized, input, {
          approved,
          projectId: saved.projectId,
          executing,
          strategy: stored,
          planSent: sent.summary !== undefined,
          calendarSent: part === "calendar",
          versionId: saved.id,
        });
        // Once the plan runs, the drafts are checked against the copy rules,
        // a filed piece's words as sent (the calendar holds only its file).
        const drafts = approved
          ? await cmoDraftProblems([
              ...calendar,
              ...(sent.calendar ?? []).filter(
                (entry) => isMarketingFilePiece(entry) && Boolean(entry.draft),
              ),
            ])
          : { problems: [], costUsd: 0 };
        await chargeCheck(input, EMBEDDING_MODEL, drafts.costUsd);
        const draftProblems = drafts.problems;
        const written = (entry: (typeof calendar)[number]) =>
          Boolean(entry.draft || entry.fileId);
        // Says which pieces still have no draft.
        const undrafted = calendar
          .filter((entry) => entry.status !== "skipped" && !written(entry))
          .map((entry) => entry.date)
          .sort();
        return {
          targetId: saved.id,
          result: {
            saved: "strategy",
            versionId: saved.id,
            approved,
            updatedAt: saved.updatedAt.toISOString(),
            entries: calendar.length,
            drafted: calendar.filter(written).length,
            ...(filed > 0 ? { filed } : {}),
            ...(leftAsSaved.length > 0 ? { leftAsSaved } : {}),
            undrafted: undrafted.length,
            ...(undrafted[0] ? { firstUndrafted: undrafted[0] } : {}),
            ...(review ? { review } : {}),
            ...(review && review.problems.length > 0
              ? {
                  problems: review.problems,
                  next: "Fix these and save again: part plan for the strategy, part calendar for the calendar.",
                }
              : draftProblems.length > 0
                ? {
                    problems: draftProblems,
                    next: "Rewrite these drafts: the Social posts (by their ids) together in one update_social_posts call, any other piece with save_strategy part pieces.",
                  }
                : {}),
          },
        };
      }
      default: {
        const update = SOKO_BOT_TOOL_INPUT_SCHEMAS.report_update.parse(
          input.input,
        );
        const turn = await prisma.sokoBotTurn.findUnique({
          where: { id: authorized.turn.id },
          select: { clientTurnId: true },
        });
        const record = await write((tx) =>
          reportCmoUpdate(
            {
              sokoBotId: authorized.turn.sokoBotId,
              turnId: authorized.turn.id,
              toolCallId: input.toolCallId,
              update,
              production:
                turn?.clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX) ===
                true,
            },
            tx,
          ),
        );
        const { publishChatRoomMessageRealtimeById } = await import(
          "@/helpers/chat-room-message-realtime"
        );
        await publishChatRoomMessageRealtimeById(record.id, "create");
        return {
          targetId: record.id,
          result: {
            reported: record.kind,
            id: record.id,
            revertible: record.previousVersionId !== undefined,
          },
        };
      }
    }
  };
  const { targetId, result } = await run().catch((error: unknown) => {
    if (
      error instanceof CmoNotFoundError ||
      (error instanceof HTTPException && error.status === 422)
    ) {
      throw new SokoBotRuntimeValidationError(error.message);
    }
    throw error;
  });
  await serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      input.capability,
    );
    await commitActionReceipt(tx, {
      turnId: authorized.turn.id,
      toolCallId: input.toolCallId,
      actorBotId: authorized.turn.sokoBotId,
      targetId,
      result: persistedToolResult(result),
    });
  }, "CMO record changed concurrently");
  return result;
}
