import { setTimeout as sleep } from "node:timers/promises";
import {
  getSokoBotVersion,
  SOKO_BOT_SKILLS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotVersion,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { generateText, type ModelMessage, tool } from "ai";
import { z } from "zod";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import prisma from "@/lib/db/prisma";
import {
  emitCoreError,
  emitCoreWarning,
  runAsBackgroundWork,
  tryUseLogger,
} from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { gatewayCallUsage } from "@/lib/soko-bot/gateway-cost";
import { SOKO_BOT_JEV_MODEL } from "@/lib/soko-bot/jev";
import { modelCallTelemetryFor } from "@/lib/soko-bot/model-call-roles";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import {
  RuntimeEventLog,
  runtimeEvent,
  sokoBotToolCallTimeoutMs,
} from "@/lib/soko-bot/turn-loop";
import { loadCmoMarketingContext } from "@/services/cmo-context.service";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { CMO_MONTH_CALENDAR_MODEL } from "@/services/cmo-month-calendar.service";
import {
  cmoCalendarLanguage,
  cmoSideChannelFit,
  cmoStrategyRules,
} from "@/services/cmo-plan-review.service";
import {
  cmoStrategyBrief,
  cmoStrategyStepTurn,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actsForOwner } from "./acting-scope";
import { chargeCheck } from "./cmo";
import { type RuntimeOperations } from "./operations";

/**
 * cmo-v25 (owner, 2026-11-25): Core writes the strategy in one step instead
 * of Cuso saving it call by call and later turns repairing it. One
 * structured call writes the whole plan and its examples, Core saves it
 * through `save_strategy` (its hard rules and review), runs the two
 * calendar checks the review leaves to calendar saves, one more call fixes
 * every problem at once, and Core saves that. The month writer's shape:
 * Core decides and checks, the model fills in the words, a repair is told
 * exactly what to fix.
 *
 * The step runs as Core's background work, in its own invocation: a tool
 * call answers within the sandbox runner's two minutes, and one strong call
 * takes about one. `write_strategy` starts it and waits; a call that finds
 * it still writing tells Cuso to call again. The turn's runtime log holds
 * the step's start and end, so every call of the turn sees the same step.
 */

/** The strong model, as for Core's month writer. */
export const CMO_STRATEGY_STEP_MODEL = CMO_MONTH_CALENDAR_MODEL;
const STARTED = "cmo.strategy_step.started";
const ENDED = "cmo.strategy_step.ended";
/** Core's invocation lives 300 s; the step starts no call after this. */
const STEP_BUDGET_MS = 250_000;
/** A repair starts only with this much of the budget left. */
const REPAIR_MIN_MS = 70_000;
/**
 * Repairs after the first answer. One cleared 11 of 12 mainnet strategies;
 * Mailchimp's rewrite of a funnel goal broke a neighbouring rule, which a
 * second round, told what is left, fixes.
 */
const REPAIR_ROUNDS = 2;
const POLL_MS = 2_000;
/** A step with no end this long after its start died with its invocation. */
const STALE_MS = 6 * 60_000;
/** How long a call waits, inside its tool timeout. */
const waitMs = () => sokoBotToolCallTimeoutMs("write_strategy") - 12_000;

const answerSchema = z.object({
  strategy: SOKO_BOT_TOOL_INPUT_SCHEMAS.save_strategy.shape.strategy,
  toOwner: z.string().trim().min(1).max(700),
});
type Answer = z.infer<typeof answerSchema>;
export type StrategyAnswer = Answer["strategy"];
const ANSWER_TOOL = "answer_strategy";

export type StepEnd =
  | {
      state: "saved";
      versionId: string;
      toOwner: string;
      fixed: number;
      left: string[];
    }
  | { state: "failed"; reason: string };

/** The strategy skills a version writes by, without the step's own. */
function strategySkills(version: SokoBotVersion): string[] {
  return version.skills
    .filter((id) => id.startsWith("cmo-strategy") || id === "cmo-industry")
    .flatMap((id) => {
      const skill = SOKO_BOT_SKILLS.find((candidate) => candidate.id === id);
      return skill ? [skill.content.trim()] : [];
    });
}

/**
 * The same for every Cuso on a version, so the provider caches it across
 * them; what is this business's comes in the prompt.
 */
export function cmoStrategyStepSystem(version: SokoBotVersion): string {
  return [
    "You are Cuso, an AI marketer, writing a business's marketing strategy for Core, which saves it and checks it.",
    `Answer with one ${ANSWER_TOOL} call. strategy holds everything your strategy skill and the brief ask you to save: every field of the plan and the example posts in calendar. Where they say to save with save_strategy, in parts or calls, put all of it in this one answer instead: Core saves it. toOwner is what you tell the owner afterwards, in their language: one or two sentences on what the strategy does first (for a change, one sentence on what changed). Never mention tools, saves, Core or checks.`,
    "When Core sends back problems, answer once more with only what changes: each plan field you change, whole, and each calendar entry you change or add, whole under its id (status skipped drops one). Fix every problem named; change nothing else. toOwner is again what the owner hears about the strategy as it now stands (what it does first, or for a change what changed), never what you fixed.",
    ...strategySkills(version),
  ].join("\n\n");
}

/** What the step writes from: the brief and the business's whole context. */
export function cmoStrategyStepPrompt(
  brief: string,
  context: Record<string, unknown> | null,
): string {
  return [
    brief,
    "",
    "Your context: the business, its Brand Brain, the industry research, its networks and the strategy as saved now.",
    JSON.stringify(context ?? {}),
  ].join("\n");
}

/** The brief for an owner's change asked in chat, without a strategy turn's. */
export function cmoStrategyChangeBrief(businessName: string, change: string) {
  return [
    `Change ${businessName}'s marketing strategy. The owner asked: ${change}`,
    "Change only the strategy fields and calendar entries this touches, and nothing else: answer with each field you change, whole, and each calendar entry you change or add, whole under its id (status skipped drops one). Leave out every field and entry you keep; they stay exactly as they are. List each difference in changes, in plain words.",
    "Do not write a new strategy or touch the Brand Brain.",
  ].join("\n");
}

/** The repair's message: every problem at once, as Core's checks name them. */
export function cmoStrategyRepairPrompt(
  problems: readonly string[],
  round = 1,
): string {
  return [
    round === 1
      ? `Core saved your strategy and checked the whole of it. Fix each of these ${problems.length} problems, then answer once more with only what changes:`
      : `Core saved your fix and checked the whole strategy again. These ${problems.length} problems are left or came with the fix: fix each one without breaking another rule, then answer once more with only what changes:`,
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n");
}

/**
 * A try with its repair: each field the fix sends replaces the try's, each
 * entry replaces its own by id or is added. An entry the fix skips leaves a
 * new strategy's calendar; a patch keeps it skipped, which is how a patch
 * drops a saved entry.
 */
export function withStrategyFix(
  candidate: StrategyAnswer,
  fix: StrategyAnswer,
  keepSkipped = false,
): StrategyAnswer {
  const { calendar, ...fields } = fix;
  const sent = Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) =>
        value !== undefined &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0),
    ),
  );
  const entries = new Map(
    (candidate.calendar ?? []).map((entry) => [entry.id, entry]),
  );
  for (const entry of calendar ?? []) {
    if (entry.status === "skipped" && !keepSkipped) entries.delete(entry.id);
    else entries.set(entry.id, { ...entries.get(entry.id), ...entry });
  }
  return { ...candidate, ...sent, calendar: [...entries.values()] };
}

export interface StepContext {
  runtime: RuntimeOperations;
  input: ExecuteSokoBotToolInput;
  authorized: AuthorizedSokoBotRuntime;
  change: string | null;
  startedAt: number;
}

/** One answer of the strong model, charged to the turn like its steps. */
async function answer(
  context: StepContext,
  system: string,
  messages: ModelMessage[],
): Promise<{
  strategy: StrategyAnswer;
  toOwner: string;
  /** What the answer breaks of the save's own schema, for the repair. */
  issues: string[];
  message: ModelMessage[];
}> {
  const request = sokoBotModelRequest({
    role: "agent",
    model: CMO_STRATEGY_STEP_MODEL,
    purpose: "cmo",
  });
  const left = STEP_BUDGET_MS - (Date.now() - context.startedAt);
  const result = await generateText({
    ...request,
    providerOptions: {
      ...request.providerOptions,
      openai: { reasoningEffort: "low" },
    },
    system,
    messages,
    tools: {
      [ANSWER_TOOL]: tool({
        description:
          "The strategy, or for a repair or change only what changes, and the sentence for the owner.",
        inputSchema: answerSchema,
      }),
    },
    toolChoice: { type: "tool", toolName: ANSWER_TOOL },
    maxOutputTokens: 32_000,
    abortSignal: AbortSignal.timeout(Math.max(left, 5_000)),
    telemetry: modelCallTelemetryFor("cmo-strategy-step"),
  }).catch(rethrowAiGatewayFailure);
  await new RuntimeEventLog(context.input.turnId, context.input.sessionId)
    .append(
      runtimeEvent("step.completed", {
        modelId: CMO_STRATEGY_STEP_MODEL,
        usage: gatewayCallUsage(result),
      }),
    )
    .catch(() => undefined);
  const call = result.toolCalls.find((item) => item.toolName === ANSWER_TOOL);
  if (!call) throw new Error("The strategy call answered without a strategy");
  const raw = (call.input ?? {}) as { strategy?: unknown; toOwner?: unknown };
  const fitted = cmoFitStrategy(raw.strategy ?? {});
  return {
    ...fitted,
    toOwner: typeof raw.toOwner === "string" ? raw.toOwner.trim() : "",
    message: result.response.messages,
  };
}

const STRATEGY_SCHEMA =
  SOKO_BOT_TOOL_INPUT_SCHEMAS.save_strategy.shape.strategy;

/**
 * An answer fitted to the save's schema: a list or text past its limit (a
 * campaign on five networks) is cut to it in code, so the checks still run
 * on the first answer. What else the schema refuses goes to the repair.
 */
export function cmoFitStrategy(value: unknown): {
  strategy: StrategyAnswer;
  issues: string[];
} {
  let current: unknown = structuredClone(value);
  for (let pass = 0; pass < 5; pass++) {
    const parsed = STRATEGY_SCHEMA.safeParse(current);
    // The answer as sent, cut to fit: the parsed value would carry every
    // default, and a patch would send an empty list for each field it keeps.
    if (parsed.success)
      return { strategy: current as StrategyAnswer, issues: [] };
    let cut = false;
    for (const issue of parsed.error.issues) {
      if (issue.code !== "too_big" || typeof issue.maximum !== "number")
        continue;
      const parent = issue.path
        .slice(0, -1)
        .reduce<unknown>(
          (node, key) => (node as Record<PropertyKey, unknown>)?.[key],
          current,
        ) as Record<PropertyKey, unknown> | undefined;
      const key = issue.path.at(-1);
      const over = key === undefined ? undefined : parent?.[key];
      if (
        parent &&
        key !== undefined &&
        (Array.isArray(over) || typeof over === "string")
      ) {
        parent[key] = over.slice(0, Number(issue.maximum));
        cut = true;
      }
    }
    if (!cut)
      return {
        strategy: current as StrategyAnswer,
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      };
  }
  return { strategy: current as StrategyAnswer, issues: ["strategy: invalid"] };
}

export interface SaveOutcome {
  /** The version saved; null when nothing was. */
  versionId: string | null;
  problems: string[];
}

/** A refusal's lines, as problems. */
export function refusalProblems(message: string): string[] {
  const lines = message
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line && !line.startsWith("save_strategy saved nothing"));
  // A one-line refusal is its own problem: an empty list read as a clean save.
  return lines.length > 0 ? lines : [message.trim() || "the save was refused"];
}

/** Saves through Cuso's own save_strategy, so its hard rules and review hold. */
async function save(
  context: StepContext,
  round: number,
  body: { part: "all" | "patch"; strategy: StrategyAnswer },
): Promise<SaveOutcome> {
  try {
    const result = (await context.runtime.executeTool({
      ...context.input,
      capability: "save_strategy",
      toolCallId: `${context.input.toolCallId}:save:${round}`,
      input: body,
    })) as { versionId?: string; problems?: unknown };
    return {
      versionId: result.versionId ? String(result.versionId) : null,
      problems: Array.isArray(result.problems)
        ? result.problems.map(String)
        : [],
    };
  } catch (error) {
    if (error instanceof SokoBotRuntimeValidationError)
      return { versionId: null, problems: refusalProblems(error.message) };
    throw error;
  }
}

/** Saves an answer the schema takes; an answer it refuses saves nothing. */
export async function cmoSaveAnswer(
  context: Pick<StepContext, "runtime" | "input"> &
    Partial<Pick<StepContext, "authorized">>,
  round: number,
  part: "all" | "patch",
  strategy: StrategyAnswer,
  issues: readonly string[],
  checkCalendar: (versionId: string) => Promise<string[]> = (versionId) =>
    calendarChecks(context as StepContext, versionId),
): Promise<SaveOutcome> {
  if (issues.length > 0) return { versionId: null, problems: [...issues] };
  const saved = await save(context as StepContext, round, { part, strategy });
  // The saved version is checked whole, whatever this save sent: a patch of
  // the goals alone must not read an open calendar problem as fixed.
  return saved.versionId
    ? {
        ...saved,
        problems: [
          ...saved.problems,
          ...(await checkCalendar(saved.versionId)),
        ],
      }
    : saved;
}

/**
 * The calendar checks the review runs only on part calendar saves: the
 * examples in the plan's content language, and side networks for their buyer.
 */
async function calendarChecks(
  context: StepContext,
  versionId: string,
): Promise<string[]> {
  const version = await prisma.marketingStrategy.findUnique({
    where: { id: versionId },
    select: { plan: true },
  });
  const strategy = parseMarketingPlan(version?.plan);
  if (!strategy || strategy.calendar.length === 0) return [];
  const rules = cmoStrategyRules(
    getSokoBotVersion(context.authorized.turn.versionId).skills,
  );
  const [language, fit] = await Promise.all([
    cmoCalendarLanguage(strategy, null),
    rules.weekly
      ? cmoSideChannelFit(strategy)
      : Promise.resolve({ problems: [], costUsd: 0 }),
  ]);
  await chargeCheck(
    context.input,
    SOKO_BOT_JEV_MODEL,
    language.costUsd + fit.costUsd,
  );
  return [...language.problems, ...fit.problems];
}

/** Generate, save and check, then repairs told every problem left: the whole step. */
async function runStep(context: StepContext): Promise<StepEnd> {
  const { authorized, change } = context;
  const version = getSokoBotVersion(authorized.turn.versionId);
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { userMessage: true },
  });
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  const brief = change
    ? cmoStrategyChangeBrief(cuso?.businessName ?? "the business", change)
    : cmoStrategyBrief(turn.userMessage);
  if (!brief)
    throw new SokoBotRuntimeValidationError(
      "write_strategy without change writes a strategy turn's strategy only; for the owner's change, call it with change.",
    );
  const context_ = await loadCmoMarketingContext(
    authorized.turn.sokoBotId,
    new Date(),
  );
  const system = cmoStrategyStepSystem(version);
  const messages: ModelMessage[] = [
    { role: "user", content: cmoStrategyStepPrompt(brief, context_) },
  ];
  const first = await answer(context, system, messages);
  let last = first.message;
  return cmoRepairLoop({
    part: change ? "patch" : "all",
    first,
    save: (round, strategy, issues) =>
      cmoSaveAnswer(context, round, change ? "patch" : "all", strategy, issues),
    mayRepair: () =>
      STEP_BUDGET_MS - (Date.now() - context.startedAt) >= REPAIR_MIN_MS,
    repair: async (round, problems) => {
      const call = last.find((message) => message.role === "assistant");
      const toolCall = (Array.isArray(call?.content) ? call.content : []).find(
        (item) => item.type === "tool-call",
      );
      const repairPrompt = cmoStrategyRepairPrompt(problems, round);
      messages.push(
        ...last,
        toolCall?.type === "tool-call"
          ? {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: toolCall.toolCallId,
                  toolName: ANSWER_TOOL,
                  output: { type: "text", value: repairPrompt },
                },
              ],
            }
          : { role: "user", content: repairPrompt },
      );
      const repaired = await answer(context, system, messages);
      last = repaired.message;
      return repaired;
    },
  });
}

/** One answer of the model, fitted to the save's schema. */
export interface CmoStepAnswer {
  strategy: StrategyAnswer;
  toOwner: string;
  issues: string[];
}

/**
 * The step after its first answer: save, then repair while problems remain.
 * What was last tried and what was last saved are kept apart (Codex round
 * 5): a refused repair never reports success, the owner hears the sentence
 * of the answer whose save landed, a failed patch's corrections carry into
 * the next try, and every save is checked whole again.
 */
export async function cmoRepairLoop(input: {
  part: "all" | "patch";
  first: CmoStepAnswer;
  /** Saves one try; its problems are the saved version's, checked whole, or why nothing was saved. */
  save: (
    round: number,
    strategy: StrategyAnswer,
    issues: readonly string[],
  ) => Promise<SaveOutcome>;
  repair: (
    round: number,
    problems: readonly string[],
  ) => Promise<CmoStepAnswer>;
  mayRepair: () => boolean;
}): Promise<StepEnd> {
  const { part, first } = input;
  // A new strategy's try is always whole. A change's try is the patch not
  // saved yet: a refused patch's corrections stay in it for the next try.
  let attempt = first.strategy;
  let outcome = await input.save(1, attempt, first.issues);
  let saved: { versionId: string; problems: string[]; toOwner: string } | null =
    outcome.versionId
      ? {
          versionId: outcome.versionId,
          problems: outcome.problems,
          toOwner: first.toOwner,
        }
      : null;
  if (outcome.versionId && part === "patch") attempt = {};
  const initial = outcome.problems.length;
  for (
    let round = 1;
    round <= REPAIR_ROUNDS && outcome.problems.length > 0 && input.mayRepair();
    round++
  ) {
    const fix = await input.repair(round, outcome.problems);
    const fitted = cmoFitStrategy(
      withStrategyFix(attempt, fix.strategy, part === "patch"),
    );
    attempt = fitted.strategy;
    outcome = await input.save(round + 1, attempt, fitted.issues);
    if (!outcome.versionId) continue;
    saved = {
      versionId: outcome.versionId,
      problems: outcome.problems,
      toOwner: fix.toOwner || saved?.toOwner || first.toOwner,
    };
    if (part === "patch") attempt = {};
  }
  if (!saved)
    return {
      state: "failed",
      reason: `the strategy could not be saved: ${outcome.problems.join("; ").slice(0, 600)}`,
    };
  return {
    state: "saved",
    versionId: saved.versionId,
    toOwner:
      saved.toOwner ||
      (part === "all"
        ? "Your strategy is ready."
        : "Your strategy is changed."),
    fixed: Math.max(0, initial - saved.problems.length),
    left: saved.problems,
  };
}

/** A step's number in its event; events from before numbering are step 1. */
const stepOf = (data: unknown): number =>
  Number((data as { step?: unknown } | null)?.step) || 1;

/** A step the turn's log started, with what it was asked. */
export interface CmoStepStart {
  step: number;
  change: string | null;
  at: number;
}

export type CmoStepDecision =
  | { kind: "start"; step: number }
  | { kind: "wait"; step: number }
  | { kind: "done"; step: number }
  | { kind: "busy" };

/**
 * What a `write_strategy` call does with the turn's steps (Neon round 1: a
 * second change in one chat was refused for good). A step still writing is
 * waited for when it is the same request and refuses another one; once it
 * ended, the same request again reads its answer (a "call again to wait"
 * after the end), and another request starts the next step. A step with no
 * end past its stale limit counts as ended.
 */
export function cmoStepDecision(
  starts: readonly CmoStepStart[],
  ended: ReadonlySet<number>,
  change: string | null,
  now: number,
): CmoStepDecision {
  const running = starts.find(
    (start) => !ended.has(start.step) && now - start.at <= STALE_MS,
  );
  if (running)
    return running.change === change
      ? { kind: "wait", step: running.step }
      : { kind: "busy" };
  const last = starts.at(-1);
  if (last && last.change === change) return { kind: "done", step: last.step };
  return {
    kind: "start",
    step: Math.max(0, ...starts.map((start) => start.step)) + 1,
  };
}

/** A step's end, once its event is in the turn's log. */
async function stepEnd(turnId: string, step: number): Promise<StepEnd | null> {
  const ended = await prisma.sokoBotRuntimeEvent.findMany({
    where: { turnId, type: ENDED },
    orderBy: { startIndex: "desc" },
    select: { data: true },
  });
  const mine = ended.find((event) => stepOf(event.data) === step);
  return mine ? (mine.data as unknown as StepEnd) : null;
}

/** Waits for a step to end, up to `until`; null while it writes. */
async function awaitStep(
  turnId: string,
  step: number,
  startedAt: number,
  until: number,
): Promise<StepEnd | null> {
  for (;;) {
    const end = await stepEnd(turnId, step);
    if (end) return end;
    if (Date.now() - startedAt > STALE_MS)
      return { state: "failed", reason: "the step stopped without an answer" };
    if (Date.now() + POLL_MS > until) return null;
    await sleep(POLL_MS);
  }
}

/**
 * What `write_strategy` answers once the step ended. Only a strategy turn
 * (`cmoStrategyStepTurn`) is the step and nothing else, so only it ends on
 * the owner's sentence. In a chat the owner may have asked for more ("make
 * LinkedIn weekly, then draft three posts"): the turn goes on.
 */
export function cmoStrategyStepAnswer(
  end: StepEnd,
  strategyTurn: boolean,
): Record<string, unknown> {
  if (end.state === "failed")
    return {
      written: false,
      reason: end.reason,
      next: strategyTurn
        ? "Core could not write the strategy. Save it yourself with save_strategy, as the brief in your message and your strategy skill say, then tell the owner in one or two sentences what it does first."
        : "Core could not make this change. Make it yourself with save_strategy part patch, then go on with the rest of the owner's request.",
    };
  const saved = {
    written: true,
    versionId: end.versionId,
    problemsFixed: end.fixed,
    ...(end.left.length > 0 ? { problemsLeft: end.left } : {}),
  };
  return strategyTurn
    ? { ...saved, endTurn: end.toOwner }
    : {
        ...saved,
        toOwner: end.toOwner,
        next: "The strategy is saved. Do the rest of what the owner asked in this turn, then tell them what changed (toOwner says it) and what else you did.",
      };
}

/**
 * `write_strategy`: starts the turn's step once and waits for it. The answer
 * ends a strategy turn with the owner's sentence (a chat goes on), says Core
 * is still writing, or hands the strategy back to Cuso when the step failed.
 */
export async function writeCmoStrategy(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<Record<string, unknown>> {
  const until = Date.now() + waitMs();
  if (getSokoBotVersion(authorized.turn.versionId).profile !== "cmo")
    throw new SokoBotRuntimeAuthorizationError(
      "Only a CMO assistant writes a strategy",
    );
  if (!actsForOwner(authorized))
    throw new SokoBotRuntimeAuthorizationError(
      "Only the owner's turns change the strategy",
    );
  const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS.write_strategy.parse(input.input);
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { userMessage: true, clientTurnId: true },
  });
  // A step turn's change is the owner's note in its message.
  const change =
    parsed.change ??
    (cmoStrategyBrief(turn.userMessage) !== null
      ? (turn.userMessage.match(/The owner asked: (.+)/)?.[1] ?? null)
      : null);
  const log = new RuntimeEventLog(input.turnId, input.sessionId);
  const startedAt = Date.now();
  const event = runtimeEvent(STARTED, { change, step: 0 });
  // Decided under the log's lock, so two calls never start one step twice.
  const held: { decision: CmoStepDecision; starts: CmoStepStart[] } = {
    decision: { kind: "busy" },
    starts: [],
  };
  await log.appendUnless(event, [], async (tx) => {
    const rows = await tx.sokoBotRuntimeEvent.findMany({
      where: { turnId: input.turnId, type: { in: [STARTED, ENDED] } },
      orderBy: { startIndex: "asc" },
      select: { type: true, data: true, createdAt: true },
    });
    held.starts = rows
      .filter((row) => row.type === STARTED)
      .map((row) => ({
        step: stepOf(row.data),
        change: (row.data as { change?: string | null } | null)?.change ?? null,
        at: row.createdAt.getTime(),
      }));
    held.decision = cmoStepDecision(
      held.starts,
      new Set(
        rows.filter((row) => row.type === ENDED).map((row) => stepOf(row.data)),
      ),
      change,
      Date.now(),
    );
    if (held.decision.kind !== "start") return false;
    (event.data as { step: number }).step = held.decision.step;
    return true;
  });
  const decision = held.decision;
  if (decision.kind === "busy")
    throw new SokoBotRuntimeValidationError(
      "Core is still writing another change in this turn: call write_strategy with that same input to wait for it, and send the next change after it.",
    );
  if (decision.kind === "start") {
    const step = decision.step;
    const context: StepContext = {
      runtime,
      input,
      authorized,
      change,
      startedAt,
    };
    waitUntil(
      runAsBackgroundWork(async () => {
        const end = await runStep(context).catch((error: unknown): StepEnd => {
          emitCoreError(
            {
              operation: "cmo_strategy_step",
              turn: { id: input.turnId },
              failure: messageSafeErrorFields(error),
            },
            {
              message: "Core's strategy step failed",
              why: "Its model call, a save or a check threw",
              fix: "Cuso writes the strategy himself in the same turn. Look up the error under failure.",
            },
            { alert: "cmo_strategy_step_failed" },
          );
          return {
            state: "failed",
            reason:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "the step failed",
          };
        });
        if (end.state === "saved" && end.left.length > 0)
          emitCoreWarning(
            { operation: "cmo_strategy_step", turn: { id: input.turnId } },
            {
              message:
                "Core's strategy step saved a strategy with problems left",
              why: "Its one repair did not fix every problem the checks named",
              fix: "The owner sees the strategy as saved. Read the problems under left and sharpen the strategy skill or the checks.",
            },
            { left: end.left },
          );
        tryUseLogger()?.set({
          cmoStrategyStep: {
            turnId: input.turnId,
            state: end.state,
            ms: Date.now() - context.startedAt,
            ...(end.state === "saved"
              ? { fixed: end.fixed, left: end.left.length }
              : {}),
          },
        });
        await log.append(runtimeEvent(ENDED, { ...end, step } as never));
      }),
    );
  }
  const began =
    held.starts.find((start) => start.step === decision.step)?.at ?? startedAt;
  const end = await awaitStep(input.turnId, decision.step, began, until);
  if (!end)
    return {
      writing: true,
      next: "Core is still writing the strategy. Call write_strategy again with the same input to wait for it; do nothing else.",
    };
  return cmoStrategyStepAnswer(end, cmoStrategyStepTurn(turn.clientTurnId));
}
