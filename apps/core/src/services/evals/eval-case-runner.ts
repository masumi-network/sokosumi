import {
  CMO_PLAYBOOKS_SKILL,
  CMO_POST_WITH_PICTURE_SCENARIO_ID,
  cmoReadsPlaybooks,
  evaluateScenario,
  getSokoBotVersion,
  isSokoBotSandboxCapability,
  type ScenarioCheck,
  type SokoBotJudgeVerdict,
  type SokoBotScenario,
  WRITING_SKILLS,
} from "@sokosumi/soko-bot";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  judgeEvalChain,
  judgeEvalScenarioTurn,
} from "@/services/soko-bot-lab-judge.service";
import {
  loadLabScenarioTurn,
  SETTLED_TURN_STATUSES,
  startLabScenarioTurn,
} from "@/services/soko-bot-lab-scenario.service";
import { createSokoBotSchedule } from "@/services/soko-bot-schedule.service";
import {
  followUpCapabilities,
  followUpMessage,
} from "@/services/soko-bot-watches.service";
import {
  a2aChecks,
  a2aRoomLog,
  closeA2aWorld,
  isA2aScenario,
  loadA2aChain,
  otherAgentTurnIds,
  pollA2aChain,
  prepareA2aCase,
} from "./eval-a2a";
import type { EvalCase } from "./eval-cases";
import type { CmoChatSetup } from "./eval-cmo-cases";
import {
  CHANGE_THEN_DRAFTS_CASE_ID,
  cmoChangeThenDraftsChecks,
} from "./eval-cmo-change-then-drafts";
import {
  COMPETITOR_ADS_CASE_ID,
  COMPETITOR_LANDING_PAGE_CASE_ID,
  competitorAdChecks,
  competitorLandingPageChecks,
} from "./eval-cmo-competitor-ads";
import {
  competitorFeedChecks,
  isCompetitorEvalCase,
  prepareSokoBotCompetitorCase,
  SOKO_BOT_COMPETITOR_CASE_ID,
  sokoBotCompetitorChecks,
} from "./eval-cmo-competitors";
import {
  adsChecks,
  CMO_ADS_CASE_ID,
  CMO_FUNNEL_CASE_ID,
  funnelChecks,
} from "./eval-cmo-funnel";
import {
  partPatchChecks,
  REPORT_HEADLINE_CASE_ID,
  reportHeadlineChecks,
} from "./eval-cmo-report-headline";
import { startCusoRhythmTurn } from "./eval-cmo-rhythm";
import {
  commentChecks,
  pollCmoCase,
  prepareCmoChatCase,
  startCmoCase,
  styledPictureChecks,
} from "./eval-cmo-runner";
import { cmoSeoReportChecks, isCmoSeoReportCase } from "./eval-cmo-seo-report";
import {
  CMO_SHORT_FORM_CASE_IDS,
  shortFormChecks,
} from "./eval-cmo-short-forms";
import { CMO_SKILL_CASE_IDS, skillChecks } from "./eval-cmo-skills";
import { CMO_CORRECTION_CASE_ID, correctionChecks } from "./eval-cmo-variety";
import {
  CMO_WEEKLY_REVIEW_CASE_ID,
  weeklyReviewChecks,
} from "./eval-cmo-weekly-review";
import {
  type EvalInfrastructureFailure,
  infrastructureCaseOutcome,
} from "./eval-infrastructure";
import {
  type EvalLaneRecord,
  resetEvalLaneForSokoBot,
  seedEvalXDms,
} from "./eval-lanes.service";
import { isSchedulesCase, prepareSchedulesCase } from "./eval-schedules";
import { seoEvalChecks } from "./eval-seo-checks";
import { isSeoEvalCase, prepareSeoEvalCase } from "./eval-seo-fixtures";
import { pollStandupCase, startStandupCase } from "./eval-standup";
import { pollJourney, startJourney } from "./ownerbench/journey-runner";

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
  /** The judge model for this run; unset, the configured judge. */
  judgeModel?: string;
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

/**
 * The follow-up of the lane Cuso's chat turn for `ask`, as the watch sync
 * starts one: a child turn with that turn's tools and Core's brief.
 */
async function startFollowUp(
  trigger: Extract<SokoBotScenario["trigger"], { kind: "follow_up" }>,
  lane: EvalLaneRecord,
  clientTurnId: string,
): Promise<string> {
  const asked = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: lane.cusoBotId,
      source: "CHAT",
      parentTurnId: null,
      userMessage: trigger.ask,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, capabilityNames: true, destinationRoomId: true },
  });
  if (!asked)
    throw new Error("No chat turn to follow up: run the case that asks first");
  const capabilities = followUpCapabilities(
    "background_run",
    asked.capabilityNames,
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: lane.userId,
    workspaceId: lane.workspaceId,
    sokoBotId: lane.cusoBotId,
    clientTurnId,
    message: followUpMessage({ ...trigger, timedOut: false }),
    source: "CHAT",
    presetRoute: {
      route: "DELEGATE_TASK",
      reason: "Follow-up",
      capabilities,
      sandbox: capabilities.some(isSokoBotSandboxCapability),
    },
    background: {
      parentTurnId: asked.id,
      title: "Follow-up",
      destinationRoomId: asked.destinationRoomId,
    },
  });
  return started.turnId;
}

/** A case that reads a playbook the lane's Cuso version does not list. */
async function lacksPlaybooks(
  scenario: SokoBotScenario,
  sokoBotId: string,
): Promise<boolean> {
  const playbooks = new Set(
    WRITING_SKILLS.filter((skill) => skill.group === "playbooks").map(
      (skill) => skill.id,
    ),
  );
  if (!scenario.expect.readsSkills?.some((id) => playbooks.has(id)))
    return false;
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: sokoBotId },
    select: { versionId: true },
  });
  return !cmoReadsPlaybooks(getSokoBotVersion(bot.versionId).skills);
}

async function startScenario(
  scenario: SokoBotScenario,
  bot: "soko-bot" | "cuso",
  lane: EvalLaneRecord,
  context: CaseContext,
  prepare?: CmoChatSetup,
): Promise<CaseStart> {
  const sokoBotId = bot === "cuso" ? lane.cusoBotId : lane.sokoBotId;
  const clientTurnId = evalClientTurnId(context.resultId);
  const seoCase = bot === "soko-bot" && isSeoEvalCase(scenario.id);
  if (seoCase) {
    const previous = await prisma.sokoBotTurn.findFirst({
      where: { sokoBotId, clientTurnId },
      select: { id: true },
    });
    if (previous) {
      const saved = await prisma.evalResult.findUniqueOrThrow({
        where: { id: context.resultId },
        select: { state: true },
      });
      return {
        kind: "started",
        turnId: previous.id,
        state:
          saved.state &&
          typeof saved.state === "object" &&
          !Array.isArray(saved.state)
            ? saved.state
            : {},
      };
    }
  }
  if (await botIsBusy(sokoBotId)) return { kind: "busy" };
  if (bot === "cuso" && (await lacksPlaybooks(scenario, sokoBotId)))
    return {
      kind: "done",
      outcome: skipped(
        `Needs a Cuso version with the playbooks (${CMO_PLAYBOOKS_SKILL})`,
      ),
    };
  let state: Record<string, unknown> = prepare
    ? await prepareCmoChatCase(lane, prepare)
    : {};
  if (bot === "soko-bot" && (context.firstOfSuite || scenario.setup))
    await resetEvalLaneForSokoBot(lane);
  if (scenario.setup?.xDms) await seedEvalXDms(lane, scenario.setup.xDms);
  for (const schedule of scenario.setup?.schedules ?? [])
    await createSokoBotSchedule({
      userId: lane.userId,
      workspaceId: lane.workspaceId,
      sokoBotId,
      timezone: "Europe/Berlin",
      ...schedule,
    });
  if (scenario.id === SOKO_BOT_COMPETITOR_CASE_ID)
    await prepareSokoBotCompetitorCase(lane);
  if (bot === "soko-bot" && isSchedulesCase(scenario.id))
    await prepareSchedulesCase(lane, scenario.id);
  if (bot === "soko-bot" && isA2aScenario(scenario))
    state = { ...state, ...(await prepareA2aCase(lane, scenario)) };
  if (seoCase) {
    const prepared = await prepareSeoEvalCase(lane, scenario, context.resultId);
    scenario = prepared.scenario;
    state = { ...state, ...prepared.state };
  }
  const turnId =
    bot === "cuso"
      ? scenario.trigger?.kind === "follow_up"
        ? await startFollowUp(scenario.trigger, lane, clientTurnId)
        : scenario.cusoRhythm
          ? await startCusoRhythmTurn(lane, scenario.cusoRhythm)
          : (
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
function scenarioOutput(
  turn: Pick<
    Awaited<ReturnType<typeof loadLabScenarioTurn>>,
    "finalAnswer" | "route" | "status" | "errorKind" | "toolCalls"
  >,
) {
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
  if (isA2aScenario(scenario))
    return pollA2aScenario(scenario, turnId, lane, context);
  const turn = await loadLabScenarioTurn(turnId);
  if (!SETTLED_TURN_STATUSES.includes(turn.status)) {
    if (
      (await databaseNow()).getTime() - context.startedAt.getTime() <
      SCENARIO_TIMEOUT_MS
    )
      return { kind: "waiting" };
    await sokoBotControlPlane
      .cancelTurn(lane.userId, turnId)
      .catch(() => undefined);
    return {
      kind: "done",
      outcome: caseError("The turn did not settle in 20 minutes", [turnId]),
    };
  }
  const infrastructure = infrastructureCaseOutcome(
    turnId,
    turn,
    scenarioOutput(turn),
  );
  if (infrastructure) return { kind: "done", outcome: infrastructure };
  const result = evaluateScenario(scenario, turn);
  if (isSeoEvalCase(scenario.id)) {
    const checks = await seoEvalChecks(scenario.id, lane, turn, state);
    result.checks.push(...checks);
    result.total += checks.length;
    result.passed += checks.filter((check) => check.pass).length;
  }
  const comments = (state as { comments?: Record<string, string> } | null)
    ?.comments;
  if (comments) {
    const extra = commentChecks(turn.toolCalls, comments);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (isCompetitorEvalCase(scenario.id)) {
    const extra = await competitorFeedChecks(
      lane,
      scenario.id,
      context.startedAt,
    );
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === COMPETITOR_ADS_CASE_ID) {
    const extra = await competitorAdChecks(lane);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === CMO_ADS_CASE_ID) {
    const extra = await adsChecks(lane);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === CMO_WEEKLY_REVIEW_CASE_ID) {
    const extra = weeklyReviewChecks(
      turn.toolCalls,
      turn.finalAnswer ?? "",
      context.startedAt,
    );
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (CMO_SKILL_CASE_IDS.includes(scenario.id)) {
    const extra = await skillChecks(scenario.id, turnId);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (CMO_SHORT_FORM_CASE_IDS.includes(scenario.id)) {
    const extra = await shortFormChecks(scenario.id, turnId);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === CMO_CORRECTION_CASE_ID) {
    const extra = await correctionChecks(lane);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === CMO_FUNNEL_CASE_ID) {
    const extra = await funnelChecks(lane);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === COMPETITOR_LANDING_PAGE_CASE_ID) {
    const extra = await competitorLandingPageChecks(lane);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === SOKO_BOT_COMPETITOR_CASE_ID) {
    const extra = await sokoBotCompetitorChecks(lane);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === CHANGE_THEN_DRAFTS_CASE_ID) {
    const extra = await cmoChangeThenDraftsChecks(lane, context.startedAt);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === REPORT_HEADLINE_CASE_ID) {
    const extra = [
      ...(await reportHeadlineChecks(lane, context.startedAt)),
      ...partPatchChecks(turn.toolCalls, turn.finalAnswer ?? ""),
    ];
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (isCmoSeoReportCase(scenario.id)) {
    const extra = await cmoSeoReportChecks(
      lane,
      scenario.id,
      context.startedAt,
      turn.finalAnswer ?? "",
    );
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  if (scenario.id === CMO_POST_WITH_PICTURE_SCENARIO_ID) {
    const extra = await styledPictureChecks(lane, context.startedAt);
    result.checks.push(...extra);
    result.total += extra.length;
    result.passed += extra.filter((check) => check.pass).length;
  }
  const judged = await judgeEvalScenarioTurn(
    turnId,
    scenario,
    context.judgeModel,
  ).catch((error: unknown) => {
    // The eval cron, or an admin's tick request.
    recordCoreWarning(
      { operation: "eval_tick" },
      {
        message:
          "Could not judge an eval turn, so it is scored by its checks alone",
        why: "Judging the turn threw",
      },
      // An array: one tick judges a turn per lane. Only safe fields: the
      // judge reads the turn's messages, and its error can quote them.
      {
        evalJudgeFailures: [{ turnId, ...messageSafeErrorFields(error) }],
      },
    );
    return null;
  });
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

function cancelChain(lane: EvalLaneRecord, turnIds: string[]) {
  return Promise.all(
    turnIds.map((id) =>
      sokoBotControlPlane.cancelTurn(lane.userId, id).catch(() => undefined),
    ),
  );
}

/** An agent-to-agent case: the whole chain of turns, checked and judged as one. */
async function pollA2aScenario(
  scenario: SokoBotScenario,
  turnId: string,
  lane: EvalLaneRecord,
  context: CaseContext,
): Promise<CasePoll> {
  const step = await pollA2aChain({
    scenario,
    firstTurnId: turnId,
    lane,
    startedAt: context.startedAt,
  });
  if (step.kind === "waiting") return step;
  if (step.kind === "undelivered") {
    await cancelChain(lane, step.turnIds);
    await closeA2aWorld(lane);
    const infrastructure: EvalInfrastructureFailure = {
      code: "chat_delivery_failed",
      stopsRun: false,
      message: "A chat message of the case was never delivered",
      detail: step.detail,
    };
    return {
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: { infrastructure, notExecuted: false },
        error: `${infrastructure.message}: ${step.detail}`,
        turnIds: step.turnIds,
      },
    };
  }
  const { turnIds, timedOut } = step;
  if (timedOut) await cancelChain(lane, turnIds);
  const { turns, merged } = await loadA2aChain(turnIds);
  const output = {
    ...scenarioOutput(merged),
    chain: turns.map((turn, index) => ({
      turnId: turnIds[index],
      status: turn.status,
      answer: turn.finalAnswer,
      tools: turn.toolCalls.map((call) => call.capability),
    })),
  };
  const infrastructure = infrastructureCaseOutcome(turnIds[0]!, merged, output);
  if (infrastructure) return { kind: "done", outcome: infrastructure };
  const result = evaluateScenario(scenario, merged);
  const extra = await a2aChecks({
    scenario,
    lane,
    startedAt: context.startedAt,
    turnIds,
    timedOut,
  });
  result.checks.push(...extra);
  result.total += extra.length;
  result.passed += extra.filter((check) => check.pass).length;
  const roomLog = await a2aRoomLog(lane, context.startedAt);
  await closeA2aWorld(lane);
  const judged = await judgeEvalChain(
    turnIds,
    scenario,
    roomLog,
    context.judgeModel,
  ).catch((error: unknown) => {
    recordCoreWarning(
      { operation: "eval_tick" },
      {
        message:
          "Could not judge an eval chain, so it is scored by its checks alone",
        why: "Judging the chain threw",
      },
      {
        evalJudgeFailures: [
          { turnId: turnIds.at(-1), ...messageSafeErrorFields(error) },
        ],
      },
    );
    return null;
  });
  const passed =
    result.passed === result.total && judged?.verdict.verdict !== "fail";
  return {
    kind: "done",
    outcome: {
      status: passed ? "PASSED" : "FAILED",
      checks: result.checks,
      judge: judged?.verdict ?? null,
      judgeModel: judged?.model ?? null,
      output: { ...output, roomLog },
      turnIds: [
        ...turnIds,
        ...(await otherAgentTurnIds(lane, context.startedAt)),
      ],
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
  if (evalCase.kind === "standup")
    return startStandupCase(evalCase.setup, lane);
  if (evalCase.kind === "journey")
    return startJourney(evalCase.journey, lane, context);
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
  if (evalCase.kind === "standup")
    return pollStandupCase(evalCase.setup, lane, result.state);
  if (evalCase.kind === "journey")
    return pollJourney(evalCase.journey, lane, result.state, context);
  return pollCmoCase(evalCase, lane, result, context);
}
