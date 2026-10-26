import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
} from "ai";
import { streamModelCall } from "../lib/soko-bot/stream-model-call";
import { compactHistory } from "./history";
import {
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

/** Each provider's switch for a returned reasoning summary; others ignore it. */
const REASONING_SUMMARY_OPTIONS = {
  openai: { reasoningSummary: "auto" },
  google: { thinkingConfig: { includeThoughts: true } },
};

export interface TurnLoopInput {
  model: LanguageModel;
  system: string;
  message: string;
  tools: ToolSet;
  maxSteps: number;
  background: boolean;
  /** Epoch ms by which the turn must have answered. */
  deadline: number;
  stopped: AbortSignal;
  now?: () => number;
}

export interface TurnLoopResult {
  text: string;
  finishReason: string;
  steps: { reasoningText?: string | undefined }[];
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
  const reportAt = input.deadline - REPORT_RESERVE_MS;
  const timeUp = () => input.background && now() >= reportAt;
  let messages: ModelMessage[] = [{ role: "user", content: input.message }];
  let stepsLeft = input.maxSteps;
  const steps: TurnLoopResult["steps"] = [];
  let text = "";
  let finishReason = "";
  let idleRounds = 0;
  for (let round = 0; ; round++) {
    const result = await streamModelCall({
      model: input.model,
      system: input.system,
      messages: compactHistory(messages) ?? messages,
      tools: input.tools,
      stopWhen: [stepCountIs(stepsLeft), timeUp],
      prepareStep: ({ messages: current }) => {
        const compacted = compactHistory(current);
        return compacted ? { messages: compacted } : {};
      },
      // Ask for the provider's reasoning summary (never raw thoughts) so the
      // chat can show what the bot considered, as Coworker replies do.
      providerOptions: REASONING_SUMMARY_OPTIONS,
      abortSignal: signal(),
      maxRetries: 1,
    });
    steps.push(...result.steps);
    stepsLeft -= result.steps.length;
    // A model can answer in one step and end on an empty one; `text` is
    // only the last step's.
    text =
      result.text ||
      (result.steps.findLast((step) => step.text.trim())?.text ?? "");
    finishReason = result.finishReason;
    idleRounds = isIdleRound(
      result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      ),
    )
      ? idleRounds + 1
      : 0;
    messages = [...messages, ...result.response.messages];
    const keepGoing =
      input.background &&
      !isFinalReport(text) &&
      idleRounds < MAX_IDLE_ROUNDS &&
      round < MAX_KEEP_GOING_ROUNDS &&
      stepsLeft > 0 &&
      reportAt - now() > MIN_ROUND_TIME_MS;
    if (!keepGoing) break;
    messages.push({ role: "user", content: KEEP_GOING_PROMPT });
  }
  if (
    input.background &&
    !isFinalReport(text) &&
    idleRounds < MAX_IDLE_ROUNDS
  ) {
    const result = await streamModelCall({
      model: input.model,
      system: input.system,
      messages: [
        ...(compactHistory(messages) ?? messages),
        { role: "user", content: TIME_UP_PROMPT },
      ],
      tools: input.tools,
      toolChoice: "none",
      abortSignal: signal(),
      maxRetries: 1,
    });
    text = result.text || text;
    finishReason = result.finishReason;
  }
  return {
    text: input.background ? reportText(text) : text,
    finishReason,
    steps,
  };
}
