import { generateText, Output } from "ai";
import type { z } from "zod";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import type { AiGatewayPurpose } from "@/lib/ai-gateway-purpose";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";

/** Small and cheap: a call reads a few dozen short lines and writes a few. */
export const SMALL_MODEL = "google/gemini-3.8-flash";
const TIMEOUT_MS = 25_000;

/** One structured answer from the small EU model, with what it cost. */
export async function askSmallModel<T>(input: {
  /** What the call is for, as `soko_bot_model_call.label` records it. */
  label: string;
  purpose: AiGatewayPurpose;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}): Promise<{ output: T; costUsd: number }> {
  const request = sokoBotModelRequest({
    role: "agent",
    model: SMALL_MODEL,
    inferenceRegion: "eu",
    purpose: input.purpose,
  });
  const result = await generateText({
    ...request,
    telemetry: { functionId: input.label },
    providerOptions: {
      ...request.providerOptions,
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
    output: Output.object({ schema: input.schema }),
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: 1_500,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => rethrowAiGatewayFailure(error, input.purpose));
  return {
    output: result.output,
    costUsd: gatewayCostUsd(result.providerMetadata),
  };
}
