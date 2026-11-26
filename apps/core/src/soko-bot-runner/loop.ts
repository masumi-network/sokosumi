import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
} from "ai";
import {
  modelReasoningSummaryOptions,
  stepReasoningSummary,
  streamModelCall,
} from "../lib/soko-bot/stream-model-call";
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
  background: boolean;
  /** Epoch ms by which the turn must have answered. */
  deadline: number;
  stopped: AbortSignal;
  /** Told each step's reasoning summary as the step ends, when it has one. */
  onReasoning?: (summary: string) => Promise<void>;
  now?: () => number;
}

/** One turn's input-token allowance; every loop of the turn adds to `used`. */
export interface TurnTokenBudget {
  limit: number;
  used: number;
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
export async function runTurnLoop(
  input: TurnLoopInput,
): Promise<TurnLoopResult> {
  const now = input.now ?? Date.now;
  const signal = () =>
    AbortSignal.any([
      input.stopped,
      AbortSignal.timeout(Math.max(1_000, input.deadline - now())),
    ]);
  const reportAt =
    input.deadline -
    (input.background
      ? REPORT_RESERVE_MS
      : Math.min(
          FOREGROUND_REPORT_RESERVE_MS,
          Math.max(0, input.deadline - now()) / 5,
        ));
  const timeUp = () => now() >= reportAt;
  const budget = input.budget ?? {
    limit: Number.POSITIVE_INFINITY,
    used: 0,
  };
  const spend = (step: { usage: { inputTokens?: number | undefined } }) => {
    budget.used += step.usage.inputTokens ?? 0;
  };
  const overBudget = () => budget.used >= budget.limit;
  let messages: ModelMessage[] = [{ role: "user", content: input.message }];
  let stepsLeft = input.maxSteps;
  let text = "";
  let finishReason = "";
  let idleRounds = 0;
  for (let round = 0; ; round++) {
    // The turn's parts may have spent the allowance: answer without tools.
    if (overBudget()) break;
    const result = await streamModelCall({
      model: input.model,
      system: input.system,
      messages: compactHistory(messages) ?? messages,
      tools: input.tools,
      stopWhen: [stepCountIs(stepsLeft), timeUp, overBudget, endedByTool],
      prepareStep: ({ messages: current }) => {
        const compacted = compactHistory(current);
        return compacted ? { messages: compacted } : {};
      },
      // Ask for the provider's reasoning summary (never raw thoughts) so the
      // chat can show what the bot considered, as Coworker replies do.
      providerOptions: modelReasoningSummaryOptions(input.model),
      onStepFinish: async (step) => {
        spend(step);
        const summary = stepReasoningSummary(step);
        if (summary) await input.onReasoning?.(summary);
      },
      abortSignal: signal(),
      maxRetries: 1,
    });
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
    messages = [...messages, ...result.responseMessages];
    const keepGoing =
      input.background &&
      !isFinalReport(text) &&
      idleRounds < MAX_IDLE_ROUNDS &&
      round < MAX_KEEP_GOING_ROUNDS &&
      stepsLeft > 0 &&
      !overBudget() &&
      reportAt - now() > MIN_ROUND_TIME_MS;
    if (!keepGoing) break;
    messages.push({ role: "user", content: KEEP_GOING_PROMPT });
  }
  // A turn that ran out of steps, time or tokens while still calling tools
  // has no answer yet: one call without tools writes it.
  const cutOff = stepsLeft <= 0 || timeUp() || overBudget();
  const needsReport = input.background
    ? !isFinalReport(text) && idleRounds < MAX_IDLE_ROUNDS
    : cutOff && (finishReason === "tool-calls" || !text.trim());
  if (needsReport) {
    const result = await streamModelCall({
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
      abortSignal: signal(),
      maxRetries: 1,
    });
    for (const step of result.steps) spend(step);
    text = result.text || text;
    finishReason = result.finishReason;
  }
  return {
    text: input.background ? reportText(text) : text,
    finishReason,
  };
}
