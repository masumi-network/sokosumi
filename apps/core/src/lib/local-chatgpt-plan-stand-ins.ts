import { generateText, Output } from "ai";
import { z } from "zod";
import type { EmbedTexts } from "@/lib/embeddings";
import {
  CHATGPT_PLAN_STANDIN_MODEL,
  localChatGptPlanModel,
} from "@/lib/local-chatgpt-plan";
import { recordModelCall } from "@/lib/soko-bot/model-calls";

/**
 * Plan runs only: what Jev and the embedding model answer on the Gateway,
 * answered on the plan or in process instead. Both are approximations, and
 * the ledger labels them so a plan run is never read as a Gateway one.
 */

/** Ledger label of a Jev question the plan model answered. */
export const CHATGPT_PLAN_JEV_LABEL = "chatgpt-plan-jev";
/** Ledger model of an embedding computed in process. */
export const CHATGPT_PLAN_EMBEDDING_MODEL = "chatgpt-plan/local-token-overlap";

type PlanQuestion =
  | { type: "boolean"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

function answerShape(question: PlanQuestion) {
  if (question.type === "boolean") return z.object({ probability: z.number() });
  const options = Object.keys(question.criteria);
  return z.object({
    choice: z.enum(options as [string, ...string[]]),
    probabilities: z.object(
      Object.fromEntries(options.map((option) => [option, z.number()])),
    ),
  });
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Jev's typed questions answered by the plan's stand-in model, in Jev's own
 * answer shape: `{ probability }` or `{ choice, probabilities }`.
 */
export async function evaluateOnChatGptPlan(options: {
  state: unknown;
  questions: Record<string, PlanQuestion>;
  abortSignal?: AbortSignal;
}): Promise<{
  answers: Record<string, unknown>;
  usage: { inputTokens?: number; outputTokens?: number };
}> {
  const model = localChatGptPlanModel(CHATGPT_PLAN_STANDIN_MODEL);
  if (!model) throw new Error("The ChatGPT plan is not enabled");
  const result = await generateText({
    model,
    telemetry: { functionId: CHATGPT_PLAN_JEV_LABEL },
    output: Output.object({
      schema: z.object(
        Object.fromEntries(
          Object.entries(options.questions).map(([key, question]) => [
            key,
            answerShape(question),
          ]),
        ),
      ),
    }),
    system:
      "You stand in for an evaluation model. Read the state and answer every question. A boolean question gets the probability that the answer is yes. A choice question gets the best option and a probability for every option. Probabilities are between 0 and 1.",
    prompt: JSON.stringify({
      state: options.state,
      questions: options.questions,
    }),
    maxRetries: 0,
    abortSignal: options.abortSignal,
  });
  const answers: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(
    result.output as Record<string, Record<string, unknown>>,
  )) {
    if (typeof raw.probability === "number")
      answers[key] = { probability: clamp(raw.probability) };
    else if (typeof raw.choice === "string")
      answers[key] = {
        choice: raw.choice,
        probabilities: Object.fromEntries(
          Object.entries(raw.probabilities as Record<string, number>).map(
            ([option, value]) => [option, clamp(value)],
          ),
        ),
      };
  }
  return { answers, usage: result.usage };
}

const DIMENSIONS = 512;

function bucket(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index++)
    hash = Math.imul(hash ^ token.charCodeAt(index), 16777619);
  return (hash >>> 0) % DIMENSIONS;
}

/** Word and word-pair counts, hashed and unit length: cosine ≈ shared wording. */
function tokenVector(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  words.forEach((word, index) => {
    vector[bucket(word)] += 1;
    if (index > 0) vector[bucket(`${words[index - 1]} ${word}`)] += 1;
  });
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

/** In-process embeddings for plan runs: free, deterministic, approximate. */
export const embedTextsOnChatGptPlan: EmbedTexts = async (values) => {
  const embeddings = values.map(tokenVector);
  await recordModelCall({
    role: "embedding",
    requestedModel: CHATGPT_PLAN_EMBEDDING_MODEL,
    usage: { inputTokens: 0 },
    costUsd: 0,
  });
  return { embeddings, costUsd: 0 };
};
