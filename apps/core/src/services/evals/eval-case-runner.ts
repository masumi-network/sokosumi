import {
  evaluateScenario,
  type ScenarioCheck,
  type SokoBotJudgeVerdict,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { judgeEvalScenarioTurn } from "@/services/soko-bot-lab-judge.service";
import {
  loadLabScenarioTurn,
  SETTLED_TURN_STATUSES,
  startLabScenarioTurn,
} from "@/services/soko-bot-lab-scenario.service";
import { createSokoBotSchedule } from "@/services/soko-bot-schedule.service";
import type { EvalCase } from "./eval-cases";
import {
  commentChecks,
  pollCmoCase,
  prepareCmoComments,
  startCmoCase,
} from "./eval-cmo-runner";
import {
  type EvalLaneRecord,
  resetEvalLaneForSokoBot,
} from "./eval-lanes.service";

/** What a finished case reports; the runner stores it on its result. */
export interface CaseOutcome {
  status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED";
  checks: ScenarioCheck[];
  judge?: SokoBotJudgeVerdict | null;
  judgeModel?: string | null;
  output: Record<string, unknown>;
  error?: string | null;
  turnIds: string[];
}

export type CaseStart =
  | { kind: "started"; turnId: string | null; state: Record<string, unknown> }
  /** The lane's bot is still busy with an earlier turn; try on the next tick. */
  | { kind: "busy" }
  | { kind: "done"; outcome: CaseOutcome };

export type CasePoll =
  | { kind: "waiting" }
  | { kind: "done"; outcome: CaseOutcome };

export interface CaseContext {
  resultId: string;
  /** The first Soko Bot case of the lane in this run: start from the seeded world. */
  firstOfSuite: boolean;
  startedAt: Date;
}

/** A scenario turn may run until its 15-minute deadline, plus the start. */
const SCENARIO_TIMEOUT_MS = 20 * 60_000;
const ACTIVE_TURN_STATUSES = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
] as const;

export function evalClientTurnId(resultId: string): string {
  return `lab:eval:${resultId}`;
}

export async function botIsBusy(sokoBotId: string): Promise<boolean> {
  return (
    (await prisma.sokoBotTurn.count({
      where: { sokoBotId, status: { in: [...ACTIVE_TURN_STATUSES] } },
    })) > 0
  );
}

export function skipped(reason: string): CaseOutcome {
  return {
    status: "SKIPPED",
    checks: [],
    output: {},
    error: reason,
    turnIds: [],
  };
}

export function caseError(
  message: string,
  turnIds: string[] = [],
): CaseOutcome {
  return { status: "ERROR", checks: [], output: {}, error: message, turnIds };
}

async function startScenario(
  scenario: SokoBotScenario,
  bot: "soko-bot" | "cuso",
  lane: EvalLaneRecord,
  context: CaseContext,
  prepare?: "cmo-comments",
): Promise<CaseStart> {
  const sokoBotId = bot === "cuso" ? lane.cusoBotId : lane.sokoBotId;
  if (await botIsBusy(sokoBotId)) return { kind: "busy" };
  const state = prepare ? { comments: await prepareCmoComments(lane) } : {};
  if (bot === "soko-bot" && (context.firstOfSuite || scenario.setup))
    await resetEvalLaneForSokoBot(lane);
  for (const schedule of scenario.setup?.schedules ?? [])
    await createSokoBotSchedule({
      userId: lane.userId,
      workspaceId: lane.workspaceId,
      sokoBotId,
      timezone: "Europe/Berlin",
      ...schedule,
    });
  const clientTurnId = evalClientTurnId(context.resultId);
  const turnId =
    bot === "cuso"
      ? (
          await sokoBotControlPlane.startTurn({
            userId: lane.userId,
            workspaceId: lane.workspaceId,
            sokoBotId,
            clientTurnId,
            message: scenario.prompt,
          })
        ).turnId
      : await startLabScenarioTurn(
          scenario,
          {
            bot: { id: sokoBotId, userId: lane.userId },
            workspaceId: lane.workspaceId,
          },
          clientTurnId,
        );
  return { kind: "started", turnId, state };
}

/** What the admin page shows of a scenario turn: the answer and the tools in order. */
function scenarioOutput(turn: Awaited<ReturnType<typeof loadLabScenarioTurn>>) {
  return {
    answer: turn.finalAnswer,
    route: turn.route,
    turnStatus: turn.status,
    errorKind: turn.errorKind,
    tools: turn.toolCalls.map((call) => ({
      capability: call.capability,
      status: call.status,
      input: call.input,
    })),
  };
}

async function pollScenario(
  scenario: SokoBotScenario,
  turnId: string,
  lane: EvalLaneRecord,
  context: CaseContext,
  state: unknown,
): Promise<CasePoll> {
  const turn = await loadLabScenarioTurn(turnId);
  if (!SETTLED_TURN_STATUSES.includes(turn.status)) {
    if (Date.now() - context.startedAt.getTime() < SCENARIO_TIMEOUT_MS)
      return { kind: "waiting" };
    await sokoBotControlPlane
      .cancelTurn(lane.userId, turnId)
      .catch(() => undefined);
    return {
      kind: "done",
      outcome: caseError("The turn did not settle in 20 minutes", [turnId]),
    };
  }
  const result = evaluateScenario(scenario, turn);
  const comments = (state as { comments?: Record<string, string> } | null)
    ?.comments;
  if (comments) {
    const extra = commentChecks(turn.toolCalls, comments);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  const judged = await judgeEvalScenarioTurn(turnId, scenario).catch(
    (error: unknown) => {
      console.warn("Eval judge failed", {
        turnId,
        error: error instanceof Error ? error.message : "unknown",
      });
      return null;
    },
  );
  const passed =
    result.passed === result.total && judged?.verdict.verdict !== "fail";
  return {
    kind: "done",
    outcome: {
      status: passed ? "PASSED" : "FAILED",
      checks: result.checks,
      judge: judged?.verdict ?? null,
      judgeModel: judged?.model ?? null,
      output: scenarioOutput(turn),
      turnIds: [turnId],
    },
  };
}

export async function startEvalCase(
  evalCase: EvalCase,
  lane: EvalLaneRecord,
  context: CaseContext,
): Promise<CaseStart> {
  if (evalCase.requires === "mailbox")
    return {
      kind: "done",
      outcome: skipped("Needs a connected mailbox and calendar"),
    };
  if (evalCase.kind === "scenario")
    return startScenario(
      evalCase.scenario,
      evalCase.bot,
      lane,
      context,
      evalCase.prepare,
    );
  return startCmoCase(evalCase, lane, context);
}

export async function pollEvalCase(
  evalCase: EvalCase,
  lane: EvalLaneRecord,
  result: { turnId: string | null; state: unknown },
  context: CaseContext,
): Promise<CasePoll> {
  if (evalCase.kind === "scenario") {
    if (!result.turnId)
      return { kind: "done", outcome: caseError("The case has no turn") };
    return pollScenario(
      evalCase.scenario,
      result.turnId,
      lane,
      context,
      result.state,
    );
  }
  return pollCmoCase(evalCase, lane, result, context);
}
