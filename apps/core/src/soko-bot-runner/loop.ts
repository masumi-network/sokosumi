import {
  type CmoShortFormTool,
  isSokoBotCapability,
  isStepFocusWriteCapability,
  type StepFocus,
  type StepFocusDecisionOutcome,
  type StepFocusRecentStep,
} from "@sokosumi/soko-bot";
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
} from "ai";
import {
  endedByShortForm,
  fullToolRoundAllowed,
  shortFormsIn,
  withShortForms,
} from "../lib/soko-bot/short-forms";
import {
  modelReasoningSummaryOptions,
  stepReasoningSummary,
  streamModelCall,
  withPromptCache,
} from "../lib/soko-bot/stream-model-call";
import {
  PART_OUT_OF_BUDGET_NOTE,
  StepAdmission,
  type TurnTokenBudget,
} from "../lib/soko-bot/turn-budget";
import { endedByTool, toolEndedTurn } from "../lib/soko-bot/turn-parts";
import { compactHistory } from "./history";
import {
  FOREGROUND_REPORT_RESERVE_MS,
  FOREGROUND_TIME_UP_PROMPT,
  isFinalReport,
  isIdleRound,
  KEEP_GOING_PROMPT,
  MAX_IDLE_ROUNDS,
  MAX_KEEP_GOING_ROUNDS,
  MIN_ROUND_TIME_MS,
  REPORT_RESERVE_MS,
  reportText,
  TIME_UP_PROMPT,
} from "./rounds";

export interface TurnLoopInput {
  /** The provider's prompt cache key for this system and tool set. */
  cacheKey?: string | null;
  /** The key once the full save tools replace their short forms. */
  fullCacheKey?: string | null;
  model: LanguageModel;
  system: string;
  message: string;
  tools: ToolSet;
  maxSteps: number;
  /**
   * Input tokens the whole turn may spend, shared by its parts and its main
   * loop; none from an older Core.
   */
  budget?: TurnTokenBudget;
  /**
   * A turn part: when the allowance runs out it hands back what it has, or
   * a note, and makes no wrap-up call; the turn's own loop makes the one.
   */
  part?: boolean;
  background: boolean;
  /** Epoch ms by which the turn must have answered. */
  deadline: number;
  stopped: AbortSignal;
  /** Told each step's reasoning summary as the step ends, when it has one. */
  onReasoning?: (summary: string) => Promise<void>;
  historyAfterRound?: (
    messages: ModelMessage[],
    steps: Awaited<ReturnType<typeof streamModelCall>>["steps"],
  ) => ModelMessage[];
  now?: () => number;
  /**
   * Save tools offered in their short form until one is called; the next
   * round offers the full tool (cmo-v24).
   */
  shortForms?: readonly CmoShortFormTool[];
  /** Core's plan for the request (planLoop); none on other versions. */
  plan?: TurnLoopPlan;
  /** Per-step focus selector (stepFocus experiment); none on other versions. */
  stepFocus?: TurnLoopStepFocus;
}

export interface TurnLoopStepFocusRequest {
  stepIndex: number;
  roundIndex: number;
  stepsInRound: number;
  stepsRemaining: number;
  recentSteps: StepFocusRecentStep[];
  hasAttemptedWrite: boolean;
  consecutiveInspect: number;
  consecutiveVerify: number;
  justExpandedShortForm: boolean;
}

export interface TurnLoopStepFocusSelection {
  decisionId: string;
  appliedFocus: StepFocus;
  usedFallback: boolean;
  allowedTools: readonly string[];
  toolChoice: "auto" | "none";
  verifyNote: string | null;
  verifyNoteKey: string | null;
}

export interface TurnLoopStepFocus {
  /** Selects the focus and tool bundle before each model step; null falls back to full tools. */
  selectStep: (
    input: TurnLoopStepFocusRequest,
  ) => Promise<TurnLoopStepFocusSelection | null>;
  /** Records the observed outcome of the step's focus decision. */
  recordOutcome?: (
    outcome: Omit<StepFocusDecisionOutcome, "kind">,
  ) => Promise<void>;
  /** Per-focus prompt cache keys (versions with skillsOnDemand). */
  cacheKeys?: Partial<Record<StepFocus, string>>;
  /** Per-focus prompt cache keys after short-form save tools expand. */
  fullCacheKeys?: Partial<Record<StepFocus, string>>;
}

export interface TurnLoopPlan {
  /**
   * The turn started with a plan from earlier in its request. Without one,
   * Core is asked nothing until the turn calls update_plan itself, so a
   * simple turn pays no extra call.
   */
  inherited: boolean;
  /**
   * Asked once when a foreground turn is about to answer: a prompt sends it
   * back for one more round, null lets the answer through.
   */
  doneCheck: (draft: string) => Promise<string | null>;
  /** The plan's open steps, for the keep-going nudge and the time-up report. */
  openSteps: () => Promise<string | null>;
  /** Tools whose completed call Core records as a change (a receipt). */
  changeTools: ReadonlySet<string>;
}

const PLAN_ANSWER_TIMEOUT_MS = 10_000;
/** The time-up report waits at most this long for the open steps. */
const REPORT_PLAN_WAIT_MS = 2_000;
/** A step-focus Jev call must never stall a step past its share of the turn. */
const STEP_FOCUS_WAIT_MS = 16_000;

async function stepFocusAnswer(
  ask: () => Promise<TurnLoopStepFocusSelection | null>,
  withinMs: number,
): Promise<TurnLoopStepFocusSelection | null> {
  if (withinMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ask(),
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          Math.min(STEP_FOCUS_WAIT_MS, withinMs),
        );
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stepToolKind(name: string): "read" | "write" {
  return isSokoBotCapability(name) && !isStepFocusWriteCapability(name)
    ? "read"
    : "write";
}

/** A nudge or time-up prompt that names the plan's open steps, when there are any. */
async function withOpenSteps(
  prompt: string,
  plan: TurnLoopPlan | undefined,
  withinMs: number,
): Promise<string> {
  const steps = plan ? await planAnswer(plan.openSteps, withinMs) : null;
  return steps ? `${prompt}\n\n${steps}` : prompt;
}

/**
 * Core's answer on the plan, or null when it does not come within the time
 * the turn can spare: an optional read never takes the answer's time.
 */
async function planAnswer(
  ask: () => Promise<string | null>,
  withinMs: number,
): Promise<string | null> {
  if (withinMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ask(),
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          Math.min(PLAN_ANSWER_TIMEOUT_MS, withinMs),
        );
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface TurnLoopResult {
  text: string;
  finishReason: string;
}

/**
 * Runs the model until it answers. A background run is nudged to keep going
 * until it reports DONE, stops working REPORT_RESERVE_MS before its deadline,
 * and then writes its report without tools.
 */
function modelIdOf(model: TurnLoopInput["model"]): string {
  return typeof model === "string" ? model : model.modelId;
}

export async function runTurnLoop(
  input: TurnLoopInput,
  callModel: typeof streamModelCall = streamModelCall,
): Promise<TurnLoopResult> {
  const now = input.now ?? Date.now;
  const signal = () =>
    AbortSignal.any([
      input.stopped,
      AbortSignal.timeout(Math.max(1_000, input.deadline - now())),
    ]);
  const remainingMs = Math.max(0, input.deadline - now());
  const reportReserve = input.background
    ? Math.min(REPORT_RESERVE_MS, remainingMs / 3)
    : Math.min(FOREGROUND_REPORT_RESERVE_MS, remainingMs / 5);
  const reportAt = input.deadline - reportReserve;
  const minRoundMs = Math.min(MIN_ROUND_TIME_MS, reportReserve);
  const timeUp = () => now() >= reportAt;
  const admission = new StepAdmission(input.budget);
  // Set once a step is refused: the allowance is spent, and the one call
  // left is the wrap-up below, without tools.
  let refused = false;
  const budgetSpent = () => {
    if (!admission.admit()) refused = true;
    return refused;
  };
  // Usage a call's steps carry beyond what its step callbacks booked: every
  // input token counts once, whichever way the model call reported it.
  let booked = 0;
  const bookUnreported = (
    steps: readonly { usage?: { inputTokens?: number | undefined } }[],
  ) => {
    const total = steps.reduce(
      (sum, step) => sum + (step.usage?.inputTokens ?? 0),
      0,
    );
    if (total > booked) admission.settle(total - booked);
    booked = 0;
    if (!admission.admit()) refused = true;
    else admission.release();
  };
  let messages: ModelMessage[] = [{ role: "user", content: input.message }];
  let stepsLeft = input.maxSteps;
  let text = "";
  let finishReason = "";
  let idleRounds = 0;
  let short = shortFormsIn(input.tools, input.shortForms ?? []);
  // Per-step focus state (active only when input.stepFocus is set).
  let turnStepIndex = 0;
  let hasAttemptedWrite = false;
  let consecutiveInspect = 0;
  let consecutiveVerify = 0;
  let justExpandedShortForm = false;
  const recentFocusSteps: StepFocusRecentStep[] = [];
  let lastActiveTools: string[] | undefined;
  let lastFocusCacheKey: string | undefined;
  let lastVerifyNoteKey: string | null = null;
  let currentFocus: {
    decisionId: string;
    appliedFocus: StepFocus;
    usedFallback: boolean;
    allowedTools: ReadonlySet<string> | null;
  } | null = null;
  let stepToolOutcomes: {
    name: string;
    kind: "read" | "write";
    status: "ok" | "error" | "disallowed_by_focus";
  }[] = [];

  // A tool that ran in the done check's extra round counts as work even when
  // the model call around it then fails. On stepFocus versions, the wrapper
  // also re-checks tool existence and active focus membership right before
  // dispatch so a model cannot invoke a tool outside its step bundle.
  const wrapTools = input.plan !== undefined || input.stepFocus !== undefined;
  const tools: ToolSet = wrapTools
    ? Object.fromEntries(
        Object.entries(input.tools).map(([name, each]) => {
          const execute = each.execute;
          if (!execute) return [name, each];
          return [
            name,
            {
              ...each,
              execute: async (...args: Parameters<typeof execute>) => {
                if (input.stepFocus) {
                  const kind = stepToolKind(name);
                  if (
                    !Object.hasOwn(input.tools, name) ||
                    typeof input.tools[name]?.execute !== "function"
                  ) {
                    stepToolOutcomes.push({
                      name,
                      kind,
                      status: "disallowed_by_focus",
                    });
                    throw new Error(`${name} is not available on this turn.`);
                  }
                  if (currentFocus?.appliedFocus === "answer") {
                    stepToolOutcomes.push({
                      name,
                      kind,
                      status: "disallowed_by_focus",
                    });
                    throw new Error(
                      `${name} is not allowed during the answer step (no tools are permitted). Write your response now.`,
                    );
                  }
                  if (
                    currentFocus?.allowedTools &&
                    !currentFocus.allowedTools.has(name)
                  ) {
                    stepToolOutcomes.push({
                      name,
                      kind,
                      status: "disallowed_by_focus",
                    });
                    throw new Error(
                      `${name} is not allowed during the ${currentFocus.appliedFocus} step. Use only the tools available for this step.`,
                    );
                  }
                }
                try {
                  const output = await execute(...args);
                  if (input.stepFocus) {
                    stepToolOutcomes.push({
                      name,
                      kind: stepToolKind(name),
                      status: "ok",
                    });
                  }
                  if (draft) {
                    workedAfterCheck = true;
                    if (input.plan?.changeTools.has(name))
                      changedAfterCheck = true;
                  }
                  return output;
                } catch (error) {
                  if (input.stepFocus) {
                    stepToolOutcomes.push({
                      name,
                      kind: stepToolKind(name),
                      status: "error",
                    });
                  }
                  throw error;
                }
              },
            },
          ];
        }),
      )
    : input.tools;
  const historyOptions = { keepLatestPlan: input.plan !== undefined };
  const compact = (history: readonly ModelMessage[]) =>
    compactHistory(history, undefined, historyOptions);
  let doneChecked = false;
  // Core is asked about the plan only once there is one: inherited, or
  // written in this turn.
  let activePlan = input.plan?.inherited ? input.plan : undefined;
  /** The reply the done check sent back, kept in case the extra round fails. */
  let draft: TurnLoopResult | undefined;
  /** The extra round called tools: the reply sent back no longer tells it all. */
  let workedAfterCheck = false;
  let changedAfterCheck = false;
  const roomForAnotherRound = () =>
    !refused &&
    stepsLeft > 1 &&
    reportAt - now() > minRoundMs &&
    // The extra round's step, and the wrap-up it may still need.
    (!input.budget ||
      input.budget.limit - input.budget.used - input.budget.reserved >=
        2 * input.budget.perStep);
  const fullKey = input.fullCacheKey ?? input.cacheKey;
  for (let round = 0; ; round++) {
    // The turn's other calls may have spent the allowance already.
    if (budgetSpent()) break;
    const roundTools = short.length ? withShortForms(tools, short) : tools;
    const stepFocus = input.stepFocus;
    const result = await callModel({
      model: input.model,
      system: input.system,
      messages: compact(messages) ?? messages,
      tools: roundTools,
      // The budget is checked last, so it reserves room only for a step
      // that will run.
      stopWhen: [
        stepCountIs(stepsLeft),
        timeUp,
        endedByTool,
        endedByShortForm(short),
        budgetSpent,
      ],
      prepareStep: stepFocus
        ? async ({ messages: current, stepNumber }) => {
            const compacted = compact(current);
            stepToolOutcomes = [];
            const selection = await stepFocusAnswer(
              () =>
                stepFocus.selectStep({
                  stepIndex: turnStepIndex,
                  roundIndex: round,
                  stepsInRound: stepNumber,
                  stepsRemaining: Math.max(0, stepsLeft - stepNumber),
                  recentSteps: recentFocusSteps.slice(-6),
                  hasAttemptedWrite,
                  consecutiveInspect,
                  consecutiveVerify,
                  justExpandedShortForm,
                }),
              Math.max(0, reportAt - now()),
            );
            justExpandedShortForm = false;
            if (!selection) {
              currentFocus = null;
              return compacted ? { messages: compacted } : {};
            }
            const registeredNames = new Set(Object.keys(roundTools));
            const liveAllowed = selection.allowedTools.filter((name) =>
              registeredNames.has(name),
            );
            currentFocus = {
              decisionId: selection.decisionId,
              appliedFocus: selection.appliedFocus,
              usedFallback: selection.usedFallback,
              allowedTools:
                selection.appliedFocus === "answer"
                  ? new Set()
                  : new Set(liveAllowed),
            };
            const baseMessages = compacted ?? current;
            const shouldInjectVerify =
              selection.appliedFocus === "verify" &&
              Boolean(selection.verifyNote) &&
              selection.verifyNoteKey !== lastVerifyNoteKey;
            const nextMessages = shouldInjectVerify
              ? [
                  ...baseMessages,
                  {
                    role: "user" as const,
                    content: selection.verifyNote as string,
                  },
                ]
              : compacted;
            if (shouldInjectVerify) {
              lastVerifyNoteKey = selection.verifyNoteKey;
            }
            const focusKeys = short.length
              ? stepFocus.cacheKeys
              : (stepFocus.fullCacheKeys ?? stepFocus.cacheKeys);

            if (selection.appliedFocus === "answer") {
              const hasPriorToolHistory = baseMessages.some(
                (message) => message.role === "tool",
              );
              const answerCacheKey = hasPriorToolHistory
                ? (lastFocusCacheKey ?? focusKeys?.answer)
                : focusKeys?.answer;
              const answerProviderOptions = answerCacheKey
                ? withPromptCache(
                    modelReasoningSummaryOptions(input.model),
                    answerCacheKey,
                    modelIdOf(input.model),
                  )
                : undefined;
              return {
                ...(nextMessages ? { messages: nextMessages } : {}),
                ...(answerProviderOptions
                  ? { providerOptions: answerProviderOptions }
                  : {}),
                toolChoice: "none" as const,
                ...(hasPriorToolHistory
                  ? lastActiveTools
                    ? { activeTools: lastActiveTools }
                    : {}
                  : { activeTools: [] }),
              };
            }
            const focusKey = focusKeys?.[selection.appliedFocus];
            const stepProviderOptions = focusKey
              ? withPromptCache(
                  modelReasoningSummaryOptions(input.model),
                  focusKey,
                  modelIdOf(input.model),
                )
              : undefined;
            lastActiveTools = liveAllowed;
            lastFocusCacheKey = focusKey;
            return {
              ...(nextMessages ? { messages: nextMessages } : {}),
              ...(stepProviderOptions
                ? { providerOptions: stepProviderOptions }
                : {}),
              toolChoice: "auto" as const,
              activeTools: liveAllowed,
            };
          }
        : ({ messages: current }) => {
            const compacted = compact(current);
            return compacted ? { messages: compacted } : {};
          },
      // Ask for the provider's reasoning summary (never raw thoughts) so the
      // chat can show what the bot considered, as Coworker replies do.
      providerOptions: withPromptCache(
        modelReasoningSummaryOptions(input.model),
        short.length ? input.cacheKey : fullKey,
        modelIdOf(input.model),
      ),
      onStepFinish: async (step) => {
        booked += step.usage.inputTokens ?? 0;
        admission.settle(step.usage.inputTokens);
        const summary = stepReasoningSummary(step);
        if (summary) await input.onReasoning?.(summary);
        if (stepFocus) {
          const recorded = currentFocus;
          const executed = [...stepToolOutcomes];
          // Capture any tool call rejected by the SDK before execute ran.
          const seenCounts = new Map<string, number>();
          for (const item of executed) {
            seenCounts.set(item.name, (seenCounts.get(item.name) ?? 0) + 1);
          }
          const callCounts = new Map<string, number>();
          for (const call of step.toolCalls ?? []) {
            const nextCount = (callCounts.get(call.toolName) ?? 0) + 1;
            callCounts.set(call.toolName, nextCount);
            if (nextCount > (seenCounts.get(call.toolName) ?? 0)) {
              const outsideBundle =
                recorded?.appliedFocus === "answer" ||
                (recorded?.allowedTools !== null &&
                  recorded?.allowedTools !== undefined &&
                  !recorded.allowedTools.has(call.toolName));
              executed.push({
                name: call.toolName,
                kind: stepToolKind(call.toolName),
                status: outsideBundle ? "disallowed_by_focus" : "error",
              });
            }
          }
          if (
            executed.some(
              (item) =>
                item.kind === "write" &&
                item.status !== "disallowed_by_focus" &&
                !(short as readonly string[]).includes(item.name),
            )
          ) {
            hasAttemptedWrite = true;
          }
          if (recorded?.appliedFocus === "inspect") {
            consecutiveInspect += 1;
            consecutiveVerify = 0;
          } else if (recorded?.appliedFocus === "verify") {
            consecutiveVerify += 1;
            consecutiveInspect = 0;
          } else {
            consecutiveInspect = 0;
            consecutiveVerify = 0;
          }
          recentFocusSteps.push({
            stepIndex: turnStepIndex,
            focus: recorded?.appliedFocus ?? null,
            tools: executed,
            hadText: Boolean(step.text?.trim()),
          });
          if (recorded && stepFocus.recordOutcome) {
            await stepFocus
              .recordOutcome({
                decisionId: recorded.decisionId,
                stepIndex: turnStepIndex,
                appliedFocus: recorded.appliedFocus,
                usedFallback: recorded.usedFallback,
                finishReason: step.finishReason ?? "unknown",
                toolCalls: executed.map(({ name, status }) => ({
                  name,
                  status,
                })),
                inputTokens: step.usage.inputTokens ?? 0,
                outputTokens: step.usage.outputTokens ?? 0,
                cacheReadTokens:
                  step.usage.inputTokenDetails?.cacheReadTokens ?? 0,
              })
              .catch(() => undefined);
          }
          turnStepIndex += 1;
        }
      },
      abortSignal: signal(),
      maxRetries: 1,
    })
      .finally(() => admission.release())
      // The done check's extra round is optional: if it fails, the answer
      // the check sent back stands.
      .catch((error: unknown) => {
        if (draft) return null;
        throw error;
      });
    if (!result) {
      // Failed before doing anything: the reply the check sent back stands.
      // After a tool ran, it no longer tells the whole story: the wrap-up
      // below writes the answer from what Core recorded.
      if (!workedAfterCheck) return draft as TurnLoopResult;
      text = "";
      finishReason = "error";
      break;
    }
    bookUnreported(result.steps);
    if (draft && result.steps.some((step) => step.toolCalls.length > 0))
      workedAfterCheck = true;
    if (
      input.plan &&
      !activePlan &&
      // Only a plan Core accepted: a refused write is a tool error.
      result.steps.some((step) =>
        step.toolResults.some((call) => call.toolName === "update_plan"),
      )
    )
      activePlan = input.plan;
    stepsLeft -= result.steps.length;
    // A model can answer in one step and end on an empty one; `text` is
    // only the last step's.
    const ended = toolEndedTurn(result.steps);
    if (ended) return { text: ended, finishReason: result.finishReason };
    text =
      result.text ||
      (result.steps.findLast((step) => step.text.trim())?.text ?? "");
    finishReason = result.finishReason;
    idleRounds = isIdleRound(result.steps.flatMap((step) => step.toolCalls))
      ? idleRounds + 1
      : 0;
    // Every step's messages: `response.messages` holds the last step's alone,
    // and a nudged round that cannot see its own calls does the brief again.
    messages = input.historyAfterRound
      ? input.historyAfterRound(messages, result.steps)
      : [...messages, ...result.responseMessages];
    // A short-form save ended the round: the next offers the full tool, as
    // long as steps, time and tokens all leave room for it.
    if (
      fullToolRoundAllowed({
        steps: result.steps,
        shortForms: short,
        stepsLeft,
        tokensLeft: refused
          ? 0
          : input.budget
            ? input.budget.limit - input.budget.used - input.budget.reserved
            : Number.POSITIVE_INFINITY,
        timeUp: timeUp(),
      })
    ) {
      short = [];
      justExpandedShortForm = true;
      continue;
    }
    const keepGoing =
      input.background &&
      !isFinalReport(text) &&
      idleRounds < MAX_IDLE_ROUNDS &&
      round < MAX_KEEP_GOING_ROUNDS &&
      stepsLeft > 0 &&
      !refused &&
      reportAt - now() > minRoundMs;
    if (!keepGoing) {
      // The done check: a foreground answer with open plan steps goes back
      // once, only while steps, time and tokens leave room for that round
      // and a wrap-up after it, checked again once Core has answered.
      const plan = activePlan;
      if (
        plan &&
        !doneChecked &&
        !input.background &&
        !input.part &&
        finishReason !== "tool-calls" &&
        text.trim() &&
        roomForAnotherRound()
      ) {
        doneChecked = true;
        const prompt = await planAnswer(
          () => plan.doneCheck(text),
          reportAt - now() - minRoundMs,
        );
        if (prompt && roomForAnotherRound()) {
          draft = { text, finishReason };
          messages.push({ role: "user", content: prompt });
          continue;
        }
      }
      break;
    }
    messages.push({
      role: "user",
      content: await withOpenSteps(
        KEEP_GOING_PROMPT,
        activePlan,
        reportAt - now() - minRoundMs,
      ),
    });
  }
  // A turn that ran out of steps, time or tokens while still calling tools
  // has no answer yet: one call without tools writes it.
  const cutOff = stepsLeft <= 0 || timeUp() || refused;
  // The latest complete answer wins. The one the done check sent back stands
  // only when the extra round did nothing and wrote nothing new; once it
  // worked, that reply is stale and the wrap-up below writes a new one.
  const noNewAnswer = finishReason === "tool-calls" || !text.trim();
  if (draft && !workedAfterCheck && noNewAnswer) return draft;
  // A part never makes a wrap-up call, whatever stopped it: the turn's own
  // loop makes the one, from what the parts handed back.
  if (cutOff && input.part)
    return {
      text:
        finishReason === "tool-calls" || !text.trim()
          ? PART_OUT_OF_BUDGET_NOTE
          : text,
      finishReason: finishReason || "budget",
    };
  const needsReport = input.background
    ? !isFinalReport(text) && idleRounds < MAX_IDLE_ROUNDS
    : (cutOff || workedAfterCheck) && noNewAnswer;
  if (needsReport) {
    const result = await callModel({
      model: input.model,
      system: input.system,
      messages: [
        ...(compact(messages) ?? messages),
        {
          role: "user",
          content: await withOpenSteps(
            input.background ? TIME_UP_PROMPT : FOREGROUND_TIME_UP_PROMPT,
            activePlan,
            Math.min(REPORT_PLAN_WAIT_MS, (input.deadline - now()) / 10),
          ),
        },
      ],
      tools: input.tools,
      toolChoice: "none",
      providerOptions: withPromptCache({}, fullKey, modelIdOf(input.model)),
      abortSignal: signal(),
      maxRetries: 1,
    }).catch((error: unknown) => {
      // Past the done check, the reply it sent back is still an answer.
      if (draft) return null;
      throw error;
    });
    // After a change, the reply the check sent back is stale: an empty answer
    // lets Core's receipts say what was done.
    if (!result)
      return changedAfterCheck
        ? { text: "", finishReason: "error" }
        : (draft as TurnLoopResult);
    // The one wrap-up call: never refused, always booked.
    for (const step of result.steps) admission.settle(step.usage.inputTokens);
    text = result.text || text;
    finishReason = result.finishReason;
  }
  return {
    text: input.background ? reportText(text) : text,
    finishReason,
  };
}
