import { experimental_evaluate, gateway } from "ai";
import { z } from "zod";

/**
 * Jev, TypeSafe AI's evaluation model: typed questions answered with a
 * probability instead of text. It has no EU regional route, so it runs under
 * an owner-approved exception to the EU policy in `model-policy.ts`, for
 * every version including EU-pinned ones: routing (owner messages and the
 * bot's previous reply), the claim check (the bot's replies) and agent fit
 * (the owner's request). Every request keeps nothing and trains on nothing.
 */
export const SOKO_BOT_JEV_MODEL = "typesafe-ai/jev";

export const JEV_PROVIDER_OPTIONS = {
  gateway: { zeroDataRetention: true, disallowPromptTraining: true },
};

const booleanAnswersSchema = z.record(
  z.string(),
  z.object({ probability: z.number().min(0).max(1).optional() }).optional(),
);

/**
 * Asks Jev yes/no questions about `state` and returns each answer's
 * probability of "yes", by question key; a question it did not answer is
 * missing. Throws when Jev fails, so each caller decides what failing means.
 */
export async function askJev(options: {
  state: Parameters<typeof experimental_evaluate>[0]["state"];
  questions: Record<string, string>;
  timeoutMs: number;
}): Promise<Map<string, number>> {
  const result = await experimental_evaluate({
    model: gateway.evaluationModel(SOKO_BOT_JEV_MODEL),
    state: options.state,
    questions: Object.fromEntries(
      Object.entries(options.questions).map(([key, instructions]) => [
        key,
        { type: "boolean" as const, instructions },
      ]),
    ),
    abortSignal: AbortSignal.timeout(options.timeoutMs),
    maxRetries: 1,
    providerOptions: JEV_PROVIDER_OPTIONS,
  });
  const answers = booleanAnswersSchema.parse(result.answers);
  return new Map(
    Object.entries(answers).flatMap(([key, answer]) =>
      typeof answer?.probability === "number"
        ? [[key, answer.probability] as const]
        : [],
    ),
  );
}
