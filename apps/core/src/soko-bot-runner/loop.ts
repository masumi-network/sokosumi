import type { CmoShortFormTool } from "@sokosumi/soko-bot";
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
} from "ai";
import {
  calledShortForm,
  endedByShortForm,
  shortFormsIn,
  withShortForms,
} from "../lib/soko-bot/short-forms";
import {
  modelReasoningSummaryOptions,
  stepReasoningSummary,
  streamModelCall,
  withPromptCache,
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
  /** The provider's prompt cache key for this system and tool set. */
  cacheKey?: string | null;
  model: LanguageModel;
  system: string;
  message: string;
  tools: ToolSet;
  maxSteps: number;
  /** Input tokens the turn may spend across all its model calls; none from an older Core. */
  inputTokenBudget?: number;
  background: boolean;
  /** Epoch ms by which the turn must have answered. */
  deadline: number;
  stopped: AbortSignal;
  /** Told each step's reasoning summary as the step ends, when it has one. */
  onReasoning?: (summary: string) => Promise<void>;
  now?: () => number;
  /**
   * Save tools offered in their short form until one is called; the next
   * round offers the full tool (cmo-v24).
   */
  shortForms?: readonly CmoShortFormTool[];
}

interface StepUsage {
  usage: { inputTokens?: number | undefined };
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
  const tokenBudget = input.inputTokenBudget ?? Number.POSITIVE_INFINITY;
  let tokensUsed = 0;
  const inputTokensOf = (steps: readonly StepUsage[]) =>
    steps.reduce((sum, step) => sum + (step.usage.inputTokens ?? 0), 0);
  const overBudget = ({ steps }: { steps: readonly StepUsage[] }) =>
    tokensUsed + inputTokensOf(steps) >= tokenBudget;
  let messages: ModelMessage[] = [{ role: "user", content: input.message }];
  let stepsLeft = input.maxSteps;
  let text = "";
  let finishReason = "";
  let idleRounds = 0;
  let short = shortFormsIn(input.tools, input.shortForms ?? []);
  for (let round = 0; ; round++) {
    const result = await streamModelCall({
      model: input.model,
      system: input.system,
      messages: compactHistory(messages) ?? messages,
      tools: short.length ? withShortForms(input.tools, short) : input.tools,
      stopWhen: [
        stepCountIs(stepsLeft),
        timeUp,
        overBudget,
        endedByTool,
        endedByShortForm(short),
      ],
      prepareStep: ({ messages: current }) => {
        const compacted = compactHistory(current);
        return compacted ? { messages: compacted } : {};
      },
      // Ask for the provider's reasoning summary (never raw thoughts) so the
      // chat can show what the bot considered, as Coworker replies do.
      providerOptions: withPromptCache(
        modelReasoningSummaryOptions(input.model),
        input.cacheKey,
        modelIdOf(input.model),
      ),
      onStepFinish: async (step) => {
        const summary = stepReasoningSummary(step);
        if (summary) await input.onReasoning?.(summary);
      },
      abortSignal: signal(),
      maxRetries: 1,
    });
    stepsLeft -= result.steps.length;
    tokensUsed += inputTokensOf(result.steps);
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
    // A short-form save ended the round: the next offers the full tool, as
    // long as steps, time and tokens all leave room for it.
    if (
      short.length &&
      calledShortForm(result.steps, short) &&
      stepsLeft > 0 &&
      !timeUp() &&
      tokensUsed < tokenBudget
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
      tokensUsed < tokenBudget &&
      reportAt - now() > MIN_ROUND_TIME_MS;
    if (!keepGoing) break;
    messages.push({ role: "user", content: KEEP_GOING_PROMPT });
  }
  // A turn that ran out of steps, time or tokens while still calling tools
  // has no answer yet: one call without tools writes it.
  const cutOff = stepsLeft <= 0 || timeUp() || tokensUsed >= tokenBudget;
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
      providerOptions: withPromptCache(
        {},
        input.cacheKey,
        modelIdOf(input.model),
      ),
      abortSignal: signal(),
      maxRetries: 1,
    });
    text = result.text || text;
    finishReason = result.finishReason;
  }
  return {
    text: input.background ? reportText(text) : text,
    finishReason,
  };
}
