import type { CmoShortFormTool } from "@sokosumi/soko-bot";
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
  const fullKey = input.fullCacheKey ?? input.cacheKey;
  for (let round = 0; ; round++) {
    // The turn's other calls may have spent the allowance already.
    if (budgetSpent()) break;
    const result = await callModel({
      model: input.model,
      system: input.system,
      messages: compactHistory(messages) ?? messages,
      tools: short.length ? withShortForms(input.tools, short) : input.tools,
      // The budget is checked last, so it reserves room only for a step
      // that will run.
      stopWhen: [
        stepCountIs(stepsLeft),
        timeUp,
        endedByTool,
        endedByShortForm(short),
        budgetSpent,
      ],
      prepareStep: ({ messages: current }) => {
        const compacted = compactHistory(current);
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
      },
      abortSignal: signal(),
      maxRetries: 1,
    }).finally(() => admission.release());
    bookUnreported(result.steps);
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
    if (!keepGoing) break;
    messages.push({ role: "user", content: KEEP_GOING_PROMPT });
  }
  // A turn that ran out of steps, time or tokens while still calling tools
  // has no answer yet: one call without tools writes it.
  const cutOff = stepsLeft <= 0 || timeUp() || refused;
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
    : cutOff && (finishReason === "tool-calls" || !text.trim());
  if (needsReport) {
    const result = await callModel({
      model: input.model,
      system: input.system,
      messages: [
        ...(compactHistory(messages) ?? messages),
        {
          role: "user",
          content: input.background
            ? TIME_UP_PROMPT
            : FOREGROUND_TIME_UP_PROMPT,
        },
      ],
      tools: input.tools,
      toolChoice: "none",
      providerOptions: withPromptCache({}, fullKey, modelIdOf(input.model)),
      abortSignal: signal(),
      maxRetries: 1,
    });
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
