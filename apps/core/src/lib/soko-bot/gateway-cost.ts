/**
 * AI Gateway reports per-call cost in provider metadata; absent means unpriced.
 *
 * Shared because three separate model calls make up one turn — the agent loop,
 * the classifier that routes it, and the judge that scores it — and a bot's
 * reported spend is only honest if all three read the cost the same way.
 */
export function gatewayCostUsd(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const gateway = (metadata as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object") return 0;
  const cost = (gateway as Record<string, unknown>).cost;
  const parsed = typeof cost === "string" ? Number(cost) : cost;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : 0;
}

function tokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "total" in value)
    return tokenCount((value as { total: unknown }).total);
  return 0;
}

function nestedCount(value: unknown, key: "cacheRead" | "cacheWrite"): number {
  return value && typeof value === "object" && key in value
    ? tokenCount((value as Record<string, unknown>)[key])
    : 0;
}

/**
 * Usage of one language-model call as the Gateway reports it on the wire:
 * token counts are plain numbers or `{ total, … }` objects depending on the
 * spec version.
 */
export function gatewayCallUsage(result: {
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  providerMetadata?: unknown;
}) {
  const input = result.usage?.inputTokens;
  return {
    inputTokens: tokenCount(input),
    outputTokens: tokenCount(result.usage?.outputTokens),
    cacheReadTokens: nestedCount(input, "cacheRead"),
    cacheWriteTokens: nestedCount(input, "cacheWrite"),
    costUsd: gatewayCostUsd(result.providerMetadata),
  };
}

/** Whether a call's content includes a Gateway-run tool of this name. */
export function gatewayRanTool(content: unknown, toolName: string): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (part) =>
        part !== null &&
        typeof part === "object" &&
        (part as { toolName?: unknown }).toolName === toolName,
    )
  );
}
