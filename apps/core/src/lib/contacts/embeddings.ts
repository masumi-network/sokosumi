/**
 * Contact search embeddings. No embedding model on the AI Gateway runs in the
 * EU, so these go to Vertex outside it, with zero data retention and no
 * training (owner-approved 2026-11-08). Word search and filters stay in the
 * EU; only the search document and the query text are sent here.
 */
import { embedMany, gateway } from "ai";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";

export const CONTACT_EMBEDDING_MODEL = "google/text-multilingual-embedding-002";
export const CONTACT_EMBEDDING_DIMENSIONS = 768;

/** The part of a search document worth embedding. */
const MAX_EMBEDDED_CHARS = 2_000;

export type EmbedTexts = (
  values: readonly string[],
) => Promise<{ embeddings: number[][]; costUsd: number }>;

export const embedContactTexts: EmbedTexts = async (values) => {
  const result = await embedMany({
    model: gateway.textEmbeddingModel(CONTACT_EMBEDDING_MODEL),
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

/** `[0.1,0.2,…]`, the text form pgvector reads with `::vector`. */
export function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}
