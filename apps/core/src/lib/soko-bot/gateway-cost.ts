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
