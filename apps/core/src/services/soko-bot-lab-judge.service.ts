import {
  type ScenarioCheck,
  SOKO_BOT_JUDGE_RUBRIC,
  SOKO_BOT_SCENARIOS,
  type SokoBotJudgeVerdict,
  sokoBotJudgeVerdictSchema,
} from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const JUDGE_TIMEOUT_MS = 90_000;
const VALUE_LIMIT = 2_000;

export class SokoBotLabJudgeError extends Error {}

export function sokoBotJudgeModel(): string {
  return getEnv().SOKO_BOT_JUDGE_MODEL;
}

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text;
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

async function askJudge(payload: unknown): Promise<SokoBotJudgeVerdict> {
  // Structured output occasionally comes back empty; one retry is cheap.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateText({
        model: sokoBotJudgeModel(),
        output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
        maxOutputTokens: 800,
        abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        instructions: SOKO_BOT_JUDGE_RUBRIC,
        prompt: JSON.stringify(payload),
      });
      return sokoBotJudgeVerdictSchema.parse(result.output);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new SokoBotLabJudgeError("Judge produced no verdict");
}

async function storeTurnVerdict(turnId: string, verdict: SokoBotJudgeVerdict) {
  await prisma.sokoBotTurn.update({
    where: { id: turnId },
    data: {
      qualityScore: overallScore(verdict),
      qualityVerdict: verdict,
      qualityModel: sokoBotJudgeModel(),
      judgedAt: new Date(),
    },
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
  const verdict = await askJudge({
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
  await Promise.all([record(verdict), storeTurnVerdict(input.turnId, verdict)]);
  return { verdict, model };
}

/**
 * Scores an ordinary (non-lab) turn with the same judge against the generic
 * expectation of a good project-manager turn. Runs after settlement.
 */
export async function judgeTurnQuality(turnId: string): Promise<void> {
  if (!getEnv().SOKO_BOT_TURN_JUDGE_ENABLED) return;
  const { turn, transcript } = await loadTranscript(turnId);
  if (turn.status !== "COMPLETED" && turn.status !== "FAILED") return;
  const verdict = await askJudge({
    scenario: {
      id: "live-turn",
      title: "Live turn",
      intent:
        "An ordinary turn from the owner, a schedule, or a coworker event. Judge whether a careful human project manager would be satisfied with what happened and how it was reported.",
      rubric:
        "Work is delegated as clear tasks, follow-ups exist as schedules, coworker questions and failures are handled on the task, the owner is told exactly what happened, and nothing is claimed that the tool results do not show.",
      ownerMessageOrTrigger: transcript.runtimeInput,
    },
    turn: transcript,
  });
  await storeTurnVerdict(turnId, verdict);
}
