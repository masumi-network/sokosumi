import { randomUUID } from "node:crypto";
import type { SokoBotRuntimeEvent } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  getSokoBotVersion,
  type IndexedRuntimeEvent,
  type RuntimeCancelInput,
  type RuntimeEventStreamInput,
  type RuntimeHealth,
  type RuntimeInspectInput,
  type RuntimeJsonValue,
  type RuntimeResetInput,
  type RuntimeTurnInput,
  type RuntimeTurnRef,
  SOKO_BOT_TOOL_DESCRIPTIONS,
  type SokoBotRuntime,
  sokoBotToolInputSchema,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { type ToolSet, tool } from "ai";
import { reportAiGatewayBudgetFailure } from "@/lib/ai-gateway-budget";
import {
  aiGatewayBudgetScope,
  GATEWAY_INTERNAL_SERVER_ERROR,
} from "@/lib/ai-gateway-budget-error";
import { aiGatewayApiKey } from "@/lib/ai-gateway-purpose";
import { loadSokoBotTurnPurpose } from "@/lib/ai-gateway-turn-purpose";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { runAsBackgroundWork } from "@/lib/evlog";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import { modelCallTelemetryFor } from "@/lib/soko-bot/model-call-roles";
import { withModelCallTurn } from "@/lib/soko-bot/model-calls";
import {
  assertSokoBotInferenceRegion,
  sokoBotInferenceEvidence,
  sokoBotModelRequest,
} from "@/lib/soko-bot/model-policy";
import { SokoBotReconciliationLeaseLostError } from "@/lib/soko-bot/reconciliation-lease";
import { SETTLEMENT_TRIGGER_EVENT_TYPES } from "@/lib/soko-bot/runtime-stream";
import { IN_PROCESS_RUNTIME_VERSION } from "@/lib/soko-bot/runtime-version";
import { streamModelCall } from "@/lib/soko-bot/stream-model-call";
import {
  modelUserMessage,
  withReplyLanguage,
} from "@/lib/soko-bot/turn-model-context";
import { runTurnLoop, type TurnLoopInput } from "@/soko-bot-runner/loop";
import { runCoreWebTool } from "./core-web-tools";
import { evaluateTurnDoneCheck, openStepsNote } from "./done-check";
import {
  evaluationBinding,
  evaluationHistory,
  prepareEvaluationStep,
  withEvaluationTurn,
} from "./evaluation-dispatch";
import { recordTurnStepFocusOutcome, selectTurnStepFocus } from "./step-focus";
import { estimateInputTokens, turnTokenBudget } from "./turn-budget";
import {
  announceTurn,
  changeTools,
  closeTurn,
  failTurn,
  finishTurn,
  prepareTurn,
  RuntimeEventLog,
  runTurnTool,
  runtimeEvent,
  sokoBotInputTokenBudget,
  sokoBotMaxSteps,
} from "./turn-loop";
import {
  partMessage,
  partTools,
  TURN_PART_MAX_MS,
  TURN_PART_MAX_STEPS,
  withPartHandOvers,
} from "./turn-parts";

/**
 * Vercel kills Core at `maxDuration` (300s), and a killed invocation writes
 * neither `turn.failed` nor `session.waiting`. Stopping first keeps the loop
 * able to settle itself.
 */
const VERCEL_TURN_BUDGET_MS = 240_000;

/** A turn at its deadline still gets this long to fail and settle itself. */
const MIN_TURN_BUDGET_MS = 1_000;

/**
 * How long this turn may run here: until its own deadline, as in the
 * sandbox, but on Vercel no longer than one invocation can live.
 */
async function turnBudget(turnId: string): Promise<{
  ms: number;
  inputTokens: number;
  maxSteps: number;
  background: boolean;
}> {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: {
      createdAt: true,
      deadlineAt: true,
      source: true,
      versionId: true,
      parentTurnId: true,
    },
  });
  const untilDeadline =
    turn.deadlineAt.getTime() - (await databaseNow()).getTime();
  const background = Boolean(turn.parentTurnId);
  return {
    background,
    maxSteps: sokoBotMaxSteps(
      turn.deadlineAt.getTime() - turn.createdAt.getTime(),
    ),
    ms: Math.max(
      MIN_TURN_BUDGET_MS,
      process.env.VERCEL
        ? Math.min(VERCEL_TURN_BUDGET_MS, untilDeadline)
        : untilDeadline,
    ),
    inputTokens: sokoBotInputTokenBudget({
      source: turn.source,
      cmo: getSokoBotVersion(turn.versionId).profile === "cmo",
      background,
    }),
  };
}

/** Runs one turn to completion, recording everything the drain needs. */
async function runTurn(
  sessionId: string,
  input: RuntimeTurnInput,
): Promise<void> {
  const log = new RuntimeEventLog(input.turnId, sessionId);

  try {
    const {
      ms: budgetMs,
      inputTokens: inputTokenBudget,
      maxSteps,
      background,
    } = await turnBudget(input.turnId);
    const deadline = Date.now() + budgetMs;
    const abortSignal = AbortSignal.timeout(budgetMs);
    await announceTurn(log, input.message);
    const [turn, replyLanguage] = await withReplyLanguage(
      input.turnId,
      prepareTurn(sessionId, input.turnId, { sandbox: false, web: true }),
    );
    // One allowance for the turn's parts and its main loop together.
    const budget = turnTokenBudget(
      inputTokenBudget,
      estimateInputTokens(turn.system, input.message),
    );

    const tools: ToolSet = {};
    for (const capability of turn.capabilities) {
      if (
        evaluationBinding() &&
        !["get_task_status", "archive_task"].includes(capability)
      )
        continue;
      tools[capability] = tool({
        description:
          turn.toolDescriptions[capability] ??
          SOKO_BOT_TOOL_DESCRIPTIONS[capability],
        inputSchema: sokoBotToolInputSchema(capability, turn),
        async execute(
          toolInput: unknown,
          options: { toolCallId: string; abortSignal?: AbortSignal },
        ) {
          // The turn's deadline reaches the tool, not only the model.
          if (abortSignal.aborted || options.abortSignal?.aborted) {
            throw new Error("Soko Bot turn deadline reached");
          }
          if (capability === "web_search" || capability === "web_fetch") {
            return runCoreWebTool({
              sessionId,
              turnId: input.turnId,
              capability,
              toolCallId: options.toolCallId,
              toolInput,
            });
          }
          return runTurnTool({
            log,
            capability,
            toolCallId: options.toolCallId,
            toolInput,
          });
        },
      });
    }

    // The drain reads the model from `step.started` and meters usage from
    // `step.completed`; billing depends on both, so emit them per step.
    const purpose = await loadSokoBotTurnPurpose(input.turnId);
    const request = sokoBotModelRequest({
      role: "agent",
      model: turn.model,
      inferenceRegion: turn.inferenceRegion,
      purpose,
    });
    const callModel: typeof streamModelCall = async (options) => {
      await log.append(runtimeEvent("step.started", { modelId: turn.model }));
      const result = await withEvaluationTurn(input.turnId, () =>
        streamModelCall({
          ...options,
          ...request,
          providerOptions: {
            ...options.providerOptions,
            ...request.providerOptions,
            openai: {
              ...options.providerOptions?.openai,
              ...turn.reasoningEffort.openai,
            },
          },
          telemetry: modelCallTelemetryFor("soko-bot-agent"),
          prepareStep: (step) =>
            prepareEvaluationStep(step) ?? options.prepareStep?.(step) ?? {},
          async onStepFinish(step) {
            assertSokoBotInferenceRegion(step.providerMetadata, {
              model: turn.model,
              role: "agent",
            });
            await options.onStepFinish?.(step);
            await log.append(
              runtimeEvent("step.completed", {
                modelId: turn.model,
                inference: sokoBotInferenceEvidence(step.providerMetadata),
                usage: {
                  inputTokens: step.usage?.inputTokens ?? 0,
                  outputTokens: step.usage?.outputTokens ?? 0,
                  cacheReadTokens:
                    step.usage?.inputTokenDetails?.cacheReadTokens ?? 0,
                  cacheWriteTokens:
                    step.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
                  costUsd: gatewayCostUsd(step.providerMetadata),
                },
              }),
            );
          },
        }),
      ).catch(async (error: unknown) => {
        if (
          error instanceof Error &&
          error.name === GATEWAY_INTERNAL_SERVER_ERROR
        ) {
          const scope = aiGatewayBudgetScope(error.message);
          if (scope) {
            await reportAiGatewayBudgetFailure(
              scope,
              purpose,
              aiGatewayApiKey(purpose),
            );
          }
        }
        throw error;
      });
      assertSokoBotInferenceRegion(result.steps.at(-1)?.providerMetadata, {
        model: turn.model,
        role: "agent",
      });
      return result;
    };

    const loop: Omit<TurnLoopInput, "message"> = {
      model: turn.model,
      system: turn.system,
      tools,
      shortForms: turn.shortForms,
      budget,
      maxSteps,
      deadline,
      background,
      stopped: abortSignal,
      async onReasoning(text) {
        await log.append(runtimeEvent("reasoning.completed", { text }));
      },
      ...(evaluationBinding() && { historyAfterRound: evaluationHistory }),
    };
    // On Vercel the budget is one invocation: parts may use at most half of
    // it, so the turn still has time to write from their hand-overs.
    const partMs = Math.min(TURN_PART_MAX_MS, budgetMs / 2);
    const userMessage = await withPartHandOvers(
      await modelUserMessage(turn, input.message, replyLanguage),
      turn.parts,
      async (part) =>
        (
          await runTurnLoop(
            {
              ...loop,
              message: partMessage(turn.preamble, part),
              tools: partTools(tools, part),
              maxSteps: TURN_PART_MAX_STEPS,
              part: true,
              background: false,
              deadline: Math.min(deadline, Date.now() + partMs),
            },
            callModel,
          )
        ).text,
    );
    const result = await runTurnLoop(
      {
        ...loop,
        message: userMessage,
        cacheKey: turn.cacheKey,
        fullCacheKey: turn.fullCacheKey,
        ...(turn.planLoop
          ? {
              plan: {
                inherited: turn.planInherited,
                doneCheck: (draft: string) =>
                  evaluateTurnDoneCheck({
                    turnId: input.turnId,
                    sessionId,
                    draft,
                  }),
                openSteps: () => openStepsNote(input.turnId),
                changeTools: changeTools(),
              },
            }
          : {}),
        ...(turn.stepFocus && !evaluationBinding()
          ? {
              stepFocus: {
                selectStep: (stepRequest) =>
                  selectTurnStepFocus({
                    turnId: input.turnId,
                    sessionId,
                    sandbox: false,
                    ...stepRequest,
                  }),
                recordOutcome: (outcome) =>
                  recordTurnStepFocusOutcome({
                    turnId: input.turnId,
                    sessionId,
                    outcome,
                  }),
                cacheKeys: turn.focusCacheKeys,
                fullCacheKeys: turn.focusFullCacheKeys,
              },
            }
          : {}),
      },
      callModel,
    );
    await finishTurn({
      log,
      turnId: input.turnId,
      text: result.text,
      finishReason: result.finishReason,
      requiresActionProof: turn.requiresActionProof,
    });
  } catch (error) {
    await failTurn(log, {
      code: error instanceof Error ? error.name : "runtime_failed",
      message: error instanceof Error ? error.message : "Soko Bot turn failed",
    });
  }
  await closeTurn(log, input.reconciliationLeaseToken);
}

/** Reads a turn's recorded events back for the drain. */
export async function* streamStoredEvents(
  input: RuntimeEventStreamInput,
): AsyncIterable<IndexedRuntimeEvent> {
  const { sessionId, signal, reconciliation } = input;
  const readEvents = (startIndex: number) =>
    prisma.sokoBotRuntimeEvent.findMany({
      where: { sessionId, startIndex: { gte: startIndex } },
      orderBy: { startIndex: "asc" },
    });
  const startIndex = Math.max(0, input.startIndex);
  const events = await readEvents(startIndex);
  yield* indexedStoredEvents(events, signal);
  if (!reconciliation || signal?.aborted) return;

  const nextIndex = (events.at(-1)?.startIndex ?? startIndex - 1) + 1;
  const { turnId, leaseToken } = reconciliation;
  const hasTerminalTail = await prisma.$transaction(
    async (tx) => {
      // Close commits its marker before taking this lock. Either the drain
      // sees the marker, or close sees the drain's released heartbeat.
      await tx.$queryRaw`
      SELECT "id" FROM ${sharedTable("soko_bot_turn")} WHERE "id" = ${turnId}::uuid
      FOR NO KEY UPDATE
    `;
      const terminal = await tx.sokoBotRuntimeEvent.findFirst({
        where: {
          turnId,
          sessionId,
          startIndex: { gte: nextIndex },
          type: { in: [...SETTLEMENT_TRIGGER_EVENT_TYPES] },
        },
        select: { id: true },
      });
      if (terminal) return true;

      const { count } = await tx.sokoBotTurn.updateMany({
        where: {
          id: turnId,
          leaseToken,
          eveSessionId: sessionId,
          status: { in: ["STARTING", "RUNNING", "CANCEL_REQUESTED"] },
        },
        // Runtime authorization still uses the lease expiry.
        data: { reconcilerHeartbeatAt: null },
      });
      if (!count) {
        throw new SokoBotReconciliationLeaseLostError(
          "Soko Bot reconciliation lease was lost",
        );
      }
      return false;
    },
    { isolationLevel: "ReadCommitted" },
  );
  if (hasTerminalTail)
    yield* indexedStoredEvents(await readEvents(nextIndex), signal);
}

function* indexedStoredEvents(
  events: SokoBotRuntimeEvent[],
  signal?: AbortSignal,
): Iterable<IndexedRuntimeEvent> {
  for (const stored of events) {
    if (signal?.aborted) return;
    yield {
      startIndex: stored.startIndex,
      event: {
        type: stored.type,
        data: (stored.data ?? {}) as Record<string, RuntimeJsonValue>,
        meta: {
          id: stored.eventId,
          at: stored.occurredAt.toISOString(),
        },
      },
    };
  }
}

export async function cancelStoredTurn(
  input: RuntimeCancelInput,
): Promise<void> {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { eveSessionId: input.sessionId },
    select: { id: true },
  });
  if (!turn) return;
  const log = new RuntimeEventLog(turn.id, input.sessionId);
  await log.append(
    runtimeEvent("turn.cancelled", { turnId: input.eveTurnId ?? null }),
  );
}

export async function resetStoredSession(
  input: RuntimeResetInput,
): Promise<void> {
  await prisma.sokoBotRuntimeEvent.deleteMany({
    where: { sessionId: input.sessionId },
  });
}

export async function inspectStoredSession(
  input: RuntimeInspectInput,
  runtimeVersion: string,
): Promise<RuntimeHealth> {
  const latest = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: { startIndex: "desc" },
    select: { type: true },
  });
  return {
    healthy: true,
    runtimeVersion,
    sessionStatus: latest?.type ?? null,
  };
}

/**
 * The agent loop inside Core. Used for preview evaluation runs, which meter
 * every model call through Core's evaluation ledger, and as an explicit
 * fallback (`SOKO_BOT_RUNTIME_ADAPTER=in-process`). It has no sandbox, so
 * sandbox tools are not offered.
 */
export class InProcessSokoBotRuntime implements SokoBotRuntime {
  async createSession(input: RuntimeTurnInput): Promise<RuntimeTurnRef> {
    const sessionId = input.sessionId ?? `sess_${randomUUID()}`;
    // Known background work: what the turn logs gets its own events.
    waitUntil(
      runAsBackgroundWork(() =>
        withModelCallTurn(input.turnId, () => runTurn(sessionId, input)),
      ),
    );
    return {
      sessionId,
      runtimeVersion: IN_PROCESS_RUNTIME_VERSION,
      acceptedAt: new Date().toISOString(),
    };
  }

  streamEvents(
    input: RuntimeEventStreamInput,
  ): AsyncIterable<IndexedRuntimeEvent> {
    return streamStoredEvents(input);
  }

  cancelTurn(input: RuntimeCancelInput): Promise<void> {
    return cancelStoredTurn(input);
  }

  resetSession(input: RuntimeResetInput): Promise<void> {
    return resetStoredSession(input);
  }

  inspectSession(input: RuntimeInspectInput): Promise<RuntimeHealth> {
    return inspectStoredSession(input, IN_PROCESS_RUNTIME_VERSION);
  }
}
