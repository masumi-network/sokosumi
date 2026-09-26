import { gateway, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { z } from "zod";

/** Public Gateway catalog checked 2026-09-26. Add exact IDs only after review.
 * Virtual aliases and direct-provider objects cannot bypass regional routing.
 * Jev has no regional support and is intentionally absent.
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

export type SokoBotModelRole = "selector" | "agent" | "judge";
export const SOKO_BOT_MODEL_POLICY_VERSION = "eu-2026-09-26";
export const SOKO_BOT_SELECTOR_MODEL = "google/gemini-3.6-flash";

export class SokoBotModelPolicyError extends Error {
  constructor() {
    super("Model is not approved for this EU inference role");
    this.name = "SokoBotModelPolicyError";
  }
}

/** Check the provider response before the SDK can execute returned tool calls. */
export const sokoBotRegionMiddleware: LanguageModelMiddleware = {
  async wrapGenerate({ doGenerate }) {
    const result = await doGenerate();
    assertSokoBotInferenceRegion(result.providerMetadata);
    return result;
  },
  async wrapStream() {
    // All Soko Bot inference uses generateText. Do not allow streamed tool
    // calls to escape before their routing metadata has been inspected.
    throw new SokoBotModelPolicyError();
  },
};

/** Pure validation shared by authoring, selection and inference. */
export function assertSokoBotModelPolicy(options: {
  role: SokoBotModelRole;
  model: string;
  inferenceRegion?: string | null;
}): void {
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
  const policy = EU_MODELS[options.model];
  return {
    model: wrapLanguageModel({
      model: gateway.languageModel(options.model),
      middleware: sokoBotRegionMiddleware,
    }),
    maxRetries: 0,
    providerOptions: {
      gateway: {
        inferenceRegion: { scope: "zone", geoRegion: "eu" },
        only: [...policy.providers],
      },
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
export function assertSokoBotInferenceRegion(metadata: unknown): void {
  if (sokoBotInferenceEvidence(metadata).regionStatus === "MISMATCH") {
    throw new SokoBotModelPolicyError();
  }
}
