import {
  SOKO_BOT_JUDGE_RUBRIC,
  SOKO_BOT_SCENARIOS,
  type SokoBotJudgeVerdict,
  sokoBotJudgeVerdictSchema,
} from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";

import prisma from "@/lib/db/prisma";

export const SOKO_BOT_JUDGE_MODEL = "anthropic/claude-sonnet-5";
const JUDGE_TIMEOUT_MS = 60_000;
const VALUE_LIMIT = 2_000;

export class SokoBotLabJudgeError extends Error {}

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text;
}

/**
 * Grades one lab turn with a judge model against the scenario rubric. The
 * transcript is the ground truth we stored: prompt, every tool call with
 * its input and result, and the final answer.
 */
export async function judgeSokoBotLabTurn(input: {
  userId: string;
  turnId: string;
  scenarioId: string;
}): Promise<{ verdict: SokoBotJudgeVerdict; model: string }> {
  const scenario = SOKO_BOT_SCENARIOS.find((s) => s.id === input.scenarioId);
  if (!scenario) throw new SokoBotLabJudgeError("Unknown scenario");
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { id: input.turnId, userId: input.userId },
    select: {
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
    },
  });
  if (!turn) throw new SokoBotLabJudgeError("Turn not found");

  const transcript = {
    scenario: {
      id: scenario.id,
      title: scenario.title,
      intent: scenario.intent,
      rubric: scenario.rubric,
      ownerMessageOrTrigger: scenario.trigger
        ? `Coworker set the task to ${scenario.trigger.status}: ${scenario.trigger.comment}`
        : scenario.prompt,
    },
    turn: {
      status: turn.status,
      route: turn.route,
      runtimeInput: clip(turn.userMessage),
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

  // Structured output occasionally comes back empty; one retry is cheap.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateText({
        model: SOKO_BOT_JUDGE_MODEL,
        output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
        maxOutputTokens: 800,
        abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        instructions: SOKO_BOT_JUDGE_RUBRIC,
        prompt: JSON.stringify(transcript),
      });
      return {
        verdict: sokoBotJudgeVerdictSchema.parse(result.output),
        model: SOKO_BOT_JUDGE_MODEL,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new SokoBotLabJudgeError("Judge produced no verdict");
}
