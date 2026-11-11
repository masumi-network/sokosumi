/**
 * Text embeddings on the AI Gateway. No embedding model there runs in the
 * EU, so these go to Vertex outside it, with zero data retention and no
 * training (owner-approved 2026-11-08 for contact search, 2026-11-11 for a
 * month's posts and titles). Only the texts being compared are sent.
 */
import { embedMany, gateway } from "ai";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";

export const EMBEDDING_MODEL = "google/text-multilingual-embedding-002";

/** The part of a text worth embedding. */
const MAX_EMBEDDED_CHARS = 2_000;

export type EmbedTexts = (
  values: readonly string[],
) => Promise<{ embeddings: number[][]; costUsd: number }>;

export const embedTexts: EmbedTexts = async (values) => {
  const result = await embedMany({
    model: gateway.textEmbeddingModel(EMBEDDING_MODEL),
    values: values.map((value) => value.slice(0, MAX_EMBEDDED_CHARS)),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(20_000),
    providerOptions: {
      gateway: { zeroDataRetention: true, disallowPromptTraining: true },
    },
  });
  return {
    embeddings: result.embeddings,
    costUsd: gatewayCostUsd(result.providerMetadata),
  };
};
