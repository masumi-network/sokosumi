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
type StrategyAnswer = Answer["strategy"];
const ANSWER_TOOL = "answer_strategy";

type StepEnd =
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
    "When Core sends back problems, answer once more with only what changes: each plan field you change, whole, and each calendar entry you change or add, whole under its id (status skipped drops one). Fix every problem named; change nothing else.",
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

/** What Cuso tells the owner after a repair: a new strategy keeps its first line. */
export function cmoOwnerLine(
  part: "all" | "patch",
  first: string,
  repaired: string,
): string {
  return part === "all" ? first || repaired : repaired || first;
}

/** The repair's message: every problem at once, as Core's checks name them. */
export function cmoStrategyRepairPrompt(problems: readonly string[]): string {
  return [
    `Core saved your strategy and checked the whole of it. Fix each of these ${problems.length} problems, then answer once more with only what changes:`,
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n");
}

/**
 * A fresh strategy with its repair: each field the fix sends replaces the
 * candidate's, each entry replaces its own by id or is added, and an entry
 * the fix skips leaves the calendar.
 */
export function withStrategyFix(
  candidate: StrategyAnswer,
  fix: StrategyAnswer,
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
    if (entry.status === "skipped") entries.delete(entry.id);
    else entries.set(entry.id, { ...entries.get(entry.id), ...entry });
  }
  return { ...candidate, ...sent, calendar: [...entries.values()] };
}

interface StepContext {
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
    if (parsed.success) return { strategy: parsed.data, issues: [] };
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

interface SaveOutcome {
  /** The version saved; null when nothing was. */
  versionId: string | null;
  problems: string[];
}

/** A refusal's lines, as problems. */
function refusalProblems(message: string): string[] {
  return message
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line && !line.startsWith("save_strategy saved nothing"));
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
async function saveAnswer(
  context: StepContext,
  round: number,
  part: "all" | "patch",
  strategy: StrategyAnswer,
  issues: readonly string[],
): Promise<SaveOutcome> {
  if (issues.length > 0) return { versionId: null, problems: [...issues] };
  const saved = await save(context, round, { part, strategy });
  return saved.versionId && strategy.calendar?.length
    ? {
        ...saved,
        problems: [
          ...saved.problems,
          ...(await calendarChecks(context, saved.versionId)),
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

/** Generate, save and check, one repair, save: the whole step. */
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
  const part = change ? "patch" : "all";
  const candidate = first.strategy;
  let toOwner = first.toOwner;
  let saved = await saveAnswer(context, 1, part, candidate, first.issues);
  const problems = saved.problems;
  if (
    problems.length > 0 &&
    STEP_BUDGET_MS - (Date.now() - context.startedAt) >= REPAIR_MIN_MS
  ) {
    const call = first.message.find((message) => message.role === "assistant");
    const toolCall = (Array.isArray(call?.content) ? call.content : []).find(
      (item) => item.type === "tool-call",
    );
    const repairPrompt = cmoStrategyRepairPrompt(problems);
    const repair = await answer(context, system, [
      ...messages,
      ...first.message,
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
    ]);
    // A new strategy's line says what it does first; a repair's says what
    // it fixed, which is Core's business. A change's line is the change.
    toOwner = cmoOwnerLine(part, toOwner, repair.toOwner);
    // A change saves its fix as one more patch onto the version it saved.
    // A new strategy saves whole, so a first answer that never saved lands.
    const fix =
      part === "patch" && saved.versionId
        ? repair.strategy
        : withStrategyFix(candidate, repair.strategy);
    const fitted = cmoFitStrategy(fix);
    const issues = fitted.issues;
    const fixed = await saveAnswer(context, 2, part, fitted.strategy, issues);
    if (fixed.versionId) saved = fixed;
    else saved = { ...saved, problems: fixed.problems };
  }
  const left = saved.problems;
  if (!saved.versionId || !toOwner)
    return {
      state: "failed",
      reason: `the strategy could not be saved: ${left.join("; ").slice(0, 600)}`,
    };
  return {
    state: "saved",
    versionId: saved.versionId,
    toOwner,
    fixed: Math.max(0, problems.length - left.length),
    left,
  };
}

/** The step's end, once its event is in the turn's log. */
async function stepEnd(turnId: string): Promise<StepEnd | null> {
  const ended = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId, type: ENDED },
    orderBy: { startIndex: "desc" },
    select: { data: true },
  });
  return ended ? (ended.data as unknown as StepEnd) : null;
}

/** Waits for the turn's step to end, up to `until`; null while it writes. */
async function awaitStep(
  turnId: string,
  startedAt: Date,
  until: number,
): Promise<StepEnd | null> {
  for (;;) {
    const end = await stepEnd(turnId);
    if (end) return end;
    if (Date.now() - startedAt.getTime() > STALE_MS)
      return { state: "failed", reason: "the step stopped without an answer" };
    if (Date.now() + POLL_MS > until) return null;
    await sleep(POLL_MS);
  }
}

function endAnswer(end: StepEnd): Record<string, unknown> {
  if (end.state === "failed")
    return {
      written: false,
      reason: end.reason,
      next: "Core could not write the strategy. Save it yourself with save_strategy, as the brief in your message and your strategy skill say, then tell the owner in one or two sentences what it does first.",
    };
  return {
    written: true,
    versionId: end.versionId,
    problemsFixed: end.fixed,
    ...(end.left.length > 0 ? { problemsLeft: end.left } : {}),
    endTurn: end.toOwner,
  };
}

/**
 * `write_strategy`: starts the turn's step once and waits for it. The answer
 * ends the turn with the owner's sentence, says Core is still writing, or
 * hands the strategy back to Cuso when the step failed.
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
    select: { userMessage: true },
  });
  // A step turn's change is the owner's note in its message.
  const change =
    parsed.change ??
    (cmoStrategyBrief(turn.userMessage) !== null
      ? (turn.userMessage.match(/The owner asked: (.+)/)?.[1] ?? null)
      : null);
  const log = new RuntimeEventLog(input.turnId, input.sessionId);
  const startedAt = new Date();
  const first = await log.appendUnless(runtimeEvent(STARTED, { change }), [
    STARTED,
  ]);
  if (first) {
    const context: StepContext = {
      runtime,
      input,
      authorized,
      change,
      startedAt: startedAt.getTime(),
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
        await log.append(runtimeEvent(ENDED, end as never));
      }),
    );
  } else {
    const started = await prisma.sokoBotRuntimeEvent.findFirst({
      where: { turnId: input.turnId, type: STARTED },
      select: { data: true },
    });
    const was = (started?.data as { change?: string | null } | null)?.change;
    if ((was ?? null) !== change)
      throw new SokoBotRuntimeValidationError(
        "Core is already writing another change in this turn: call write_strategy with that same input to wait for it, and send the next change after it.",
      );
  }
  const began = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { turnId: input.turnId, type: STARTED },
    select: { createdAt: true },
  });
  const end = await awaitStep(
    input.turnId,
    began?.createdAt ?? startedAt,
    until,
  );
  if (!end)
    return {
      writing: true,
      next: "Core is still writing the strategy. Call write_strategy again with the same input to wait for it; do nothing else.",
    };
  return endAnswer(end);
}
