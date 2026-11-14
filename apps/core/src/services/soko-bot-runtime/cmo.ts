import { type Prisma } from "@sokosumi/database";
import {
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
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { tryUseLogger } from "@/lib/evlog";
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
  CmoNotFoundError,
  startCmoProduction,
} from "@/services/cmo-cuso.service";
import {
  CMO_PLAN_REVIEWS_PER_TURN,
  type CmoPlanOfferVerdict,
  type CmoPlanReview,
  cmoDraftProblems,
  cmoPlanDrift,
  cmoPlanProblemsSince,
  cmoReplySafety,
} from "@/services/cmo-plan-review.service";
import { reportCmoUpdate } from "@/services/cmo-reports.service";
import {
  cmoTurnExecutesPlan,
  saveCmoStrategy,
} from "@/services/cmo-strategy.service";
import {
  approvedMarketingStrategy,
  isMarketingFilePiece,
  parseMarketingPlan,
  readMarketingPlan,
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
  },
): Promise<CmoPlanReview | null> {
  const { strategy } = plan;
  if (!strategy || plan.approved) return null;
  const saves = await prisma.sokoBotToolCall.count({
    where: { turnId: authorized.turn.id, capability: "save_strategy" },
  });
  // Jev reads the first saves only; the rule checks cost nothing and run on
  // a few more, so a late save still hears about a repeated title. Past
  // that the review stops, so a plan that cannot be fixed still ends.
  if (saves > 2 * CMO_PLAN_REVIEWS_PER_TURN) return null;
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
  const problems = cmoPlanProblemsSince(
    strategy,
    parseMarketingPlan(before?.plan),
  );
  if (saves > CMO_PLAN_REVIEWS_PER_TURN) {
    return { save: saves, mainOffer: "skipped", problems };
  }
  const bot = plan.planSent
    ? await prisma.sokoBot.findUnique({
        where: { id: authorized.turn.sokoBotId },
        select: { projectId: true },
      })
    : null;
  const brain = bot?.projectId
    ? parseBrandBrain((await getBrandBrain(bot.projectId))?.body)
    : null;
  let mainOffer: CmoPlanOfferVerdict = "skipped";
  if (plan.planSent && brain) {
    const drift = await cmoPlanDrift({ strategy, brain });
    mainOffer = drift.verdict;
    if (drift.problem) problems.push(drift.problem);
    if (drift.costUsd > 0) {
      await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
        runtimeEvent("step.completed", {
          modelId: SOKO_BOT_JEV_MODEL,
          usage: { costUsd: drift.costUsd },
        }),
      );
    }
  }
  const review = { save: saves, mainOffer, problems };
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
          return saveBrandBrain(bot.projectId, save, tx);
        });
        if (save.brandBrain) scheduleCmoBrandMedia(authorized.turn.sokoBotId);
        const stored = parseBrandBrain(saved.body);
        // The owner opens on the reveal and answers the questions next, so
        // essentials without them leave two empty screens.
        const missing = stored
          ? [
              ...(stored.reveal ? [] : ["reveal"]),
              ...(stored.questions.length > 0 ? [] : ["questions"]),
            ]
          : [];
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
          },
        };
      }
      case "save_strategy": {
        const sent = parseCmoStrategySave(input.input);
        const pieces = cmoStrategySavePart(input.input) === "pieces";
        // A rhythm or production run builds on the approved version.
        const turn = await prisma.sokoBotTurn.findUnique({
          where: { id: authorized.turn.id },
          select: { source: true, clientTurnId: true },
        });
        const executing = turn ? cmoTurnExecutesPlan(turn) : false;
        const saved = await write((tx) =>
          saveCmoStrategy(
            where,
            sent,
            {
              turnId: authorized.turn.id,
              pieces,
              executing,
              clear: cmoStrategySaveClears(input.input),
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
        });
        // Once the plan runs, the drafts are checked against the copy rules,
        // a filed piece's words as sent (the calendar holds only its file).
        const draftProblems = approved
          ? cmoDraftProblems([
              ...calendar,
              ...(sent.calendar ?? []).filter(
                (entry) => isMarketingFilePiece(entry) && Boolean(entry.draft),
              ),
            ])
          : [];
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
                    next: "Rewrite these drafts: a Social post (by its id) with update_social_post, any other piece with save_strategy part pieces.",
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
