import { gateway, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { z } from "zod";
import { evaluationBinding, evaluationMiddleware } from "./evaluation-dispatch";

/** Public Gateway catalog checked 2026-09-26. Add exact IDs only after review.
 * Virtual aliases and direct-provider objects cannot bypass regional routing.
 * Jev has no regional support and is intentionally absent: route selection
 * uses it under a separate, owner-approved exception (see `classifier.ts`).
 */
const EU_MODELS: Readonly<
  Record<string, { structured: boolean; providers: readonly string[] }>
> = {
  "google/gemini-3.6-flash": { structured: true, providers: ["vertex"] },
  "google/gemini-3.8-flash": { structured: true, providers: ["vertex"] },
  "anthropic/claude-haiku-4.5": {
    structured: true,
    providers: ["vertex", "bedrock"],
  },
  "anthropic/claude-sonnet-5": {
    structured: true,
    providers: ["vertex", "bedrock"],
  },
  "anthropic/claude-opus-5.5": {
    structured: false,
    providers: ["vertex", "bedrock"],
  },
};

/**
 * Agent models the owner approved to run outside the EU (2026-09-29): OpenAI
 * has no EU region on the Gateway, and GPT-6 Luna led the behaviour lab on
 * cost and speed. Owner prompts, tasks and mail reach OpenAI for these; the
 * judge stays EU-only and Jev keeps its own exception in `classifier.ts`.
 */
const GLOBAL_AGENT_MODELS: ReadonlySet<string> = new Set(["openai/gpt-6-luna"]);

/** Whether the agent may run on `model` without EU pinning. */
function isSokoBotGlobalAgentModel(model: string): boolean {
  return GLOBAL_AGENT_MODELS.has(model) || sokoBotLabGlobalModels();
}

export type SokoBotModelRole = "agent" | "judge";
export const SOKO_BOT_MODEL_POLICY_VERSION = "eu-2026-09-29";

export class SokoBotModelPolicyError extends Error {
  constructor() {
    super("Model is not approved for this EU inference role");
    this.name = "SokoBotModelPolicyError";
  }
}

/** Check the provider response before the SDK can execute returned tool calls. */
export function sokoBotRegionMiddleware(options: {
  model: string;
  role: SokoBotModelRole;
}): LanguageModelMiddleware {
  return {
    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate();
      assertSokoBotInferenceRegion(result.providerMetadata, options);
      return result;
    },
    async wrapStream() {
      // All Soko Bot inference uses generateText. Do not allow streamed tool
      // calls to escape before their routing metadata has been inspected.
      throw new SokoBotModelPolicyError();
    },
  };
}

/**
 * Local behaviour-lab comparisons only: any Gateway model may run the agent,
 * without EU pinning. Every Vercel deployment sets `VERCEL`, so this can never
 * apply to preprod or production.
 */
export function sokoBotLabGlobalModels(): boolean {
  return (
    process.env.SOKO_BOT_LAB_GLOBAL_MODELS === "true" && !process.env.VERCEL
  );
}

/** Pure validation shared by authoring, selection and inference. */
export function assertSokoBotModelPolicy(options: {
  role: SokoBotModelRole;
  model: string;
  inferenceRegion?: string | null;
}): void {
  if (
    options.role === "agent" &&
    isSokoBotGlobalAgentModel(options.model) &&
    options.inferenceRegion == null
  )
    return;
  const policy = Object.hasOwn(EU_MODELS, options.model)
    ? EU_MODELS[options.model]
    : undefined;
  if (
    !policy ||
    (options.role !== "agent" && !policy.structured) ||
    (options.inferenceRegion != null && options.inferenceRegion !== "eu")
  ) {
    throw new SokoBotModelPolicyError();
  }
}

/** No caller-supplied provider options, region overrides or implicit model fallback. */
export function sokoBotModelRequest(options: {
  role: SokoBotModelRole;
  model: string;
  inferenceRegion?: "eu" | "us";
}) {
  assertSokoBotModelPolicy(options);
  const policy = Object.hasOwn(EU_MODELS, options.model)
    ? EU_MODELS[options.model]
    : undefined;
  const evaluation = process.env.SOKO_BOT_EVALUATION_ALLOWANCE
    ? evaluationBinding()
    : null;
  return {
    model: wrapLanguageModel({
      model: gateway.languageModel(options.model),
      middleware: evaluation
        ? [
            sokoBotRegionMiddleware(options),
            evaluationMiddleware(options.model, options.role),
          ]
        : sokoBotRegionMiddleware(options),
    }),
    maxRetries: 0,
    providerOptions: {
      gateway: policy
        ? {
            inferenceRegion: { scope: "zone" as const, geoRegion: "eu" },
            only: [...policy.providers],
          }
        : // Outside the EU the provider must still keep nothing and train on
          // nothing, as every Jev call asks: the owner-approved models, and
          // any the local lab runs against real workspace data.
          { zeroDataRetention: true, disallowPromptTraining: true },
    },
  };
}

const routingSchema = z.object({
  gateway: z.object({
    routing: z
      .object({
        finalProvider: z.string().max(80).optional(),
        modelAttempts: z
          .array(
            z.object({
              providerAttempts: z
                .array(
                  z.object({
                    provider: z.string().max(80).optional(),
                    inferenceEndpoint: z
                      .object({
                        geoRegion: z.string().max(20),
                      })
                      .nullish(),
                  }),
                )
                .max(32)
                .optional(),
            }),
          )
          .max(32)
          .optional(),
      })
      .optional(),
  }),
});

/** Retain only routing evidence, never raw provider metadata or request bodies. */
export function sokoBotInferenceEvidence(metadata: unknown) {
  const parsed = routingSchema.safeParse(metadata);
  const routing = parsed.success ? parsed.data.gateway.routing : undefined;
  const attempts =
    routing?.modelAttempts?.flatMap((attempt) =>
      (attempt.providerAttempts ?? []).map((provider) => ({
        provider: provider.provider ?? null,
        region: provider.inferenceEndpoint?.geoRegion ?? null,
      })),
    ) ?? [];
  return {
    policyVersion: SOKO_BOT_MODEL_POLICY_VERSION,
    requestedRegion: "eu",
    finalProvider: routing?.finalProvider ?? null,
    attempts,
    regionStatus: attempts.some(
      (attempt) => attempt.region && attempt.region !== "eu",
    )
      ? "MISMATCH"
      : attempts.length === 0 || attempts.some((attempt) => !attempt.region)
        ? "UNKNOWN"
        : "EU",
  };
}

/** Missing metadata is not routing proof; explicit contrary evidence is fatal. */
export function assertSokoBotInferenceRegion(
  metadata: unknown,
  options: { model: string; role: SokoBotModelRole },
): void {
  if (options.role === "agent" && isSokoBotGlobalAgentModel(options.model))
    return;
  if (sokoBotInferenceEvidence(metadata).regionStatus === "MISMATCH") {
    throw new SokoBotModelPolicyError();
  }
}
