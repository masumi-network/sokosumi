import { randomUUID } from "node:crypto";
import {
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
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { stepCountIs, type ToolSet, tool } from "ai";
import prisma from "@/lib/db/prisma";
import { withActiveBackgroundRuns } from "@/lib/soko-bot/active-background-runs";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import {
  assertSokoBotInferenceRegion,
  sokoBotInferenceEvidence,
  sokoBotModelRequest,
} from "@/lib/soko-bot/model-policy";
import { IN_PROCESS_RUNTIME_VERSION } from "@/lib/soko-bot/runtime-version";
import { streamModelCall } from "@/lib/soko-bot/stream-model-call";
import { withTurnSkills } from "@/services/chat-message-skills.service";
import {
  evaluationBinding,
  prepareEvaluationStep,
  withEvaluationTurn,
} from "./evaluation-dispatch";
import { runInProcessWebTool } from "./in-process-web-tools";
import {
  announceTurn,
  closeTurn,
  failTurn,
  finishTurn,
  prepareTurn,
  RuntimeEventLog,
  runTurnTool,
  runtimeEvent,
  SOKO_BOT_MAX_STEPS,
} from "./turn-loop";
import {
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
async function turnBudgetMs(turnId: string): Promise<number> {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { deadlineAt: true },
  });
  const untilDeadline = turn.deadlineAt.getTime() - Date.now();
  return Math.max(
    MIN_TURN_BUDGET_MS,
    process.env.VERCEL
      ? Math.min(VERCEL_TURN_BUDGET_MS, untilDeadline)
      : untilDeadline,
  );
}

/** Runs one turn to completion, recording everything the drain needs. */
async function runTurn(
  sessionId: string,
  input: RuntimeTurnInput,
): Promise<void> {
  const log = new RuntimeEventLog(input.turnId, sessionId);

  try {
    const abortSignal = AbortSignal.timeout(await turnBudgetMs(input.turnId));
    await announceTurn(log, input.message);
    const turn = await prepareTurn(sessionId, input.turnId, {
      sandbox: false,
      web: true,
    });

    const tools: ToolSet = {};
    for (const capability of turn.capabilities) {
      if (
        evaluationBinding() &&
        !["get_task_status", "archive_task"].includes(capability)
      )
        continue;
      tools[capability] = tool({
        description: SOKO_BOT_TOOL_DESCRIPTIONS[capability],
        inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS[capability],
        async execute(
          toolInput: unknown,
          options: { toolCallId: string; abortSignal?: AbortSignal },
        ) {
          // The turn's deadline reaches the tool, not only the model.
          if (abortSignal.aborted || options.abortSignal?.aborted) {
            throw new Error("Soko Bot turn deadline reached");
          }
          if (capability === "web_search" || capability === "web_fetch") {
            return runInProcessWebTool({
              sessionId,
              turnId: input.turnId,
              capability,
              toolCallId: options.toolCallId,
              toolInput,
              model: turn.model,
              inferenceRegion: turn.inferenceRegion,
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
    const runModel = async (
      message: string,
      maxSteps: number,
      signal: AbortSignal,
    ) => {
      await log.append(runtimeEvent("step.started", { modelId: turn.model }));
      const result = await withEvaluationTurn(input.turnId, () =>
        streamModelCall({
          ...sokoBotModelRequest({
            role: "agent",
            model: turn.model,
            inferenceRegion: turn.inferenceRegion,
          }),
          system: turn.system,
          messages: [{ role: "user", content: message }],
          tools,
          prepareStep: prepareEvaluationStep,
          stopWhen: stepCountIs(maxSteps),
          abortSignal: signal,
          async onStepFinish(step) {
            assertSokoBotInferenceRegion(step.providerMetadata, {
              model: turn.model,
              role: "agent",
            });
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
      );
      assertSokoBotInferenceRegion(result.steps.at(-1)?.providerMetadata, {
        model: turn.model,
        role: "agent",
      });
      // A model can answer in one step and end on an empty one; `text` is
      // only the last step's.
      const text =
        result.text ||
        (result.steps.findLast((step) => step.text.trim())?.text ?? "");
      return { text, finishReason: result.finishReason };
    };

    const userMessage = await withPartHandOvers(
      await withActiveBackgroundRuns(
        input.turnId,
        await withTurnSkills(input.turnId, input.message),
      ),
      turn.parts,
      async (part) =>
        (
          await runModel(
            part.message,
            TURN_PART_MAX_STEPS,
            AbortSignal.any([
              abortSignal,
              AbortSignal.timeout(TURN_PART_MAX_MS),
            ]),
          )
        ).text,
    );
    const result = await runModel(userMessage, SOKO_BOT_MAX_STEPS, abortSignal);
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
  await closeTurn(log, input.turnId);
}

/** Reads a turn's recorded events back for the drain. */
export async function* streamStoredEvents(
  input: RuntimeEventStreamInput,
): AsyncIterable<IndexedRuntimeEvent> {
  const events = await prisma.sokoBotRuntimeEvent.findMany({
    where: {
      sessionId: input.sessionId,
      startIndex: { gte: Math.max(0, input.startIndex) },
    },
    orderBy: { startIndex: "asc" },
  });
  for (const stored of events) {
    if (input.signal?.aborted) return;
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
    waitUntil(runTurn(sessionId, input));
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
