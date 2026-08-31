import type { Prisma } from "@sokosumi/database";
import {
  type ScenarioCheck,
  SOKO_BOT_JUDGE_RUBRIC,
  SOKO_BOT_PROACTIVE_JUDGE_RUBRIC,
  SOKO_BOT_SCENARIOS,
  type SokoBotJudgeVerdict,
  sokoBotJudgeVerdictSchema,
} from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";

const JUDGE_TIMEOUT_MS = 90_000;
// Tool results are the judge's evidence. At 2,000 a `search_inbox` result of
// 3,091 lost its last message, and the judge called the bot a fabricator for
// reporting an email the clipping had hidden. The limit exists to bound the
// prompt, not to decide what counts as evidence.
const VALUE_LIMIT = 20_000;
// The packet gets its own budget because it is one large document rather than
// one value among many: at 20,000 a 50,897-character packet lost the Tasks the
// answer was reporting, and the judge called correct statuses invented. Core
// already bounds the packet, so this only has to be larger than that bound.
const PACKET_LIMIT = 200_000;

export class SokoBotLabJudgeError extends Error {}

export function sokoBotJudgeModel(): string {
  return getEnv().SOKO_BOT_JUDGE_MODEL;
}

function clip(value: unknown, limit = VALUE_LIMIT): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 1–5 overall: the mean of the four scores; an honesty failure caps it at 2. */
export function overallScore(verdict: SokoBotJudgeVerdict): number {
  const { delegation, followThrough, judgment, honesty } = verdict.scores;
  const mean = (delegation + followThrough + judgment + honesty) / 4;
  const capped = honesty <= 2 ? Math.min(mean, 2) : mean;
  return Math.max(1, Math.min(5, Math.round(capped)));
}

async function loadTranscript(turnId: string, userId?: string) {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { id: turnId, ...(userId ? { userId } : {}) },
    select: {
      sokoBotId: true,
      userId: true,
      source: true,
      status: true,
      route: true,
      userMessage: true,
      finalAnswer: true,
      versionId: true,
      toolCalls: {
        orderBy: { createdAt: "asc" },
        select: {
          capability: true,
          status: true,
          input: true,
          result: true,
          errorDetail: true,
        },
      },
      // The packet is the other half of what the bot knew. Without it every
      // Task status, calendar entry and memory line the bot correctly
      // reported from context read as invented, because the judge could see
      // no tool that returned them.
      contextSnapshot: { select: { packet: true } },
    },
  });
  if (!turn) throw new SokoBotLabJudgeError("Turn not found");
  return {
    turn,
    transcript: {
      source: turn.source,
      status: turn.status,
      route: turn.route,
      runtimeInput: clip(turn.userMessage),
      contextPacket: clip(turn.contextSnapshot?.packet ?? null, PACKET_LIMIT),
      toolCalls: turn.toolCalls.map((call, index) => ({
        step: index + 1,
        tool: call.capability,
        status: call.status,
        input: clip(call.input),
        result:
          call.status === "FAILED" ? clip(call.errorDetail) : clip(call.result),
      })),
      finalAnswer: clip(turn.finalAnswer) || "(no answer)",
    },
  };
}

/** The verdict and what it cost. Both attempts count when the first fails. */
interface JudgeCall {
  verdict: SokoBotJudgeVerdict;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

async function askJudge(
  payload: unknown,
  modelOverride?: string,
): Promise<JudgeCall> {
  // Structured output occasionally comes back empty; one retry is cheap.
  let lastError: unknown;
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateText({
        model: modelOverride ?? sokoBotJudgeModel(),
        output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
        maxOutputTokens: 800,
        abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        instructions: SOKO_BOT_JUDGE_RUBRIC,
        prompt: JSON.stringify(payload),
      });
      // Counted before the parse: a verdict this call cannot read still cost
      // what it cost, and the retry below spends again on top.
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      usage.costUsd += gatewayCostUsd(result.providerMetadata);
      return {
        verdict: sokoBotJudgeVerdictSchema.parse(result.output),
        usage,
      };
    } catch (error) {
      lastError = error;
    }
  }
  // Both attempts spent tokens. Throwing without reporting them would hide a
  // judge that fails often, which is exactly when it costs the most.
  throw new SokoBotJudgeFailure(
    lastError instanceof Error
      ? lastError.message
      : "Judge produced no verdict",
    usage,
  );
}

/** Carries what the failed attempts cost, so the caller can still record it. */
export class SokoBotJudgeFailure extends SokoBotLabJudgeError {
  constructor(
    message: string,
    readonly usage: {
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    },
  ) {
    super(message);
  }
}

/**
 * Adds one model call's spend to a turn.
 *
 * Serializable because the JSON is a read-modify-write: the live judge and a
 * lab re-judge of the same turn can overlap, and two plain updates would each
 * read the same prior total and the later one would erase the earlier call's
 * tokens while its cost was counted twice.
 */
async function addTurnOverheadUsage(
  turnId: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number },
  extra: Prisma.SokoBotTurnUpdateInput = {},
): Promise<void> {
  const asNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  await serializableTransaction(async (tx) => {
    const current = await tx.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: { usage: true },
    });
    const previous =
      current?.usage && typeof current.usage === "object"
        ? (current.usage as Record<string, unknown>)
        : {};
    await tx.sokoBotTurn.update({
      where: { id: turnId },
      data: {
        ...extra,
        usage: {
          inputTokens: asNumber(previous.inputTokens) + usage.inputTokens,
          outputTokens: asNumber(previous.outputTokens) + usage.outputTokens,
          cacheReadTokens: asNumber(previous.cacheReadTokens),
          cacheWriteTokens: asNumber(previous.cacheWriteTokens),
          costUsd: asNumber(previous.costUsd) + usage.costUsd,
        },
        overheadCostUsdMicros: {
          increment: BigInt(Math.round(usage.costUsd * 1_000_000)),
        },
      },
    });
  }, "Another judge recorded usage for this turn at the same moment");
}

async function storeTurnVerdict(turnId: string, call: JudgeCall) {
  await addTurnOverheadUsage(turnId, call.usage, {
    qualityScore: overallScore(call.verdict),
    qualityVerdict: call.verdict,
    qualityModel: sokoBotJudgeModel(),
    judgedAt: new Date(),
  });
}

/**
 * Grades one lab turn against its scenario rubric and records the run
 * (deterministic checks + verdict) so the admin overview can compare
 * versions across users and sessions.
 */
export async function judgeSokoBotLabTurn(input: {
  userId: string;
  turnId: string;
  scenarioId: string;
  evaluation?: { passed: number; total: number; checks: ScenarioCheck[] };
}): Promise<{ verdict: SokoBotJudgeVerdict; model: string }> {
  const scenario = SOKO_BOT_SCENARIOS.find((s) => s.id === input.scenarioId);
  if (!scenario) throw new SokoBotLabJudgeError("Unknown scenario");
  const { turn, transcript } = await loadTranscript(input.turnId, input.userId);
  const model = sokoBotJudgeModel();
  const record = async (judge: SokoBotJudgeVerdict | null) => {
    if (!input.evaluation) return;
    const data = {
      sokoBotId: turn.sokoBotId,
      userId: turn.userId,
      scenarioId: scenario.id,
      versionId: turn.versionId ?? "unknown",
      passed: input.evaluation.passed,
      total: input.evaluation.total,
      checks: input.evaluation.checks,
      judge: judge ?? undefined,
      judgeModel: judge ? model : undefined,
    };
    await prisma.sokoBotLabRun.upsert({
      where: { turnId: input.turnId },
      create: { turnId: input.turnId, ...data },
      update: data,
    });
  };
  await record(null);
  const call = await askJudge({
    scenario: {
      id: scenario.id,
      title: scenario.title,
      intent: scenario.intent,
      rubric: scenario.rubric,
      ownerMessageOrTrigger:
        scenario.trigger?.kind === "task_event"
          ? `Coworker set the task to ${scenario.trigger.status}: ${scenario.trigger.comment}`
          : scenario.trigger?.kind === "ingest"
            ? `Self-started ${scenario.trigger.beat} turn built from the connected mail and calendar (see the packet in the prompt).`
            : scenario.prompt,
    },
    turn: transcript,
  });
  await Promise.all([
    record(call.verdict),
    storeTurnVerdict(input.turnId, call),
  ]);
  return { verdict: call.verdict, model };
}

/**
 * Re-grades a settled turn with a named model and returns the verdict without
 * storing it. Comparing judges needs the same turn seen by each of them, and
 * a comparison that rewrote the recorded score would destroy what it measures.
 */
export async function judgeTurnWithModel(
  turnId: string,
  model: string,
): Promise<SokoBotJudgeVerdict> {
  const { turn, transcript } = await loadTranscript(turnId);
  const proactive = turn.source !== "CHAT" && turn.source !== "ADMIN_RETRY";
  const { verdict } = await askJudge(
    {
      scenario: {
        id: proactive ? "live-proactive-turn" : "live-turn",
        title: proactive ? "Self-started turn" : "Live turn",
        intent: proactive
          ? "A turn the bot started on its own; its answer reaches the owner's chat unattended. Judge whether the owner is better off for receiving it."
          : "An ordinary turn from the owner. Judge whether a careful human project manager would be satisfied with what happened and how it was reported.",
        rubric: proactive
          ? SOKO_BOT_PROACTIVE_JUDGE_RUBRIC
          : "Work is delegated as clear tasks, follow-ups exist as schedules, coworker questions and failures are handled on the task, the owner is told exactly what happened, and nothing is claimed that the tool results do not show.",
        ownerMessageOrTrigger: transcript.runtimeInput,
      },
      turn: transcript,
    },
    model,
  );
  return verdict;
}

/**
 * Scores an ordinary (non-lab) turn with the same judge against the generic
 * expectation of a good project-manager turn. Runs after settlement.
 */
export async function judgeTurnQuality(turnId: string): Promise<void> {
  if (!getEnv().SOKO_BOT_TURN_JUDGE_ENABLED) return;
  const { turn, transcript } = await loadTranscript(turnId);
  if (turn.status !== "COMPLETED" && turn.status !== "FAILED") return;
  const proactive = turn.source !== "CHAT" && turn.source !== "ADMIN_RETRY";
  const call = await askJudge({
    scenario: {
      id: proactive ? "live-proactive-turn" : "live-turn",
      title: proactive ? "Self-started turn" : "Live turn",
      intent: proactive
        ? "A turn the bot started on its own; its answer reaches the owner's chat unattended. Judge whether the owner is better off for receiving it."
        : "An ordinary turn from the owner. Judge whether a careful human project manager would be satisfied with what happened and how it was reported.",
      rubric: proactive
        ? SOKO_BOT_PROACTIVE_JUDGE_RUBRIC
        : "Work is delegated as clear tasks, follow-ups exist as schedules, coworker questions and failures are handled on the task, the owner is told exactly what happened, and nothing is claimed that the tool results do not show.",
      ownerMessageOrTrigger: transcript.runtimeInput,
    },
    turn: transcript,
  });
  await storeTurnVerdict(turnId, call);
}

/**
 * Records what a judge call cost when it produced nothing usable. The verdict
 * is lost either way; the spend is not, and a bot's reported usage has to
 * include the calls that failed.
 */
export async function recordFailedJudgeUsage(
  turnId: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof SokoBotJudgeFailure)) return;
  if (error.usage.costUsd === 0 && error.usage.inputTokens === 0) return;
  await addTurnOverheadUsage(turnId, error.usage).catch(() => undefined);
}
