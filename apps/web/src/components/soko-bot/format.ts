/** `1.2 s`, `450 ms`, `2 min 5 s` — compact wall-clock durations for tables. */
export function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** First 8 chars of an id/hash for dense tables. */
export function shortId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

/** Percentage string for a 0..1 classifier confidence. */
export function formatConfidence(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/**
 * Safe classifier fields for display. The stored classification is a JSON
 * blob; only the summary fields the plan marks as admin-safe are surfaced —
 * never raw model reasoning.
 */
export interface SafeClassification {
  confidence: string | null;
  rationaleSummary: string | null;
  requestedOutcome: string | null;
  requiresClarification: boolean | null;
  requiresApproval: boolean | null;
}

export function pickSafeClassification(
  classification: Record<string, unknown> | null,
): SafeClassification {
  const read = (key: string): unknown => classification?.[key];
  const readString = (key: string): string | null => {
    const value = read(key);
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  };
  const readBoolean = (key: string): boolean | null => {
    const value = read(key);
    return typeof value === "boolean" ? value : null;
  };
  return {
    confidence: formatConfidence(read("confidence")),
    rationaleSummary: readString("rationaleSummary"),
    requestedOutcome: readString("requestedOutcome"),
    requiresClarification: readBoolean("requiresClarification"),
    requiresApproval: readBoolean("requiresApproval"),
  };
}

/** `$0.0042` for sub-cent amounts, `$1.23` otherwise; null when unknown. */
export function formatUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (value === 0) return "$0.00";
  const decimals = Math.abs(value) < 0.01 ? 4 : 2;
  return `$${value.toFixed(decimals)}`;
}

/** Compact token counts for dense rows: `950`, `12.3k`, `1.2M`. */
export function formatTokens(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) < 1000) return String(Math.round(value));
  if (Math.abs(value) < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
