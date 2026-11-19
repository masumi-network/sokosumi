import { generateText, Output } from "ai";
import type { z } from "zod";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";

import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";

/** Small and cheap: each call reads a few dozen short lines and writes a few. */
export const COMPETITOR_CHECK_MODEL = "google/gemini-3.8-flash";
const TIMEOUT_MS = 25_000;

/** One structured answer from the check's model, with what it cost. */
export type AskCompetitorModel = <T>(input: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}) => Promise<{ output: T; costUsd: number }>;

export const askCompetitorModel: AskCompetitorModel = async ({
  system,
  prompt,
  schema,
}) => {
  const request = sokoBotModelRequest({
    role: "agent",
    model: COMPETITOR_CHECK_MODEL,
    inferenceRegion: "eu",
    purpose: "cmo",
  });
  const result = await generateText({
    ...request,
    providerOptions: {
      ...request.providerOptions,
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
    output: Output.object({ schema }),
    system,
    prompt,
    maxOutputTokens: 1_500,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => rethrowAiGatewayFailure(error, "cmo"));
  return {
    output: result.output,
    costUsd: gatewayCostUsd(result.providerMetadata),
  };
};
