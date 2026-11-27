/**
 * B6 (research2 R6-B): the owner benchmark's token bar weighs tokens by what
 * they cost, so a cache win or loss counts: a cached read is a tenth (or a
 * twentieth) of an uncached one, and output costs five times input.
 *
 * USD per token, the AI Gateway catalog's base tier (`/v1/models`, snapshot
 * 2026-11-27; the long-context tier above 272k input tokens is not applied).
 * Plan runs cost nothing, so these list prices stand in for production's.
 */
export interface TokenPrice {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export const TOKEN_PRICES_AS_OF = "2026-11-27";

const TOKEN_PRICES: Readonly<Record<string, TokenPrice>> = {
  "gpt-6-luna": {
    input: 0.0000001,
    cacheRead: 0.00000001,
    cacheWrite: 0.000000125,
    output: 0.0000005,
  },
  "gpt-6.1-terra": {
    input: 0.000001,
    cacheRead: 0.00000005,
    cacheWrite: 0.00000125,
    output: 0.000005,
  },
  "gpt-6.2-sol": {
    input: 0.000002,
    cacheRead: 0.0000001,
    cacheWrite: 0.0000025,
    output: 0.00001,
  },
  "typesafe-ai/jev": {
    input: 0.000000042,
    cacheRead: 0.000000042,
    cacheWrite: 0.000000042,
    output: 0,
  },
};

/** A stored model id as a price key: `openai/x`, `chatgpt-plan:x` and `x` are one model. */
export function priceKey(model: string): string {
  return model.replace(/^chatgpt-plan[:/]/, "").replace(/^openai\//, "");
}

export function tokenPrice(model: string): TokenPrice | null {
  return TOKEN_PRICES[priceKey(model)] ?? null;
}

/**
 * The list-price cost of one model's tokens. `inputTokens` includes cache
 * reads and writes (as the Gateway and AI SDK report it), so only the rest
 * is billed at the uncached rate.
 */
export function pricedUsd(
  price: TokenPrice,
  tokens: {
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  },
): number {
  const uncached = Math.max(
    0,
    tokens.inputTokens - tokens.cacheReadTokens - tokens.cacheWriteTokens,
  );
  return (
    uncached * price.input +
    tokens.cacheReadTokens * price.cacheRead +
    tokens.cacheWriteTokens * price.cacheWrite +
    tokens.outputTokens * price.output
  );
}
