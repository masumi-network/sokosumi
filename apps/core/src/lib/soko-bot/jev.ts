import { experimental_evaluate, gateway } from "ai";
import { z } from "zod";

import { gatewayCostUsd } from "./gateway-cost";

/**
 * Jev, TypeSafe AI's evaluation model: typed questions answered with a
 * probability instead of text. It has no EU regional route, so it runs under
 * an owner-approved exception to the EU policy in `model-policy.ts`, for
 * every version including EU-pinned ones: routing (owner messages and the
 * bot's previous reply), the claim check (the bot's replies), agent fit
 * (the owner's request), mail triage (the owner's mail) and the bot's own
 * `evaluate_with_jev` calls. Every request keeps nothing and trains on
 * nothing.
 */
export const SOKO_BOT_JEV_MODEL = "typesafe-ai/jev";

export const JEV_PROVIDER_OPTIONS = {
  gateway: { zeroDataRetention: true, disallowPromptTraining: true },
};

export type JevState = Parameters<typeof experimental_evaluate>[0]["state"];

export type JevQuestion =
  | { type: "boolean"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type JevAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> };

const probability = z.number().min(0).max(1);
const answerSchema = z.union([
  z.object({
    choice: z.string(),
    probabilities: z.record(z.string(), probability).optional(),
  }),
  z.object({ probability }),
]);

/**
 * Asks Jev typed questions about `state`: a boolean one comes back as the
 * probability of "yes", a choice one as the chosen option with every
 * option's probability. A question Jev refused or did not answer is missing.
 * Throws when Jev fails, so each caller decides what failing means.
 */
export async function evaluateWithJev(options: {
  state: JevState;
  questions: Record<string, JevQuestion>;
  timeoutMs: number;
}): Promise<{ answers: Map<string, JevAnswer>; costUsd: number }> {
  const result = await experimental_evaluate({
    model: gateway.evaluationModel(SOKO_BOT_JEV_MODEL),
    state: options.state,
    questions: options.questions,
    abortSignal: AbortSignal.timeout(options.timeoutMs),
    maxRetries: 1,
    providerOptions: JEV_PROVIDER_OPTIONS,
  });
  const answers = new Map<string, JevAnswer>();
  for (const [key, raw] of Object.entries(
    (result.answers ?? {}) as Record<string, unknown>,
  )) {
    const question = options.questions[key];
    const parsed = answerSchema.safeParse(raw);
    if (!question || !parsed.success) continue;
    const answer = parsed.data;
    if (question.type === "boolean" && "probability" in answer)
      answers.set(key, { type: "boolean", probability: answer.probability });
    if (
      question.type === "choice" &&
      "choice" in answer &&
      Object.hasOwn(question.criteria, answer.choice)
    )
      answers.set(key, {
        type: "choice",
        choice: answer.choice,
        probabilities: answer.probabilities ?? { [answer.choice]: 1 },
      });
  }
  return { answers, costUsd: gatewayCostUsd(result.providerMetadata) };
}

/** Yes/no questions only: each answer's probability of "yes", by key. */
export async function askJev(options: {
  state: JevState;
  questions: Record<string, string>;
  timeoutMs: number;
}): Promise<Map<string, number>> {
  const { answers } = await evaluateWithJev({
    ...options,
    questions: Object.fromEntries(
      Object.entries(options.questions).map(([key, instructions]) => [
        key,
        { type: "boolean" as const, instructions },
      ]),
    ),
  });
  return new Map(
    [...answers].flatMap(([key, answer]) =>
      answer.type === "boolean" ? [[key, answer.probability] as const] : [],
    ),
  );
}
