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
import { generateText, stepCountIs, type ToolSet, tool } from "ai";
import prisma from "@/lib/db/prisma";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import {
  assertSokoBotInferenceRegion,
  sokoBotInferenceEvidence,
  sokoBotModelRequest,
} from "@/lib/soko-bot/model-policy";
import { IN_PROCESS_RUNTIME_VERSION } from "@/lib/soko-bot/runtime-version";
import {
  evaluationBinding,
  prepareEvaluationStep,
  withEvaluationTurn,
} from "./evaluation-dispatch";
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

/**
 * How long one turn may run inside a single invocation. Vercel kills Core at
 * `maxDuration` (300s), and a killed invocation writes neither `turn.failed`
 * nor `session.waiting`. Stopping first keeps the loop able to settle itself.
 */
const TURN_RUNTIME_BUDGET_MS = 240_000;

/** Runs one turn to completion, recording everything the drain needs. */
async function runTurn(
  sessionId: string,
  input: RuntimeTurnInput,
): Promise<void> {
  const log = new RuntimeEventLog(input.turnId, sessionId);
  const abortSignal = AbortSignal.timeout(TURN_RUNTIME_BUDGET_MS);

  try {
    await announceTurn(log, input.message);
    const turn = await prepareTurn(sessionId, input.turnId, {
      sandbox: false,
    });

    const tools: ToolSet = {};
    for (const capability of turn.capabilities) {
      if (
        evaluationBinding() &&
        !["get_task_status", "archive_task", "request_user_decision"].includes(
          capability,
        )
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
    await log.append(runtimeEvent("step.started", { modelId: turn.model }));
    const result = await withEvaluationTurn(input.turnId, () =>
      generateText({
        ...sokoBotModelRequest({
          role: "agent",
          model: turn.model,
          inferenceRegion: turn.inferenceRegion,
        }),
        system: turn.system,
        messages: [{ role: "user", content: input.message }],
        tools,
        prepareStep: prepareEvaluationStep,
        stopWhen: stepCountIs(SOKO_BOT_MAX_STEPS),
        abortSignal,
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

    assertSokoBotInferenceRegion(result.providerMetadata, {
      model: turn.model,
      role: "agent",
    });
    await finishTurn({
      log,
      turnId: input.turnId,
      // A model can answer in one step and end on an empty one; `text` is
      // only the last step's.
      text:
        result.text ||
        (result.steps.findLast((step) => step.text.trim())?.text ?? ""),
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
